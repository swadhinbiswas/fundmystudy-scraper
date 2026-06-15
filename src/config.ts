import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Direct DB access (no worker hop) */
  TURSO_URL: z.string().default('libsql://fundmystudy-reddragon.aws-ap-south-1.turso.io'),
  TURSO_AUTH_TOKEN: z.string().min(8),

  DRY_RUN: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  SOURCES: z
    .string()
    .default('chevening,daad,erasmus,euraxess,findaphd,jobs-ac-uk,academicpositions,academictransfer,phdportal')
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    ),

  RUN_ON_START: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  USER_AGENT: z.string().default('FundMyStudyBot/1.0 (+https://fundmystudy.app)'),

  /** Optional: Facebook Graph API access token (for facebook.ts). */
  FACEBOOK_ACCESS_TOKEN: z.string().optional(),

  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  HTTP_RETRY: z.coerce.number().int().min(0).max(10).default(3),
  SOURCES_PARALLELISM: z.coerce.number().int().min(1).max(8).default(2),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
