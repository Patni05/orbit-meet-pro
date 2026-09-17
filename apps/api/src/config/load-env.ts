import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Loads `.env` before anything reads `process.env`.
 *
 * The repository root holds the single `.env` for the whole monorepo, so the
 * API, the Prisma CLI and docker compose all read the same values. An
 * `apps/api/.env` is honoured too, for deployments that give the API its own
 * file. Real environment variables always win over both — that is how
 * containers and CI inject configuration.
 *
 * Imported for its side effect only; it must run first, hence the separate
 * module rather than a call inside env.ts.
 */
const candidates = [
  resolve(__dirname, '../../.env'), // apps/api/.env
  resolve(__dirname, '../../../../.env'), // repository root .env
];

for (const path of candidates) {
  if (existsSync(path)) {
    loadDotenv({ path, override: false });
  }
}

/**
 * The repository root.
 *
 * Relative paths in configuration are resolved against this rather than
 * `process.cwd()`. The API is started from `apps/api`, so a perfectly
 * reasonable `./recordings` in the root `.env` would otherwise point at
 * `apps/api/recordings` — a directory that does not exist, producing a
 * recording the server insists is not on this server.
 */
export const REPO_ROOT = resolve(__dirname, '../../../..');
