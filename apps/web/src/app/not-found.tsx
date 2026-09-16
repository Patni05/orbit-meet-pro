import Link from 'next/link';
import { Button } from '@/components/ui/primitives';
import { Logo } from '@/components/brand/Logo';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 max-w-sm text-ink-500 dark:text-ink-400">
          The link may be broken, or the page may have moved.
        </p>
      </div>
      <Link href="/">
        <Button>Return home</Button>
      </Link>
    </main>
  );
}
