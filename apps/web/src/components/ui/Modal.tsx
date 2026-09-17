'use client';

import clsx from 'clsx';
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useViewportHeight } from '@/hooks/useViewportHeight';

/**
 * Accessible dialog.
 *
 * Traps focus while open, restores it to the trigger on close, closes on
 * Escape and on backdrop click, and locks background scrolling. Rendered into
 * a portal so a dialog opened from inside the video grid is not clipped by it.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeOnBackdrop?: boolean;
}) {
  // Dialogs open on pages that are not the meeting shell, so the modal keeps
  // the keyboard-aware height published itself rather than assuming.
  useViewportHeight();

  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!open) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);

    /*
     * Move focus into the dialog, preferring whatever the user came here to
     * fill in.
     *
     * The field selector is separate from, and tried before, the general one
     * on purpose. It used to be a single list that did not mention `textarea`,
     * so a dialog whose only field was one — the announcement composer — put
     * focus on the Cancel button instead. On a desktop that is merely wrong;
     * on a phone no keyboard opens and the dialog looks like it will not let
     * you type at all.
     */
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;

      const field = panel.querySelector<HTMLElement>(
        'textarea:not([disabled]), input:not([disabled]):not([type="checkbox"]):not([type="radio"]), select:not([disabled])',
      );
      const fallback = panel.querySelector<HTMLElement>(
        'button:not([disabled]):not([data-close]), [tabindex]:not([tabindex="-1"])',
      );

      (field ?? fallback ?? panel).focus();
    }, 20);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = overflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, handleKeyDown]);

  if (!open || typeof document === 'undefined') return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

  return createPortal(
    /*
     * Sized from the visual viewport, not the layout viewport.
     *
     * `inset-0` follows the layout viewport, which does not shrink when the
     * on-screen keyboard opens — so a bottom-sheet dialog with a text field
     * put that field underneath the keyboard. `--app-height` is published by
     * useViewportHeight and falls back to `100dvh` where the API is missing.
     */
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ height: 'var(--app-height, 100dvh)' }}
    >
      <div
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={clsx(
          'relative w-full animate-fade-in rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl',
          'max-h-full overflow-y-auto scrollbar-slim dark:bg-ink-850 dark:text-ink-50',
          widths[size],
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">{description}</p>}
          </div>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/10 dark:hover:text-ink-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {children}

        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
