'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Keyboard command palette.
 *
 * Every entry here runs the same function the corresponding button runs, so
 * the palette can never drift into offering something the UI cannot do — and
 * host-only commands are simply absent for participants rather than present
 * and refused.
 *
 * Opened with Ctrl/Cmd+K. Rendered in a portal so it is never clipped by a
 * panel's overflow, and focus moves into the input immediately because the
 * whole point is to type.
 */

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  /** Extra words that should match this command without cluttering the label. */
  keywords?: string;
  run: () => void;
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.keywords ?? ''}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // A frame's delay lets the portal mount before focus moves.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const node = listRef.current?.children[active] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open || typeof document === 'undefined') return null;

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(matches.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = matches[active];
      if (command) {
        command.run();
        onClose();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-ink-950/70 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-2xl"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          aria-label="Search commands"
          // Combobox semantics so a screen reader announces the result count
          // and the active option as the user arrows through.
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={matches[active] ? `command-${matches[active].id}` : undefined}
          className="w-full border-b border-white/10 bg-transparent px-4 py-3.5 text-sm text-ink-50 placeholder:text-ink-500 focus:outline-none"
        />

        <ul
          ref={listRef}
          id="command-palette-list"
          role="listbox"
          className="max-h-80 overflow-y-auto scrollbar-slim p-1.5"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-ink-500">No matching command.</li>
          ) : (
            matches.map((command, index) => (
              <li
                key={command.id}
                id={`command-${command.id}`}
                role="option"
                aria-selected={index === active}
              >
                <button
                  type="button"
                  onMouseEnter={() => setActive(index)}
                  onClick={() => {
                    command.run();
                    onClose();
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    index === active ? 'bg-brand-600 text-white' : 'text-ink-200 hover:bg-white/5'
                  }`}
                >
                  {command.icon && <span className="shrink-0 opacity-80">{command.icon}</span>}
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.hint && (
                    <kbd
                      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        index === active ? 'border-white/30 text-white/80' : 'border-white/15 text-ink-500'
                      }`}
                    >
                      {command.hint}
                    </kbd>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>

        <p className="border-t border-white/10 px-4 py-2 text-[11px] text-ink-500">
          ↑↓ to move · Enter to run · Esc to close
        </p>
      </div>
    </div>,
    document.body,
  );
}
