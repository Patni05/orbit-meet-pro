'use client';

import { useEffect } from 'react';

export interface ShortcutMap {
  toggleMic: () => void;
  toggleCamera: () => void;
  toggleChat: () => void;
  togglePeople: () => void;
  toggleHand: () => void;
  toggleShare: () => void;
  toggleHelp: () => void;
  leave: () => void;
}

export const SHORTCUTS = [
  { keys: 'M', description: 'Mute or unmute your microphone' },
  { keys: 'V', description: 'Turn your camera on or off' },
  { keys: 'C', description: 'Open or close chat' },
  { keys: 'P', description: 'Open or close the people panel' },
  { keys: 'H', description: 'Raise or lower your hand' },
  { keys: 'S', description: 'Start or stop screen sharing' },
  { keys: '?', description: 'Show this list' },
  { keys: 'Esc', description: 'Close the open panel or dialog' },
] as const;

/**
 * Keyboard shortcuts.
 *
 * Suppressed entirely while the user is typing — in a field, a textarea, or any
 * contenteditable region — so pressing "m" in the chat box types an m rather
 * than muting the microphone. Modifier combinations are left to the browser.
 */
export function useKeyboardShortcuts(handlers: ShortcutMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    function isTyping(target: EventTarget | null): boolean {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        element.isContentEditable ||
        element.getAttribute?.('role') === 'textbox'
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;

      switch (event.key.toLowerCase()) {
        case 'm':
          event.preventDefault();
          handlers.toggleMic();
          break;
        case 'v':
          event.preventDefault();
          handlers.toggleCamera();
          break;
        case 'c':
          event.preventDefault();
          handlers.toggleChat();
          break;
        case 'p':
          event.preventDefault();
          handlers.togglePeople();
          break;
        case 'h':
          event.preventDefault();
          handlers.toggleHand();
          break;
        case 's':
          event.preventDefault();
          handlers.toggleShare();
          break;
        case '?':
          event.preventDefault();
          handlers.toggleHelp();
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers, enabled]);
}
