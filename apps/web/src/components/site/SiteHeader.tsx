'use client';

import clsx from 'clsx';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/primitives';
import { useAuthStore } from '@/lib/auth-store';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/dashboard', label: 'Meetings' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/help', label: 'Help' },
];

export function SiteHeader() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/80 backdrop-blur-lg dark:border-white/10 dark:bg-ink-900/80">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="rounded-lg" aria-label="Orbit home">
          <Logo />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className={clsx(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  pathname === item.href
                    ? 'bg-ink-100 text-ink-900 dark:bg-white/10 dark:text-white'
                    : 'text-ink-600 hover:bg-ink-50 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-white',
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-2 md:flex">
          {/* Nothing is rendered until hydration settles, so the header never
              flashes "Sign in" at somebody who is already signed in. */}
          {!ready ? (
            <div className="h-9 w-32 animate-pulse rounded-lg bg-ink-100 dark:bg-white/10" />
          ) : user ? (
            <Link href="/dashboard" className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-ink-50 dark:hover:bg-white/5">
              <Avatar name={user.name} src={user.avatarUrl} seed={user.id} size="sm" />
              <span className="max-w-32 truncate text-sm font-medium">{user.name}</span>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">
                  Log in
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="sm">Sign up</Button>
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="rounded-lg p-2 text-ink-600 hover:bg-ink-100 md:hidden dark:text-ink-300 dark:hover:bg-white/10"
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-ink-100 px-4 pb-4 pt-2 md:hidden dark:border-white/10">
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-ink-700 hover:bg-ink-50 dark:text-ink-200 dark:hover:bg-white/5"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            {user ? (
              <Link href="/dashboard" className="flex-1" onClick={() => setOpen(false)}>
                <Button fullWidth>Go to dashboard</Button>
              </Link>
            ) : (
              <>
                <Link href="/login" className="flex-1" onClick={() => setOpen(false)}>
                  <Button variant="secondary" fullWidth>
                    Log in
                  </Button>
                </Link>
                <Link href="/signup" className="flex-1" onClick={() => setOpen(false)}>
                  <Button fullWidth>Sign up</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
