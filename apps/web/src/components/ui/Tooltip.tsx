'use client';

import clsx from 'clsx';
import { useId, useState, type ReactNode } from 'react';

/**
 * Tooltip.
 *
 * Shows on hover and on keyboard focus, and is wired with aria-describedby so
 * assistive technology reads the same hint sighted users get. Suppressed on
 * touch devices, where there is no hover and the label would block a tap.
 */
export function Tooltip({
  label,
  shortcut,
  side = 'top',
  children,
  disabled,
}: {
  label: string;
  /** Rendered as a key hint, e.g. "M". */
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  } as const;

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        setVisible(true);
      }}
      onPointerLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
    >
      <span aria-describedby={visible ? id : undefined} className="contents">
        {children}
      </span>

      {visible && !disabled && (
        <span
          id={id}
          role="tooltip"
          className={clsx(
            'pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5',
            'bg-ink-900 text-xs font-medium text-white shadow-lg ring-1 ring-white/10',
            'animate-[fade-in_0.12s_ease-out]',
            positions[side],
          )}
        >
          {label}
          {shortcut && (
            <kbd className="rounded border border-white/20 bg-white/10 px-1 font-mono text-[10px] leading-4">
              {shortcut}
            </kbd>
          )}
        </span>
      )}
    </span>
  );
}
