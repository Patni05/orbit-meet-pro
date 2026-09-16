'use client';

import { passwordSchema } from '@orbit/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { ApiError, api } from '@/lib/api';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That password is not strong enough.');
      return;
    }

    setBusy(true);
    try {
      await api.auth.resetPassword({ token, password: parsed.data });
      setDone(true);
      setTimeout(() => router.replace('/login'), 2200);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not reset your password. Request a new link.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="Reset link is incomplete">
        <Alert tone="error">
          This link is missing its token. Request a new one from the{' '}
          <Link href="/forgot-password" className="font-medium underline">
            forgot password
          </Link>{' '}
          page.
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle="Signing you out of every device afterwards.">
      {done ? (
        <Alert tone="success" title="Password updated">
          Taking you to the sign-in page…
        </Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}

          <Field label="New password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          <Field label="Confirm new password" htmlFor="confirm">
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </Field>

          <Button type="submit" fullWidth size="lg" loading={busy}>
            Update password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
