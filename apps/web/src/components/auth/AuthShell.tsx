import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';

/** Shared frame for the sign-in, sign-up and password screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-ink-50 dark:bg-ink-950">
      <header className="px-4 py-6 sm:px-6">
        <Link href="/" aria-label="Orbit home" className="inline-flex rounded-lg">
          <Logo />
        </Link>
      </header>

      <main id="main" className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:px-6">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-ink-200/80 bg-white p-6 shadow-sm sm:p-8 dark:border-white/10 dark:bg-ink-850">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-sm text-ink-600 dark:text-ink-400">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
