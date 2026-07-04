import { motion } from 'framer-motion';
import { Zap, Sparkles } from 'lucide-react';
import type { Task, Project, Area, EntityType } from '@/types';
import { getTaskDisplayId, getEffortLabel } from '@/types';
import { ImportanceBadge } from './StatusBadges';
import { scoreTaskDetailed } from '@/lib/scoring';

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
    .map(t => ({ task: t, score: scoreTaskDetailed(t, projects, areas).total }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return (
    <section className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Zap className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Ahora</h2>
        <span className="text-[11px] text-muted-foreground">— empieza por aquí</span>
      </div>

      {top.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary/50" />
          <span>Nada listo para empezar. Procesa tu bandeja o marca una tarea como «Listo».</span>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {top.map((item, i) => {
            const t = item.task;
            const project = projects.find(p => p.id === t.projectId);
            const area = project ? areas.find(a => a.id === project.areaId) : null;
            const isFirst = i === 0;
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => onEditEntity('task', t.id)}
                className={`px-5 flex items-center gap-3 cursor-pointer transition-colors group ${
                  isFirst ? 'py-4 bg-primary/5 hover:bg-primary/10' : 'py-3 hover:bg-secondary/50'
                }`}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onCompleteTask(t.id); }}
                  title="Marcar como cerrada"
                  className="w-5 h-5 rounded-full border-2 border-muted-foreground/40 hover:border-primary hover:bg-primary/10 shrink-0 transition-colors"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                      {getTaskDisplayId(projects, t)}
                    </span>
                    <span className={`font-medium text-foreground truncate ${isFirst ? 'text-sm' : 'text-xs'}`}>
                      {t.name}
                    </span>
                  </div>
                  {(area || project) && (
                    <span className="text-[11px] text-muted-foreground truncate block mt-0.5">
                      {area?.name || ''}{area && project ? ' › ' : ''}{project?.name || ''}
                    </span>
                  )}
                </div>
                <ImportanceBadge importance={t.importance} />
                {t.effort != null && (
                  <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">
                    {getEffortLabel(t.effort)}
                  </span>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </section>
  );
}
