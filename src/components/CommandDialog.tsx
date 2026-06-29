import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, FileText, ListChecks, FolderOpen, Zap, Plus, MoreHorizontal } from 'lucide-react';
import type { Task, Project, Area, EntityType } from '@/types';
import { useCommandPalette } from '@/hooks/useCommandPalette';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  category: 'action' | 'task' | 'project' | 'area';
  handler: () => void;
  shortcut?: string;
}

interface CommandDialogProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  isOpen: boolean;
  onClose: () => void;
  onEditEntity: (type: EntityType, id: string) => void;
  onCreateTask: (projectId: string) => void;
  onCreateProject: (areaId: string) => void;
  onCreateArea: () => void;
}

export function CommandDialog({
  tasks,
  projects,
  areas,
  isOpen,
  onClose,
  onEditEntity,
  onCreateTask,
  onCreateProject,
  onCreateArea,
}: CommandDialogProps) {
  const { searchQuery, selectedIndex, setSearchQuery, moveSelection, close } = useCommandPalette();

  // Build command items
  const items = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      {
        id: 'new-task',
        label: 'New Task',
        description: 'Create a new task in the current project',
        icon: <Plus className="w-4 h-4" />,
        category: 'action',
        handler: () => {
          // Will be handled by parent
          close();
          onClose();
        },
        shortcut: 'Cmd+N',
      },
      {
        id: 'new-project',
        label: 'New Project',
        description: 'Create a new project',
        icon: <FolderOpen className="w-4 h-4" />,
        category: 'action',
        handler: () => {
          // Will be handled by parent
          close();
          onClose();
        },
      },
      {
        id: 'new-area',
        label: 'New Area',
        description: 'Create a new area',
        icon: <FolderOpen className="w-4 h-4" />,
        category: 'action',
        handler: () => {
          onCreateArea();
          close();
          onClose();
        },
      },
    ];

    // Add recent tasks
    const recentTasks: CommandItem[] = tasks
      .slice(0, 5)
      .map(task => ({
        id: task.id,
        label: task.name,
        description: `Task • ${task.status}`,
        icon: <ListChecks className="w-4 h-4" />,
        category: 'task' as const,
        handler: () => {
          onEditEntity('task', task.id);
          close();
          onClose();
        },
      }));

    // Add recent projects
    const recentProjects: CommandItem[] = projects
      .slice(0, 5)
      .map(project => ({
        id: project.id,
        label: project.name,
        description: `Project • ${project.status}`,
        icon: <FolderOpen className="w-4 h-4" />,
        category: 'project' as const,
        handler: () => {
          onEditEntity('project', project.id);
          close();
          onClose();
        },
      }));

    // Add areas
    const areaItems: CommandItem[] = areas.map(area => ({
      id: area.id,
      label: area.name,
      description: `Area • ${area.status}`,
      icon: <FolderOpen className="w-4 h-4" />,
      category: 'area' as const,
      handler: () => {
        onEditEntity('area', area.id);
        close();
        onClose();
      },
    }));

    // Filter by search query
    if (!searchQuery) {
      return [...base, ...recentTasks, ...recentProjects, ...areaItems];
    }

    const query = searchQuery.toLowerCase();
    const filtered = [...base, ...recentTasks, ...recentProjects, ...areaItems].filter(item =>
      item.label.toLowerCase().includes(query) || item.description?.toLowerCase().includes(query)
    );

    return filtered;
  }, [tasks, projects, areas, searchQuery, onEditEntity, onCreateArea, close, onClose]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection('down', items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection('up', items.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[selectedIndex]) {
          items[selectedIndex].handler();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, items, selectedIndex, moveSelection, onClose]);

  // Auto-focus search input
  useEffect(() => {
    if (isOpen) {
      const input = document.getElementById('command-palette-input');
      input?.focus();
    }
  }, [isOpen]);

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'action':
        return 'bg-primary/10 text-primary';
      case 'task':
        return 'bg-blue-500/10 text-blue-600';
      case 'project':
        return 'bg-purple-500/10 text-purple-600';
      case 'area':
        return 'bg-amber-500/10 text-amber-600';
      default:
        return 'bg-secondary text-secondary-foreground';
    }
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
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            className="fixed top-1/4 left-1/2 -translate-x-1/2 z-50 w-full max-w-xl"
          >
            <div className="bg-card rounded-xl border border-border shadow-xl overflow-hidden">
              {/* Search Input */}
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  id="command-palette-input"
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search tasks, projects, areas..."
                  className="flex-1 bg-transparent text-sm text-foreground outline-none"
                />
              </div>

              {/* Results */}
              <div className="max-h-96 overflow-y-auto divide-y divide-border">
                {items.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No items found.
                  </div>
                ) : (
                  items.map((item, idx) => (
                    <motion.button
                      key={item.id}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      onClick={() => {
                        item.handler();
                      }}
                      className={`w-full px-4 py-3 flex items-center gap-3 transition-colors text-left ${
                        idx === selectedIndex ? 'bg-primary/10' : 'hover:bg-secondary'
                      }`}
                    >
                      <div className="text-muted-foreground">{item.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{item.label}</div>
                        {item.description && (
                          <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                        )}
                      </div>
                      <div className={`text-[11px] font-medium px-2 py-1 rounded shrink-0 ${getCategoryColor(item.category)}`}>
                        {item.category}
                      </div>
                      {item.shortcut && <div className="text-[11px] text-muted-foreground">{item.shortcut}</div>}
                    </motion.button>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-2 bg-secondary/30 border-t border-border text-[11px] text-muted-foreground flex items-center gap-2">
                <span>Use ↑↓ to navigate, ↵ to select, Esc to close</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
