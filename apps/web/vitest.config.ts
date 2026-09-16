import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Browser APIs (localStorage, DOMException) are the subject under test.
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The end-to-end suite under e2e/ runs with Playwright, not Vitest.
    exclude: ['e2e/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      '@orbit/shared': path.resolve(here, '../../packages/shared/src/index.ts'),
    },
  },
});
