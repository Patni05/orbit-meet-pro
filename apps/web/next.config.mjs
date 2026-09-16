import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Load the monorepo's root .env.
 *
 * Next only reads .env files next to the app, but this repository keeps a
 * single .env at the root that the API reads too. Without this, every
 * NEXT_PUBLIC_* value silently fell back to the hardcoded localhost defaults —
 * which looks fine on the development machine and breaks the moment the app is
 * opened from a phone, because "localhost" then means the phone.
 *
 * Existing environment variables win, so CI and container builds that pass
 * values in directly are unaffected.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The shared package ships compiled JS, but transpiling it keeps source maps
  // useful and lets the dev server pick up edits without a rebuild step.
  transpilePackages: ['@orbit/shared'],

  eslint: {
    // Lint is a separate command; a lint warning should not block a build.
    ignoreDuringBuilds: true,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Camera, microphone and screen capture are used by this origin only.
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
