# Platform Infrastructure Guide v3.2

## Overview
This document describes the canonical infrastructure requirements for the **Alpha Commerce Platform** production deployment.
Last updated: 2026-08-15

## Technology Stack

| Component          | Version / Spec        | Notes                          |
|--------------------|-----------------------|--------------------------------|
| Node.js            | 20.11.0               | LTS required in production     |
| Python             | 3.11.4                | ML services only               |
| PostgreSQL         | 15.4                  | Primary datastore              |
| Redis              | 7.2.0                 | Cache & session store          |
| Nginx              | 1.25.3                | Reverse proxy & TLS termination|
| Docker             | 24.0.5                | Container runtime              |

## Hardware Requirements

- **RAM:** 16GB minimum per node
- **CPU:** 8 cores minimum
- **Storage:** 500GB SSD per node
- **Network:** 1Gbps uplink

## Service Configuration

### API Gateway
- node_version: 20.11.0
- port: 8080
- max_connections: 10000
- timeout: 30s
- tls_enabled: true
- environment: production

### Database Cluster
- db_engine: postgresql
- db_version: 15.4
- max_connections: 500
- connection_pool: 100
- backup_retention: 30 days

### Cache Layer
- cache_engine: redis
- cache_version: 7.2.0
- max_memory: 8GB
- eviction_policy: allkeys-lru
- port: 6379

## Security Requirements
- TLS 1.3 required for all external connections
- JWT token expiry: 3600 seconds
- Rate limiting: 1000 requests per minute per client
- Password policy: minimum 12 characters

## Deployment Regions
- Primary: us-east-1
- Failover: eu-west-1
- CDN: cloudfront

## Monitoring
- Metrics retention: 90 days
- Alert threshold CPU: 80%
- Alert threshold memory: 85%
