'use client';

import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { ErrorBoundary } from './ErrorBoundary';

/**
 * Client-side bootstrap.
 *
 * Restores the session once on mount by exchanging the refresh cookie, and
 * wraps the tree in an error boundary so one broken component cannot take the
 * whole application down.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return <ErrorBoundary>{children}</ErrorBoundary>;
}
