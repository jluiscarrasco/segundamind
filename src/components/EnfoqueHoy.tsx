import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Star, ArrowRight, StickyNote, Link2, Timer } from 'lucide-react';
import type { Task, Project, Area, Resource, EntityType } from '@/types';
import { ImportanceBadge, StatusIcon } from './StatusBadges';
import { getTaskDisplayId, getEffortLabel } from '@/types';
import { scoreTaskDetailed } from '@/lib/scoring';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface EnfoqueHoyProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  resources: Resource[];
  onEditEntity: (type: EntityType, id: string) => void;
}

export function EnfoqueHoy({ tasks, projects, areas, resources, onEditEntity }: EnfoqueHoyProps) {
  const topTasks = useMemo(() => {
    return tasks
      .filter(t => t.status !== 'finished')
      .map(t => ({ task: t, breakdown: scoreTaskDetailed(t, projects, areas) }))
      .sort((a, b) => b.breakdown.total - a.breakdown.total)
      .slice(0, 5);
  }, [tasks, projects, areas]);

  const getProjectName = (projectId: string) => projects.find(p => p.id === projectId)?.name || '';
  const getAreaName = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return '';
    return areas.find(a => a.id === project.areaId)?.name || '';
  };

  const getTaskNoteCount = (taskId: string) => resources.filter(r => r.entityId === taskId && r.entityType === 'task' && r.type === 'note').length;
  const getTaskLinkCount = (taskId: string) => resources.filter(r => r.entityId === taskId && r.entityType === 'task' && r.type === 'link').length;

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Star className="w-4 h-4 text-importance-important" />
        <h2 className="text-sm font-semibold text-foreground">Prioridades</h2>
        <span className="text-xs text-muted-foreground ml-auto">Top {topTasks.length} por score de prioridad</span>
      </div>

      <div className="divide-y divide-border">
        {topTasks.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No hay tareas activas. ¡Buen trabajo! 🎉
          </div>
        ) : (
          topTasks.map(({ task, breakdown }, i) => {
            const noteCount = getTaskNoteCount(task.id);
            const linkCount = getTaskLinkCount(task.id);
            const score = breakdown.total;

            return (
              <motion.div
                key={task.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="px-5 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors group cursor-pointer"
                onClick={() => onEditEntity('task', task.id)}
              >
                {/* Score badge with tooltip */}
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 cursor-help ${
                        score >= 100 ? 'bg-importance-critical/15 text-importance-critical' :
                        score >= 60 ? 'bg-importance-important/15 text-importance-important' :
                        score >= 30 ? 'bg-primary/10 text-primary' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {score}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[220px] p-3 space-y-1.5 text-xs">
                      <p className="font-semibold text-foreground mb-1">Desglose de score</p>
                      <p className="text-muted-foreground">{breakdown.baseLabel}</p>
                      {breakdown.urgencyLabel && <p className="text-importance-important">{breakdown.urgencyLabel}</p>}
                      {breakdown.cascadeLabel && <p className="text-primary">{breakdown.cascadeLabel}</p>}
                      {breakdown.multiplierLabel && <p className="text-muted-foreground">{breakdown.multiplierLabel}</p>}
                      <p className="font-semibold text-foreground pt-1 border-t border-border">Total: ({breakdown.base}{breakdown.urgency > 0 ? `+${breakdown.urgency}` : ''}{breakdown.cascade > 0 ? `+${breakdown.cascade}` : ''}) {breakdown.multiplier !== 1 ? `× ${breakdown.multiplier}` : ''} = {score}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <span className="text-[11px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{getTaskDisplayId(projects, task)}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={task.status} />
                    <span className="text-xs font-medium text-foreground truncate">{task.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span
                      className="text-[11px] text-primary hover:underline cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); const project = projects.find(p => p.id === task.projectId); if (project) { const area = areas.find(a => a.id === project.areaId); if (area) onEditEntity('area', area.id); } }}
                    >
                      {getAreaName(task.projectId)}
                    </span>
                    <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                    <span
                      className="text-[11px] text-primary hover:underline cursor-pointer"
                      onClick={(e) => { e.stopPropagation(); onEditEntity('project', task.projectId); }}
                    >
                      {getProjectName(task.projectId)}
                    </span>
                  </div>
                </div>
                {task.effort && (
                  <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                    <Timer className="w-2.5 h-2.5" />
                    {getEffortLabel(task.effort)}
                  </span>
                )}
                {(noteCount > 0 || linkCount > 0) && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {noteCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                        <StickyNote className="w-2.5 h-2.5" /> {noteCount}
                      </span>
                    )}
                    {linkCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[11px] text-primary">
                        <Link2 className="w-2.5 h-2.5" /> {linkCount}
                      </span>
                    )}
                  </div>
                )}
                <ImportanceBadge importance={task.importance} />
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
