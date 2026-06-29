import { useEffect, useCallback } from 'react';
import { matchesShortcut, type ShortcutKey } from '@/lib/shortcuts';

type ShortcutHandler = (event: KeyboardEvent) => void | Promise<void>;

interface ShortcutListener {
  shortcutKey: ShortcutKey;
  handler: ShortcutHandler;
  enabled?: boolean;
}

export function useKeyboardShortcuts(listeners: ShortcutListener[]) {
  const handleKeyDown = useCallback(
    async (event: KeyboardEvent) => {
      for (const listener of listeners) {
        if (listener.enabled === false) continue;

        if (matchesShortcut(event, listener.shortcutKey)) {
          try {
            event.preventDefault();
            await listener.handler(event);
          } catch (error) {
            console.error(`Error handling shortcut ${listener.shortcutKey}:`, error);
          }
        }
      }
    },
    [listeners]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleKeyDown]);
}

// Hook for single shortcut
export function useKeyboardShortcut(shortcutKey: ShortcutKey, handler: ShortcutHandler, enabled = true) {
  const handleKeyDown = useCallback(
    async (event: KeyboardEvent) => {
      if (!enabled) return;

      if (matchesShortcut(event, shortcutKey)) {
        try {
          event.preventDefault();
          await handler(event);
        } catch (error) {
          console.error(`Error handling shortcut ${shortcutKey}:`, error);
        }
      }
    },
    [shortcutKey, handler, enabled]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [handleKeyDown]);
}
