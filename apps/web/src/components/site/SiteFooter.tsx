import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-ink-100 bg-ink-50/60 dark:border-white/10 dark:bg-ink-950/40">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-ink-500 dark:text-ink-400">
            Open, self-hostable video meetings. Your conversations run on infrastructure you control —
            no per-seat licence, no vendor lock-in.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Product</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-500 dark:text-ink-400">
            <li>
              <Link href="/dashboard" className="hover:text-ink-900 dark:hover:text-white">
                Meetings
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="hover:text-ink-900 dark:hover:text-white">
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/help" className="hover:text-ink-900 dark:hover:text-white">
                Help centre
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-ink-900 dark:text-ink-100">Account</h2>
          <ul className="mt-3 space-y-2 text-sm text-ink-500 dark:text-ink-400">
            <li>
              <Link href="/login" className="hover:text-ink-900 dark:hover:text-white">
                Log in
              </Link>
            </li>
            <li>
              <Link href="/signup" className="hover:text-ink-900 dark:hover:text-white">
                Create an account
              </Link>
            </li>
            <li>
              <Link href="/forgot-password" className="hover:text-ink-900 dark:hover:text-white">
                Reset password
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-ink-100 px-4 py-5 text-center text-xs text-ink-500 sm:px-6 dark:border-white/10 dark:text-ink-500">
        © {year} Orbit. Built on open standards — WebRTC, LiveKit, PostgreSQL.
      </div>
    </footer>
  );
}
