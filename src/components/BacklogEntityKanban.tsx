import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { GripVertical, ArrowRight } from 'lucide-react';
import type { Project, Area, EntityType, Importance, Status } from '@/types';
import { ImportanceBadge, StatusIcon } from './StatusBadges';
import { scoreProject, scoreArea } from '@/lib/scoring';
import { getTodayKeyCET } from '@/lib/dateUtils';

type KanbanMode = 'importance' | 'status';
type EntityKind = 'project' | 'area';

interface BacklogEntityKanbanProps {
  entityKind: EntityKind;
  projects: Project[];
  areas: Area[];
  tasks: { projectId: string; status: string }[];
  onEditEntity: (type: EntityType, id: string) => void;
  onUpdateProject?: (id: string, patch: Partial<Project>) => void;
  onUpdateArea?: (id: string, patch: Partial<Area>) => void;
  mode: KanbanMode;
}

const IMPORTANCE_COLUMNS: { key: Importance; label: string; color: string; dotColor: string }[] = [
  { key: 'critical', label: 'Crítico', color: 'bg-importance-critical/10 border-importance-critical/30', dotColor: 'bg-importance-critical' },
  { key: 'important', label: 'Importante', color: 'bg-importance-important/10 border-importance-important/30', dotColor: 'bg-importance-important' },
  { key: 'normal', label: 'Normal', color: 'bg-primary/10 border-primary/30', dotColor: 'bg-primary' },
  { key: 'low', label: 'Baja', color: 'bg-muted border-border', dotColor: 'bg-muted-foreground' },
  { key: 'none', label: 'Sin importancia', color: 'bg-muted border-border', dotColor: 'bg-muted-foreground/50' },
];

const STATUS_COLUMNS: { key: Status; label: string; color: string; dotColor: string }[] = [
  { key: 'funnel', label: 'Embudo', color: 'bg-status-funnel/10 border-status-funnel/30', dotColor: 'bg-status-funnel' },
  { key: 'ready', label: 'Listo', color: 'bg-status-ready/10 border-status-ready/30', dotColor: 'bg-status-ready' },
  { key: 'blocked', label: 'Bloqueado', color: 'bg-status-blocked/10 border-status-blocked/30', dotColor: 'bg-status-blocked' },
  { key: 'waiting', label: 'Esperando', color: 'bg-status-waiting/10 border-status-waiting/30', dotColor: 'bg-status-waiting' },
  { key: 'active', label: 'En Progreso', color: 'bg-status-active/10 border-status-active/30', dotColor: 'bg-status-active' },
];

export function BacklogEntityKanban({ entityKind, projects, areas, tasks, onEditEntity, onUpdateProject, onUpdateArea, mode }: BacklogEntityKanbanProps) {
  const today = getTodayKeyCET();
  const columns = mode === 'importance' ? IMPORTANCE_COLUMNS : STATUS_COLUMNS;

  const activeItems = useMemo(() => {
    if (entityKind === 'project') {
      return projects
        .filter(p => p.status !== 'finished')
        .map(p => ({
          id: p.id,
          name: p.name,
          importance: p.importance,
          status: p.status,
          reviewDate: p.reviewDate,
          score: scoreProject(p, areas),
          subtitle: areas.find(a => a.id === p.areaId)?.name || '',
          badge: p.key,
          taskCount: tasks.filter(t => t.projectId === p.id && t.status !== 'finished').length,
        }));
    }
    return areas
      .filter(a => a.status !== 'finished')
      .map(a => ({
        id: a.id,
        name: a.name,
        importance: a.importance,
        status: a.status,
        reviewDate: a.reviewDate,
        score: scoreArea(a),
        subtitle: '',
        badge: '',
        taskCount: tasks.filter(t => {
          const proj = projects.find(p => p.id === t.projectId);
          return proj?.areaId === a.id && t.status !== 'finished';
        }).length,
        projectCount: projects.filter(p => p.areaId === a.id && p.status !== 'finished').length,
      }));
  }, [entityKind, projects, areas, tasks]);

  const handleDrop = (e: React.DragEvent, targetValue: string) => {
    e.preventDefault();
    const entityId = e.dataTransfer.getData('entityId');
    if (!entityId) return;
    const patch = mode === 'importance'
      ? { importance: targetValue as Importance }
      : { status: targetValue as Status };
    if (entityKind === 'project') onUpdateProject?.(entityId, patch);
    else onUpdateArea?.(entityId, patch);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('entityId', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
      {columns.map(col => {
        const colItems = activeItems
          .filter(item => mode === 'importance' ? item.importance === col.key : item.status === col.key)
          .sort((a, b) => b.score - a.score);

        return (
          <div
            key={col.key}
            className="flex-1 min-w-[240px] max-w-[300px] flex flex-col"
            onDrop={e => handleDrop(e, col.key)}
            onDragOver={handleDragOver}
          >
            <div className={`rounded-xl border ${col.color} px-4 py-3 mb-3`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                <span className="text-sm font-semibold text-foreground">{col.label}</span>
                <span className="text-xs text-muted-foreground">({colItems.length})</span>
              </div>
            </div>

            <div className="space-y-2 flex-1">
              {colItems.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  draggable
                  onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, item.id)}
                  onClick={() => onEditEntity(entityKind, item.id)}
                  className="bg-card border border-border rounded-xl p-3.5 shadow-card hover:shadow-glow/30 cursor-pointer group transition-all hover:border-primary/30 relative"
                >
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    {item.badge && (
                      <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {item.badge}
                      </span>
                    )}
                    {mode === 'status' && <ImportanceBadge importance={item.importance} />}
                    {mode === 'importance' && <StatusIcon status={item.status} />}
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      item.score >= 100 ? 'bg-importance-critical/15 text-importance-critical' :
                      item.score >= 60 ? 'bg-importance-important/15 text-importance-important' :
                      item.score >= 30 ? 'bg-primary/10 text-primary' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {item.score}pts
                    </span>
                  </div>

                  <h4 className="text-sm font-medium text-foreground mb-1 leading-snug">{item.name}</h4>

                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                    {item.subtitle && (
                      <span className="text-[10px] text-muted-foreground truncate flex-1">{item.subtitle}</span>
                    )}
                    <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                      {(item as any).projectCount != null
                        ? `${(item as any).projectCount} proy · ${item.taskCount} tar`
                        : `${item.taskCount} tarea${item.taskCount !== 1 ? 's' : ''}`
                      }
                    </span>
                    {item.reviewDate && (
                      <span className={`text-[10px] shrink-0 ${
                        item.reviewDate < today ? 'text-destructive font-medium' : 'text-muted-foreground'
                      }`}>
                        {item.reviewDate}
                      </span>
                    )}
                  </div>

                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-50 transition-opacity">
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                </motion.div>
              ))}

              {colItems.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/50 py-8 flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">Sin {entityKind === 'project' ? 'proyectos' : 'áreas'}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
