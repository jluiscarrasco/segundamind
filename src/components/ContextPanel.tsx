import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, Trash2, Edit2 } from 'lucide-react';
import type { Task, Project, Area, EntityType } from '@/types';
import { ImportanceDot } from './StatusBadges';

interface ContextPanelProps {
  isOpen: boolean;
  entityType: EntityType | null;
  entityId: string | null;
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onClose: () => void;
  onEdit: (type: EntityType, id: string) => void;
  onDelete: (type: EntityType, id: string) => void;
}

export function ContextPanel({
  isOpen,
  entityType,
  entityId,
  tasks,
  projects,
  areas,
  onClose,
  onEdit,
  onDelete,
}: ContextPanelProps) {
  const getEntity = () => {
    if (!entityType || !entityId) return null;
    if (entityType === 'task') return tasks.find(t => t.id === entityId);
    if (entityType === 'project') return projects.find(p => p.id === entityId);
    if (entityType === 'area') return areas.find(a => a.id === entityId);
    return null;
  };

  const entity = getEntity();

  const getParentInfo = () => {
    if (!entity) return null;
    if (entityType === 'task' && 'projectId' in entity) {
      const project = projects.find(p => p.id === (entity as Task).projectId);
      if (project) {
        const area = areas.find(a => a.id === project.areaId);
        return { area: area?.name || 'Unknown', project: project.name };
      }
    }
    if (entityType === 'project' && 'areaId' in entity) {
      const area = areas.find(a => a.id === (entity as Project).areaId);
      return { area: area?.name || 'Unknown' };
    }
    return null;
  };

  const parent = getParentInfo();

  return (
    <AnimatePresence>
      {isOpen && entity && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: 'spring', damping: 30 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-96 bg-card border-l border-border shadow-xl overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-card/80 backdrop-blur-sm px-6 py-4 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <ImportanceDot importance={'importance' in entity ? entity.importance : 'normal'} size="md" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground truncate">{entity.name}</h2>
                  <p className="text-xs text-muted-foreground">{entityType}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-4 space-y-4">
              {/* Parent Info */}
              {parent && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Location</p>
                  <div className="space-y-1">
                    {parent.area && (
                      <div className="text-sm text-foreground flex items-center gap-1">
                        <span className="text-muted-foreground">📁</span> {parent.area}
                      </div>
                    )}
                    {parent.project && (
                      <div className="text-sm text-foreground flex items-center gap-1 ml-4">
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                        {parent.project}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Description */}
              {entity.description && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Description</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{entity.description}</p>
                </div>
              )}

              {/* Properties */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Properties</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-medium text-foreground capitalize">{entity.status}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Importance</span>
                    <span className="font-medium text-foreground capitalize">
                      {'importance' in entity ? entity.importance : 'N/A'}
                    </span>
                  </div>
                  {entity.reviewDate && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Review Date</span>
                      <span className="font-medium text-foreground">{entity.reviewDate}</span>
                    </div>
                  )}
                  {'effort' in entity && entity.effort && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Effort</span>
                      <span className="font-medium text-foreground">{entity.effort}h</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="sticky bottom-0 bg-card/80 backdrop-blur-sm px-6 py-4 border-t border-border flex items-center gap-2">
              <button
                onClick={() => {
                  onEdit(entityType!, entityId!);
                  onClose();
                }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </button>
              <button
                onClick={() => {
                  onDelete(entityType!, entityId!);
                  onClose();
                }}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors text-sm font-medium"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
