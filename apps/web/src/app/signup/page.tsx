'use client';

import { registerSchema } from '@orbit/shared';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AuthShell } from '@/components/auth/AuthShell';
import { Alert, Button, Field, Input } from '@/components/ui/primitives';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/** Live password requirements, so the rules are visible before submitting. */
const RULES = [
  { label: 'At least 10 characters', test: (v: string) => v.length >= 10 },
  { label: 'A lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'An uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'A number', test: (v: string) => /[0-9]/.test(v) },
];

export default function SignupPage() {
  const router = useRouter();
  const register = useAuthStore((state) => state.register);
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && user) router.replace('/dashboard');
  }, [ready, user, router]);

  const ruleState = useMemo(() => RULES.map((rule) => ({ ...rule, met: rule.test(password) })), [password]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = registerSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form';
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      await register(parsed.data.name, parsed.data.email, parsed.data.password);
      router.replace('/dashboard');
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not create your account. Please try again.',
      );
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Free, and takes about thirty seconds."
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {formError && <Alert tone="error">{formError}</Alert>}

        <Field label="Full name" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            invalid={Boolean(errors.name)}
            placeholder="Jordan Ellis"
          />
        </Field>

        <Field label="Email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            invalid={Boolean(errors.email)}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Password" htmlFor="password" error={errors.password}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            invalid={Boolean(errors.password)}
          />
        </Field>

        <ul className="grid grid-cols-2 gap-1.5" aria-label="Password requirements">
          {ruleState.map((rule) => (
            <li
              key={rule.label}
              className={`flex items-center gap-1.5 text-xs ${
                rule.met ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-500 dark:text-ink-400'
              }`}
            >
              <Check className={`h-3.5 w-3.5 ${rule.met ? 'opacity-100' : 'opacity-30'}`} />
              {rule.label}
            </li>
          ))}
        </ul>

        <Button type="submit" fullWidth size="lg" loading={busy}>
          Create account
        </Button>

        <p className="text-center text-xs text-ink-500 dark:text-ink-400">
          Your password is stored only as an Argon2id hash. We never see it.
        </p>
      </form>
    </AuthShell>
  );
}
