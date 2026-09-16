import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Argon2 hashing is intentionally slow; give those cases room.
    testTimeout: 30_000,
  },
  resolve: {
    // Resolve the workspace package to its source so tests do not depend on a
    // prior build step. fileURLToPath is required for correct Windows paths.
    alias: {
      '@orbit/shared': path.resolve(here, '../../packages/shared/src/index.ts'),
    },
  },
});
