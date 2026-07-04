import { Zap, Sparkles } from 'lucide-react';
import type { Task, Project, Area, EntityType } from '@/types';
import { getTaskDisplayId, getEffortLabel } from '@/types';
import { ImportanceDot } from './StatusBadges';
import { scoreTaskDetailed } from '@/lib/scoring';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface AhoraFocusProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onEditEntity: (type: EntityType, id: string) => void;
  onCompleteTask: (id: string) => void;
}

/**
 * "Ahora" — the top actionable tasks, so opening the app answers
 * "¿qué hago ahora?" instead of showing passive counters.
 * Only tasks that can actually be started (active / ready), ranked by score.
 */
export function AhoraFocus({ tasks, projects, areas, onEditEntity, onCompleteTask }: AhoraFocusProps) {
  const top = tasks
    .filter(t => t.status === 'active' || t.status === 'ready')
    .map(t => ({ task: t, breakdown: scoreTaskDetailed(t, projects, areas) }))
    .sort((a, b) => b.breakdown.total - a.breakdown.total)
    .slice(0, 3);

  return (
    <section className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Ahora</h2>
        <span className="text-[11px] text-muted-foreground">— empieza por aquí</span>
      </div>

      {top.length === 0 ? (
        <div className="px-4 py-4 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
          <Sparkles className="w-4 h-4 text-primary/50 shrink-0" />
          <span>Nada listo para empezar. Procesa tu bandeja o marca una tarea como «Listo».</span>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {top.map(({ task: t, breakdown }) => {
            const project = projects.find(p => p.id === t.projectId);
            return (
              <div
                key={t.id}
                onClick={() => onEditEntity('task', t.id)}
                className="px-4 py-2 flex items-center gap-2.5 cursor-pointer hover:bg-secondary/50 transition-colors"
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onCompleteTask(t.id); }}
                  title="Marcar como cerrada"
                  className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 hover:border-primary hover:bg-primary/10 shrink-0 transition-colors"
                />
                <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                  {getTaskDisplayId(projects, t)}
                </span>
                <ImportanceDot importance={t.importance} size="sm" />
                <span className="text-xs font-medium text-foreground truncate flex-1">{t.name}</span>
                <span className="text-[11px] text-muted-foreground truncate max-w-[120px] hidden md:block">
                  {project?.name || ''}
                </span>
                {t.effort != null && (
                  <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">{getEffortLabel(t.effort)}</span>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] font-bold text-primary bg-primary/15 px-1.5 py-0.5 rounded shrink-0 cursor-help tabular-nums"
                    >
                      {breakdown.total}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[240px]">
                    <div className="space-y-0.5 text-[11px]">
                      <div className="font-semibold mb-1">Score {breakdown.total} — cómo se calcula</div>
                      <div>{breakdown.baseLabel}</div>
                      {breakdown.urgencyLabel && <div>{breakdown.urgencyLabel}</div>}
                      {breakdown.cascadeLabel && <div>{breakdown.cascadeLabel}</div>}
                      {breakdown.multiplierLabel && <div>Estado: {breakdown.multiplierLabel}</div>}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
