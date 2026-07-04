import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Timer, GripVertical } from 'lucide-react';
import type { Task, Project, Area, EntityType, Importance, Status } from '@/types';
import { getTaskDisplayId, getEffortLabel } from '@/types';
import { ImportanceBadge, StatusIcon } from './StatusBadges';
import { scoreTask } from '@/lib/scoring';
import { getTodayKeyCET } from '@/lib/dateUtils';

type KanbanMode = 'importance' | 'status';

interface BacklogKanbanProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onEditEntity: (type: EntityType, id: string) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
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

export function BacklogKanban({ tasks, projects, areas, onEditEntity, onUpdateTask, mode }: BacklogKanbanProps) {
  const today = getTodayKeyCET();

  const activeTasks = useMemo(() =>
    tasks.filter(t => t.status !== 'finished'),
    [tasks]
  );

  const getProjectName = (projectId: string) => projects.find(p => p.id === projectId)?.name || '';
  const getAreaName = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return '';
    return areas.find(a => a.id === project.areaId)?.name || '';
  };

  const handleDrop = (e: React.DragEvent, targetValue: string) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (!taskId) return;
    if (mode === 'importance') {
      onUpdateTask(taskId, { importance: targetValue as Importance });
    } else {
      onUpdateTask(taskId, { status: targetValue as Status });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const columns = mode === 'importance' ? IMPORTANCE_COLUMNS : STATUS_COLUMNS;

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
      {columns.map(col => {
        const colTasks = activeTasks
          .filter(t => mode === 'importance' ? t.importance === col.key : t.status === col.key)
          .sort((a, b) => scoreTask(b, projects, areas) - scoreTask(a, projects, areas));

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
                <span className="text-xs text-muted-foreground">({colTasks.length})</span>
              </div>
            </div>

            <div className="space-y-2 flex-1">
              {colTasks.map((task, i) => {
                const score = scoreTask(task, projects, areas);
                return (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    draggable
                    onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, task.id)}
                    onClick={() => onEditEntity('task', task.id)}
                    className="bg-card border border-border rounded-xl p-3.5 shadow-card hover:shadow-glow/30 cursor-pointer group transition-all hover:border-primary/30 relative"
                  >
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {getTaskDisplayId(projects, task)}
                      </span>
                      {mode === 'status' && <ImportanceBadge importance={task.importance} />}
                      {mode === 'importance' && <StatusIcon status={task.status} />}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        score >= 100 ? 'bg-importance-critical/15 text-importance-critical' :
                        score >= 60 ? 'bg-importance-important/15 text-importance-important' :
                        score >= 30 ? 'bg-primary/10 text-primary' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {score}pts
                      </span>
                    </div>

                    <h4 className="text-sm font-medium text-foreground mb-1 leading-snug">{task.name}</h4>

                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <span className="text-[10px] text-muted-foreground truncate">{getAreaName(task.projectId)}</span>
                        <ArrowRight className="w-2 h-2 text-muted-foreground shrink-0" />
                        <span className="text-[10px] text-muted-foreground truncate">{getProjectName(task.projectId)}</span>
                      </div>
                      {task.effort && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
                          <Timer className="w-2.5 h-2.5" />
                          {getEffortLabel(task.effort)}
                        </span>
                      )}
                      {task.reviewDate && (
                        <span className={`text-[10px] shrink-0 ${
                          task.reviewDate < today ? 'text-destructive font-medium' : 'text-muted-foreground'
                        }`}>
                          {task.reviewDate}
                        </span>
                      )}
                    </div>

                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-50 transition-opacity">
                      <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </motion.div>
                );
              })}

              {colTasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/50 py-8 flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">Sin tareas</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
