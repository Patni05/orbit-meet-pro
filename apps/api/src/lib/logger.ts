import pino from 'pino';
import { env, isDev } from '../config/env';

/**
 * Structured logging.
 *
 * `redact` is the safety net that keeps credentials, tokens and cookies out of
 * the log stream even when a whole request or config object is logged by
 * accident. Media never passes through here at all.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-session-token"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'sessionToken',
  '*.sessionToken',
  'apiSecret',
  '*.apiSecret',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'LIVEKIT_API_SECRET',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'orbit-api' },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
      }
    : undefined,
});

export type Logger = typeof logger;
