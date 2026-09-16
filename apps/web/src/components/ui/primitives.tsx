'use client';

import clsx from 'clsx';
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

/**
 * Shared interface primitives.
 *
 * Each one carries its own accessible wiring — label associations, error
 * announcement, disabled semantics — so a screen-reader-correct form is the
 * default rather than something each page has to remember.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-[background-color,color,box-shadow,transform] duration-150 ' +
  'disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-500 focus-visible:outline-brand-400 disabled:hover:bg-brand-600',
  secondary:
    'border border-ink-200 bg-white text-ink-800 hover:bg-ink-50 focus-visible:outline-brand-400 ' +
    'dark:border-white/15 dark:bg-white/5 dark:text-ink-50 dark:hover:bg-white/10',
  ghost: 'text-ink-700 hover:bg-ink-100 focus-visible:outline-brand-400 dark:text-ink-100 dark:hover:bg-white/10',
  danger: 'bg-danger-600 text-white hover:bg-danger-500 focus-visible:outline-danger-400',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 focus-visible:outline-brand-400',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, fullWidth, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(buttonBase, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, error, hint, children, className }: FieldProps) {
  return (
    <div className={clsx('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-700 dark:text-ink-200">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-ink-500 dark:text-ink-400">{hint}</p>}
      {/* role=alert so the message is announced the moment validation fails. */}
      {error && (
        <p role="alert" className="text-xs font-medium text-danger-600 dark:text-danger-400">
          {error}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(
        'h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-ink-900 placeholder:text-ink-400',
        'transition-colors focus:outline-2 focus:outline-offset-0 focus:outline-brand-500',
        'dark:bg-ink-850 dark:text-ink-50 dark:placeholder:text-ink-500',
        invalid
          ? 'border-danger-500 focus:outline-danger-500'
          : 'border-ink-200 hover:border-ink-300 dark:border-white/15 dark:hover:border-white/25',
        className,
      )}
      {...rest}
    />
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={clsx(
        'h-11 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm text-ink-900',
        'focus:outline-2 focus:outline-brand-500 disabled:opacity-60',
        'dark:border-white/15 dark:bg-ink-850 dark:text-ink-50',
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink-800 dark:text-ink-100">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs text-ink-500 dark:text-ink-400">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-ink-300 dark:bg-ink-600',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5.5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-ink-100 text-ink-700 dark:bg-white/10 dark:text-ink-200',
    brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300',
    success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    danger: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  } as const;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Message shown where content would be, when there is none. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && <div className="text-ink-400 dark:text-ink-500">{icon}</div>}
      <div>
        <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{title}</p>
        {description && <p className="mt-1 max-w-sm text-sm text-ink-500 dark:text-ink-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Alert({
  tone = 'error',
  title,
  children,
}: {
  tone?: 'error' | 'warning' | 'info' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    error: 'border-danger-500/30 bg-danger-500/10 text-danger-700 dark:text-danger-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    info: 'border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  } as const;

  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('rounded-xl border px-4 py-3 text-sm', tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={clsx(title && 'mt-0.5')}>{children}</div>
    </div>
  );
}
