import { motion } from 'framer-motion';
import { Layers, FolderKanban, CalendarClock } from 'lucide-react';
import type { Area, Project, Task, EntityType } from '@/types';
import { ImportanceBadge, StatusIcon } from './StatusBadges';
import { getTaskDisplayId } from '@/types';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { computeAreaHealth, type AreaHealth, type HealthLevel } from '@/lib/scoring';
import { getTodayKeyCET } from '@/lib/dateUtils';

interface AreaHealthCardsProps {
  areas: Area[];
  projects: Project[];
  tasks: Task[];
  onSelectArea: (id: string) => void;
  onEditEntity: (type: EntityType, id: string) => void;
}

const LEVEL_CONFIG: Record<HealthLevel, { label: string; color: string; bg: string }> = {
  healthy: { label: 'Saludable', color: 'text-status-active', bg: 'bg-status-active/15' },
  warning: { label: 'Atención', color: 'text-status-blocked', bg: 'bg-status-blocked/15' },
  critical: { label: 'Crítico', color: 'text-destructive', bg: 'bg-destructive/15' },
};

function HealthBar({ health }: { health: AreaHealth }) {
  const { segments, total } = health;
  if (total === 0) return <div className="h-2 rounded-full bg-secondary w-full" />;

  const nonFinished = total - segments.finished;
  if (nonFinished === 0) return <div className="h-2 rounded-full bg-status-active/30 w-full" />;

  const bars = [
    { count: segments.active, color: 'bg-status-active', label: 'Activas' },
    { count: segments.waiting, color: 'bg-status-funnel', label: 'En embudo' },
    { count: segments.blocked, color: 'bg-status-blocked', label: 'Bloqueadas' },
  ].filter(b => b.count > 0);

  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-secondary w-full gap-px">
      {bars.map((bar, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(bar.count / nonFinished) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.1, ease: 'easeOut' }}
              className={`${bar.color} h-full min-w-[3px] rounded-full`}
            />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {bar.count} {bar.label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function ScoreBadge({ health }: { health: AreaHealth }) {
  const config = LEVEL_CONFIG[health.level];
  return (
    <div className="flex items-center gap-2">
      <span className={`text-lg font-bold tabular-nums ${config.color}`}>
        {health.score}
      </span>
      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${config.bg} ${config.color}`}>
        {config.label}
      </span>
    </div>
  );
}

export function AreaHealthCards({ areas, projects, tasks, onSelectArea, onEditEntity }: AreaHealthCardsProps) {
  if (areas.length === 0) return null;

  const today = getTodayKeyCET();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Áreas</h2>
          <span className="text-xs text-muted-foreground ml-auto">{areas.length} áreas · salud del sistema</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border">
          {areas.map((area, i) => {
            const areaProjects = projects.filter(p => p.areaId === area.id);
            const areaTasks = tasks.filter(t => areaProjects.some(p => p.id === t.projectId));
            const health = computeAreaHealth(area, areaProjects, areaTasks);
            const isReviewOverdue = area.reviewDate && area.reviewDate < today;

            return (
              <motion.div
                key={area.id}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => onSelectArea(area.id)}
                className="bg-card p-4 cursor-pointer hover:bg-secondary/20 transition-colors"
              >
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                  <StatusIcon status={area.status} />
                  <span className="text-sm font-semibold text-foreground truncate flex-1">{area.name}</span>
                  <ImportanceBadge importance={area.importance} />
                </div>

                {/* Score + Health bar */}
                <div className="space-y-2 mb-3">
                  <ScoreBadge health={health} />
                  <HealthBar health={health} />
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FolderKanban className="w-3 h-3" /> {areaProjects.length} proy.
                  </span>
                  <span className="text-status-active">{health.segments.active} activas</span>
                  {health.segments.waiting > 0 && (
                    <span className="text-status-funnel">{health.segments.waiting} embudo</span>
                  )}
                  {health.segments.blocked > 0 && (
                    <span className="text-destructive">{health.segments.blocked} bloq.</span>
                  )}
                  {health.segments.overdue > 0 && (
                    <span className="text-destructive">{health.segments.overdue} vencidas</span>
                  )}
                  {health.segments.noReview > 0 && (
                    <span className="text-muted-foreground/60">{health.segments.noReview} sin rev.</span>
                  )}
                </div>

                {/* Review date */}
                {area.reviewDate && (
                  <div className="flex items-center gap-1 mt-2">
                    <CalendarClock className={`w-3 h-3 ${isReviewOverdue ? 'text-destructive' : 'text-muted-foreground'}`} />
                    <span className={`text-[11px] ${isReviewOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                      {isReviewOverdue ? 'Revisión vencida' : `Revisión: ${new Date(area.reviewDate + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}`}
                    </span>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

export { computeAreaHealth };
