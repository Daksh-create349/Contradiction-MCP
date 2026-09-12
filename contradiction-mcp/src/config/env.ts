import dotenv from 'dotenv';
import { z } from 'zod';
import { ConfigurationError } from '../domain/types/common.js';

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_PATH: z.string().min(1).default('./data/contradiction.db'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SERVER_NAME: z.string().min(1).default('contradiction-mcp'),
  SERVER_VERSION: z.string().min(1).default('0.1.0'),
  GITHUB_TOKEN: z.string().optional(),
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  API_KEY: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  MAX_BATCH_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SEMANTIC_MATCHING_ENABLED: z.coerce.boolean().default(false),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function loadConfig(envOverrides?: Partial<Record<string, string>>): EnvConfig {
  const mergedEnv = {
    ...process.env,
    ...envOverrides,
  };

  const parsed = EnvSchema.safeParse(mergedEnv);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigurationError(`Environment configuration invalid: ${issues}`);
  }

  return parsed.data;
}

export const config = loadConfig();
