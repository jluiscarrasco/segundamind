import { Zap, AlertTriangle, Clock, CalendarOff, CheckCircle2 } from 'lucide-react';
import type { Task, Project, Area, EntityType } from '@/types';
import { getTaskDisplayId, getEffortLabel } from '@/types';
import { ImportanceDot, StatusIcon } from './StatusBadges';
import { scoreTaskDetailed } from '@/lib/scoring';
import { getTodayKeyCET } from '@/lib/dateUtils';
import type { QuickView } from '@/lib/quickViews';
import { QUICK_VIEW_LABELS } from '@/lib/quickViews';
import { QuickTaskEdit } from './QuickTaskEdit';

const VIEW_META: Record<QuickView, { Icon: typeof Zap; accent: string }> = {
  today: { Icon: Zap, accent: 'text-primary' },
  overdue: { Icon: AlertTriangle, accent: 'text-destructive' },
  waiting: { Icon: Clock, accent: 'text-status-waiting' },
  undated: { Icon: CalendarOff, accent: 'text-muted-foreground' },
};

interface QuickTaskListProps {
  view: QuickView;
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onEditEntity: (type: EntityType, id: string) => void;
  onPostpone: (type: 'task', id: string, days: number) => void;
  onCompleteTask: (id: string) => void;
  onQuickEdit?: (id: string, field: keyof Task, value: any) => void;
}

export function QuickTaskList({ view, tasks, projects, areas, onEditEntity, onPostpone, onCompleteTask, onQuickEdit }: QuickTaskListProps) {
  const { Icon, accent } = VIEW_META[view];
  const todayKey = getTodayKeyCET();

  const sorted = [...tasks].sort(
    (a, b) => scoreTaskDetailed(b, projects, areas).total - scoreTaskDetailed(a, projects, areas).total
  );

  const formatDate = (d: string | null) => {
    if (!d) return 'Sin fecha';
    if (d === todayKey) return 'Hoy';
    if (d < todayKey) {
      const diff = Math.floor((new Date(todayKey + 'T00:00:00').getTime() - new Date(d + 'T00:00:00').getTime()) / 86400000);
      return diff === 1 ? 'Ayer' : `Hace ${diff}d`;
    }
    return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Icon className={`w-4 h-4 ${accent}`} />
        <h2 className="text-sm font-semibold text-foreground">{QUICK_VIEW_LABELS[view]}</h2>
        <span className="text-[11px] text-muted-foreground">({sorted.length})</span>
      </div>

      {sorted.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-primary/50" />
          <span>Nada por aquí. 🎉</span>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {sorted.map((t) => {
            const project = projects.find(p => p.id === t.projectId);
            const area = project ? areas.find(a => a.id === project.areaId) : null;
            const isOverdue = !!t.reviewDate && t.reviewDate < todayKey;
            return (
              <div
                key={t.id}
                onClick={() => onEditEntity('task', t.id)}
                className="px-4 py-2 flex items-center gap-2.5 cursor-pointer hover:bg-secondary/50 transition-colors group"
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
                <span className="text-[11px] text-muted-foreground truncate max-w-[140px] hidden md:block">
                  {area?.name || ''}{area && project ? ' › ' : ''}{project?.name || ''}
                </span>
                {t.status !== 'active' && t.status !== 'ready' && <StatusIcon status={t.status} />}
                {t.effort != null && (
                  <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">{getEffortLabel(t.effort)}</span>
                )}
                <span className={`text-[11px] font-medium shrink-0 ${isOverdue ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {formatDate(t.reviewDate)}
                </span>
                <div
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <QuickTaskEdit
                    task={t}
                    projects={projects}
                    areas={areas}
                    onUpdate={(field, value) => onQuickEdit?.(t.id, field, value)}
                    layout="hover"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
