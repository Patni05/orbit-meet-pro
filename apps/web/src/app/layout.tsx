import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AppProviders } from '@/components/AppProviders';

export const metadata: Metadata = {
  title: {
    default: 'Orbit — Meet. Talk. Collaborate.',
    template: '%s · Orbit',
  },
  description:
    'Orbit is an open, self-hostable video meeting platform. HD video, screen sharing, realtime chat and secure rooms that work in any modern browser.',
  applicationName: 'Orbit',
  openGraph: {
    title: 'Orbit — Meet. Talk. Collaborate.',
    description: 'Open, self-hostable video meetings that work in any modern browser.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The meeting UI is full-bleed; allow it under the notch but keep zoom
  // available, because disabling it is an accessibility failure.
  viewportFit: 'cover',
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0f14' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-white text-ink-900 dark:bg-ink-900 dark:text-ink-50">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
