import { describe, it, expect } from 'vitest';
import { WebsiteConnector } from '../src/connectors/website/websiteConnector.js';
import {
  validateSafeUrl,
  isPrivateOrRestrictedIp,
  SsrfError,
} from '../src/connectors/website/ssrfGuard.js';

describe('WebsiteConnector & SSRF Security Tests', () => {
  describe('SSRF Protection Guard', () => {
    it('identifies private and loopback IPv4 addresses as restricted', () => {
      expect(isPrivateOrRestrictedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('127.0.1.5')).toBe(true);
      expect(isPrivateOrRestrictedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrRestrictedIp('192.168.1.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrRestrictedIp('0.0.0.0')).toBe(true);
    });

    it('identifies loopback and link-local IPv6 addresses as restricted', () => {
      expect(isPrivateOrRestrictedIp('::1')).toBe(true);
      expect(isPrivateOrRestrictedIp('fe80::1')).toBe(true);
      expect(isPrivateOrRestrictedIp('fc00::1')).toBe(true);
    });

    it('allows legitimate public IP addresses', () => {
      expect(isPrivateOrRestrictedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrRestrictedIp('1.1.1.1')).toBe(false);
      expect(isPrivateOrRestrictedIp('140.82.121.4')).toBe(false);
    });

    it('blocks localhost and loopback URLs from fetch', async () => {
      await expect(validateSafeUrl('http://localhost:8080')).rejects.toThrow(SsrfError);
      await expect(validateSafeUrl('http://127.0.0.1:3000/secret')).rejects.toThrow(SsrfError);
      await expect(validateSafeUrl('http://127.0.1.1/admin')).rejects.toThrow(SsrfError);
    });

    it('blocks cloud metadata IP endpoints', async () => {
      await expect(validateSafeUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
        SsrfError,
      );
      await expect(
        validateSafeUrl('http://metadata.google.internal/computeMetadata/v1'),
      ).rejects.toThrow(SsrfError);
    });

    it('rejects disallowed non-HTTP protocols', async () => {
      await expect(validateSafeUrl('file:///etc/passwd')).rejects.toThrow(/Forbidden protocol/);
      await expect(validateSafeUrl('ftp://ftp.example.com/file')).rejects.toThrow(
        /Forbidden protocol/,
      );
      await expect(validateSafeUrl('gopher://example.com/')).rejects.toThrow(/Forbidden protocol/);
    });
  });

  describe('WebsiteConnector Claim Extraction', () => {
    it('extracts structured factual claims from raw website HTML', async () => {
      const connector = new WebsiteConnector();
      const rawData = {
        url: 'https://example.com/info',
        title: 'Example Service',
        statusCode: 200,
        contentType: 'text/html',
        headers: {},
        textSnippet: 'Runtime details',
        extractedLines: [
          'Example Service Status',
          'node_version: 22',
          'http_port: 443',
          'environment: production',
        ],
      };

      const claims = await connector.extractClaims({
        sourceIdentifier: 'website:https://example.com/info',
        sourceName: 'Example Service',
        sourceUri: 'https://example.com/info',
        fetchedAt: new Date(),
        rawData,
        metadata: {
          environment: 'production',
          scope: 'public_web',
        },
      });

      expect(claims.length).toBeGreaterThanOrEqual(2);
      const nodeClaim = claims.find((c) => c.predicate === 'node_version');
      expect(nodeClaim).toBeDefined();
      expect(nodeClaim?.value).toBe('22');
      expect(nodeClaim?.provenance.connector).toBe('website');
      expect(nodeClaim?.provenance.url).toBe('https://example.com/info');
    });
  });
});
