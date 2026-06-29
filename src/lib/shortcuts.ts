export type ShortcutKey = 'CommandPalette' | 'NewTask' | 'ContextPanel' | 'Edit' | 'Delete' | 'Toggle' | 'Help' | 'Escape';

export interface ShortcutBinding {
  key: ShortcutKey;
  name: string;
  description: string;
  keyCombos: KeyCombo[];
  handler?: (e?: KeyboardEvent) => void;
}

export interface KeyCombo {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  code: string; // KeyboardEvent.code
}

export const SHORTCUTS_REGISTRY: Record<ShortcutKey, ShortcutBinding> = {
  CommandPalette: {
    key: 'CommandPalette',
    name: 'Command Palette',
    description: 'Open command palette to search and execute actions',
    keyCombos: [
      { meta: true, code: 'KeyK' },      // Cmd+K (Mac)
      { ctrl: true, code: 'KeyK' },      // Ctrl+K (Windows/Linux)
      { code: 'Slash' },                  // / (alternative)
    ],
  },
  NewTask: {
    key: 'NewTask',
    name: 'New Task',
    description: 'Create a new task in the current project',
    keyCombos: [
      { meta: true, code: 'KeyN' },      // Cmd+N (Mac)
      { ctrl: true, code: 'KeyN' },      // Ctrl+N (Windows/Linux)
    ],
  },
  ContextPanel: {
    key: 'ContextPanel',
    name: 'Toggle Context Panel',
    description: 'Show or hide the context panel',
    keyCombos: [
      { meta: true, shift: true, code: 'KeyK' },   // Cmd+Shift+K (Mac)
      { ctrl: true, shift: true, code: 'KeyK' },   // Ctrl+Shift+K (Windows/Linux)
    ],
  },
  Edit: {
    key: 'Edit',
    name: 'Edit Selected',
    description: 'Edit the currently selected item',
    keyCombos: [
      { code: 'KeyE' },
    ],
  },
  Delete: {
    key: 'Delete',
    name: 'Delete Selected',
    description: 'Delete the currently selected item',
    keyCombos: [
      { code: 'KeyD' },
    ],
  },
  Toggle: {
    key: 'Toggle',
    name: 'Toggle Status',
    description: 'Toggle the status of the current item',
    keyCombos: [
      { code: 'KeyT' },
    ],
  },
  Help: {
    key: 'Help',
    name: 'Show Shortcuts Help',
    description: 'Display the shortcuts help dialog',
    keyCombos: [
      { shift: true, code: 'Slash' },    // Shift+?
    ],
  },
  Escape: {
    key: 'Escape',
    name: 'Close Dialogs',
    description: 'Close all open dialogs and panels',
    keyCombos: [
      { code: 'Escape' },
    ],
  },
};

export function matchesShortcut(event: KeyboardEvent, shortcutKey: ShortcutKey): boolean {
  const binding = SHORTCUTS_REGISTRY[shortcutKey];
  if (!binding) return false;

  return binding.keyCombos.some(combo => {
    const metaMatch = (combo.meta ?? false) === (event.metaKey || event.ctrlKey);
    const ctrlMatch = (combo.ctrl ?? false) === event.ctrlKey;
    const shiftMatch = (combo.shift ?? false) === event.shiftKey;
    const altMatch = (combo.alt ?? false) === event.altKey;
    const codeMatch = event.code === combo.code;

    // For Mac, Cmd+K should match meta+K on Mac (not ctrl+K)
    // For Windows/Linux, Ctrl+K should match ctrl+K (not meta+K)
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

    if (combo.meta && !combo.ctrl) {
      // This is a Mac-style shortcut
      const correctMetaMatch = event.metaKey && !event.ctrlKey;
      return correctMetaMatch && shiftMatch && altMatch && codeMatch;
    }

    if (combo.ctrl && !combo.meta) {
      // This is a Windows/Linux-style shortcut
      const correctCtrlMatch = event.ctrlKey && !event.metaKey;
      return correctCtrlMatch && shiftMatch && altMatch && codeMatch;
    }

    // No modifier specified, just match code
    if (!combo.meta && !combo.ctrl && !combo.shift && !combo.alt) {
      return codeMatch && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    }

    return metaMatch && ctrlMatch && shiftMatch && altMatch && codeMatch;
  });
}

export function getShortcutDisplay(shortcutKey: ShortcutKey): string {
  const binding = SHORTCUTS_REGISTRY[shortcutKey];
  if (!binding || binding.keyCombos.length === 0) return '';

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const combo = binding.keyCombos[0];

  const parts: string[] = [];

  if (combo.meta || combo.ctrl) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }
  if (combo.shift) {
    parts.push('Shift');
  }
  if (combo.alt) {
    parts.push('Alt');
  }

  // Format key name
  let keyName = combo.code;
  if (combo.code === 'KeyK') keyName = 'K';
  else if (combo.code === 'KeyN') keyName = 'N';
  else if (combo.code === 'KeyE') keyName = 'E';
  else if (combo.code === 'KeyD') keyName = 'D';
  else if (combo.code === 'KeyT') keyName = 'T';
  else if (combo.code === 'Slash') keyName = '/';
  else if (combo.code === 'Escape') keyName = 'Esc';

  parts.push(keyName);
  return parts.join('+');
}
