import './load-env';
import { z } from 'zod';

/**
 * Environment configuration.
 *
 * Parsed once at boot and validated — the process refuses to start with a bad
 * or missing secret rather than failing later in a request. Nothing here is
 * ever sent to the browser; the web app gets only what `/config` exposes.
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = z
  .string()
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const DEV_PLACEHOLDER = 'dev-only-insecure-secret-change-me-now';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** Server-to-server LiveKit endpoint (room service / egress admin API). */
  LIVEKIT_URL: z.string().min(1).default('http://localhost:7880'),
  /** WebSocket endpoint handed to browsers. Must be wss:// in production. */
  LIVEKIT_PUBLIC_URL: z.string().min(1).default('ws://localhost:7880'),

  /**
   * Origins that front this deployment through a single-origin reverse proxy.
   *
   * There can be several at once — a LAN address for phones on the same Wi-Fi
   * and a Cloudflare Tunnel hostname for everyone else — and the same server
   * answers all of them. A request arriving on one of these is told to reach
   * the SFU through that same origin, so the browser never has to open a
   * second connection to a host it has not already trusted.
   *
   * Empty in a plain setup, where clients talk to the API directly.
   */
  PROXY_ORIGINS: csv.default(''),
  LIVEKIT_API_KEY: z.string().min(1, 'LIVEKIT_API_KEY is required'),
  LIVEKIT_API_SECRET: z.string().min(1, 'LIVEKIT_API_SECRET is required'),
  /** Lifetime of the participant token minted per join. Short by design. */
  LIVEKIT_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(21600),

  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: csv.default('http://localhost:3000'),

  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanish.default(false),
  /** 'lax' for same-site dev, 'none' when web and api are on different sites over HTTPS. */
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  TURN_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_PASSWORD: z.string().optional(),

  RECORDING_ENABLED: booleanish.default(false),

  /**
   * Where the egress worker writes finished recordings.
   *
   * This is a path *inside the egress container*, because that is the process
   * doing the writing. It is handed to LiveKit verbatim.
   */
  RECORDING_OUTPUT_DIR: z.string().default('/recordings'),

  /**
   * Where this API reads those same files from.
   *
   * Deliberately separate from `RECORDING_OUTPUT_DIR`. The API runs on the
   * host while egress runs in a container, so the two see the same file at two
   * different paths — the compose file maps `./recordings` to `/recordings`.
   * Resolving the container path on the host is how a finished recording ended
   * up with no size and a download that could not find it: on Windows
   * `path.resolve('/recordings')` is the *drive root*, not the project folder.
   *
   * Left empty when the API itself runs in a container sharing the volume, in
   * which case the two paths are the same and this falls back to the other.
   */
  RECORDING_LOCAL_DIR: z.string().optional(),

  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  /** Exposes the diagnostics payload to clients. Off in production by default. */
  ENABLE_DEBUG_ENDPOINTS: booleanish.default(false),
});

export type AppEnv = z.infer<typeof schema>;

function loadEnv(): AppEnv {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    // Printed, not logged, because the logger itself depends on config.
    console.error(`\nInvalid environment configuration:\n${issues}\n\nSee .env.example for the full list.\n`);
    process.exit(1);
  }

  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    const weak: string[] = [];
    if (env.JWT_SECRET === DEV_PLACEHOLDER || env.JWT_SECRET.includes('change-me')) weak.push('JWT_SECRET');
    if (env.JWT_REFRESH_SECRET === DEV_PLACEHOLDER || env.JWT_REFRESH_SECRET.includes('change-me')) {
      weak.push('JWT_REFRESH_SECRET');
    }
    if (env.LIVEKIT_API_SECRET === 'devsecretdevsecretdevsecretdevsecret') weak.push('LIVEKIT_API_SECRET');
    if (weak.length > 0) {
      console.error(`\nRefusing to start in production with development secrets: ${weak.join(', ')}\n`);
      process.exit(1);
    }
    if (env.LIVEKIT_PUBLIC_URL.startsWith('ws://')) {
      console.warn('[config] LIVEKIT_PUBLIC_URL is insecure (ws://). Browsers on HTTPS pages will refuse it.');
    }
  }

  return env;
}

export const env: AppEnv = loadEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDev = env.NODE_ENV === 'development';
