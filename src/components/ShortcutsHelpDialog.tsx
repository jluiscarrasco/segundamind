import { motion, AnimatePresence } from 'framer-motion';
import { X, BookOpen } from 'lucide-react';
import { SHORTCUTS_REGISTRY, getShortcutDisplay } from '@/lib/shortcuts';

interface ShortcutsHelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsHelpDialog({ isOpen, onClose }: ShortcutsHelpDialogProps) {
  const shortcuts = Object.values(SHORTCUTS_REGISTRY).filter(s => s.key !== 'Escape');

  const categories = {
    action: 'Actions',
    task: 'Tasks',
    project: 'Projects',
    area: 'Areas',
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/50"
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-card rounded-xl border border-border shadow-xl overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Keyboard Shortcuts</h2>
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="max-h-96 overflow-y-auto p-6 space-y-6">
              {Object.entries(categories).map(([category, categoryName]) => {
                const categoryShortcuts = shortcuts.filter(s => s.key && SHORTCUTS_REGISTRY[s.key]?.key && category === 'action' ? s.category === 'action' : true).filter(s => {
                  const binding = SHORTCUTS_REGISTRY[s.key];
                  return binding && binding.keyCombos && binding.keyCombos.length > 0;
                });

                // Get shortcuts for this category
                const categoryItems = Object.values(SHORTCUTS_REGISTRY).filter(s => {
                  if (s.key === 'Escape') return false;
                  if (category === 'action' && s.key === 'CommandPalette') return true;
                  if (category === 'action' && s.key === 'NewTask') return true;
                  if (category === 'action' && s.key === 'ContextPanel') return true;
                  if (category === 'action' && s.key === 'Help') return true;
                  if (category === 'action' && s.key === 'Edit') return true;
                  if (category === 'action' && s.key === 'Delete') return true;
                  if (category === 'action' && s.key === 'Toggle') return true;
                  return false;
                });

                if (categoryItems.length === 0) return null;

                return (
                  <div key={category}>
                    <h3 className="text-sm font-semibold text-foreground mb-3">{categoryName}</h3>
                    <div className="space-y-2">
                      {categoryItems.map(shortcut => (
                        <div
                          key={shortcut.key}
                          className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                        >
                          <div>
                            <p className="text-sm font-medium text-foreground">{shortcut.name}</p>
                            <p className="text-xs text-muted-foreground">{shortcut.description}</p>
                          </div>
                          <div className="flex items-center gap-1">
                            {shortcut.keyCombos.map((combo, idx) => (
                              <div
                                key={idx}
                                className="px-2 py-1 rounded bg-background border border-border text-xs font-mono font-semibold text-foreground"
                              >
                                {getShortcutDisplay(shortcut.key)}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Escape key */}
              <div className="pt-4 border-t border-border">
                <h3 className="text-sm font-semibold text-foreground mb-3">General</h3>
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/30">
                  <div>
                    <p className="text-sm font-medium text-foreground">Close Dialogs</p>
                    <p className="text-xs text-muted-foreground">Close all open dialogs and panels</p>
                  </div>
                  <div className="px-2 py-1 rounded bg-background border border-border text-xs font-mono font-semibold text-foreground">
                    Esc
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-secondary/30 border-t border-border text-xs text-muted-foreground text-center">
              Pro tip: Use Cmd+K or / to open the command palette and search for actions
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
