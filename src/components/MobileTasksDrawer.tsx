import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, ListChecks, ArrowLeft } from 'lucide-react';
import type { Task, Project, Area } from '@/types';
import { STATUS_LABELS, EFFORT_OPTIONS, IMPORTANCE_LABELS } from '@/types';
import { ImportanceDot } from './StatusBadges';
import { getTodayKeyCET, addDaysCETKey, dateToCETKey } from '@/lib/dateUtils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface MobileTasksDrawerProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onUpdateTask: (id: string, data: Partial<Task>) => void;
}

interface DrawerItem {
  id: string;
  name: string;
  importance: Task['importance'];
  reviewDate: string;
  parentInfo: string;
  status: Task['status'];
}

export function MobileTasksDrawer({ tasks, projects, areas, onUpdateTask }: MobileTasksDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const todayKey = getTodayKeyCET();

  const { overdue, today } = useMemo(() => {
    const build = (t: Task): DrawerItem => {
      const project = projects.find(p => p.id === t.projectId);
      const area = project ? areas.find(a => a.id === project.areaId) : null;
      return {
        id: t.id,
        name: t.name,
        importance: t.importance,
        reviewDate: t.reviewDate!,
        parentInfo: [area?.name, project?.name].filter(Boolean).join(' › '),
        status: t.status,
      };
    };

    const relevant = tasks.filter(t => t.reviewDate && t.status !== 'finished');
    const overdue = relevant
      .filter(t => t.reviewDate! < todayKey)
      .map(build)
      .sort((a, b) => a.reviewDate.localeCompare(b.reviewDate));
    const today = relevant.filter(t => t.reviewDate === todayKey).map(build);

    return { overdue, today };
  }, [tasks, projects, areas, todayKey]);

  const total = overdue.length + today.length;

  const formatOverdue = (d: string) => {
    const diff = Math.floor(
      (new Date(todayKey + 'T00:00:00').getTime() - new Date(d + 'T00:00:00').getTime()) / 86400000
    );
    return diff === 1 ? 'Ayer' : `Hace ${diff}d`;
  };

  const getNextWeekday = (targetDay: number): string => {
    const today = new Date();
    const todayDay = today.getDay();
    let daysAhead = targetDay - todayDay;
    if (daysAhead <= 0) daysAhead += 7;
    const date = new Date(today);
    date.setDate(date.getDate() + daysAhead);
    return dateToCETKey(date);
  };

  const selectedTask = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) : null;

  const renderTaskEditor = () => {
    if (!selectedTask) return null;

    return (
      <div className="flex flex-col h-full">
        <button
          onClick={() => setSelectedTaskId(null)}
          className="flex items-center gap-2 px-4 py-3 text-primary hover:bg-secondary/30 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm font-medium">Volver</span>
        </button>

        <div className="flex-1 px-4 py-3 space-y-3 overflow-hidden">
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Nombre</label>
            <Input
              value={selectedTask.name}
              onChange={(e) => onUpdateTask(selectedTask.id, { name: e.target.value })}
              className="mt-0.5 h-8 text-xs"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Importancia</label>
            <select
              value={selectedTask.importance}
              onChange={(e) => onUpdateTask(selectedTask.id, { importance: e.target.value as Task['importance'] })}
              className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background text-foreground text-sm h-8"
            >
              {Object.entries(IMPORTANCE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Estado</label>
            <select
              value={selectedTask.status}
              onChange={(e) => onUpdateTask(selectedTask.id, { status: e.target.value as Task['status'] })}
              className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background text-foreground text-sm h-8"
            >
              {Object.entries(STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Fecha de revisión</label>
            <div className="mt-0.5 flex gap-1">
              <Input
                type="date"
                value={selectedTask.reviewDate || ''}
                onChange={(e) => onUpdateTask(selectedTask.id, { reviewDate: e.target.value || null })}
                className="h-8 text-sm flex-1"
              />
            </div>
            <div className="mt-1 flex gap-1">
              <button
                onClick={() => onUpdateTask(selectedTask.id, { reviewDate: addDaysCETKey(1) })}
                className="text-[10px] font-medium px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                +1d
              </button>
              <button
                onClick={() => onUpdateTask(selectedTask.id, { reviewDate: getNextWeekday(5) })}
                className="text-[10px] font-medium px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Fri
              </button>
              <button
                onClick={() => onUpdateTask(selectedTask.id, { reviewDate: getNextWeekday(6) })}
                className="text-[10px] font-medium px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Sat
              </button>
              <button
                onClick={() => onUpdateTask(selectedTask.id, { reviewDate: getNextWeekday(0) })}
                className="text-[10px] font-medium px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Sun
              </button>
              <button
                onClick={() => onUpdateTask(selectedTask.id, { reviewDate: addDaysCETKey(7) })}
                className="text-[10px] font-medium px-2 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                +7d
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Esfuerzo estimado</label>
            <select
              value={selectedTask.effort || ''}
              onChange={(e) => onUpdateTask(selectedTask.id, { effort: e.target.value ? parseInt(e.target.value) : null })}
              className="mt-0.5 w-full px-2 py-1 rounded border border-border bg-background text-foreground text-sm h-8"
            >
              <option value="">Sin estimar</option>
              {EFFORT_OPTIONS.filter(o => o.value !== null).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );
  };

  const renderRow = (item: DrawerItem, dateLabel: string, isOverdue: boolean) => (
    <div
      key={item.id}
      onClick={() => setSelectedTaskId(item.id)}
      className={`flex items-center gap-2.5 px-4 py-2.5 border-b border-border/60 last:border-0 cursor-pointer hover:bg-secondary/20 transition-colors ${
        item.status === 'blocked' ? 'bg-muted/20 opacity-60' : item.status === 'funnel' ? 'bg-secondary/20 opacity-75' : ''
      }`}
    >
      <ImportanceDot importance={item.importance} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{item.name}</p>
        {item.parentInfo && <p className="text-[11px] text-muted-foreground truncate">{item.parentInfo}</p>}
      </div>
      {item.status !== 'active' && item.status !== 'ready' && (
        <span
          title={STATUS_LABELS[item.status]}
          className="text-[10px] font-bold px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
        >
          {item.status === 'blocked' ? '🔒' : item.status === 'funnel' ? '⏳' : '?'}
        </span>
      )}
      <span className={`text-[11px] font-medium shrink-0 ${isOverdue ? 'text-destructive' : 'text-primary'}`}>
        {dateLabel}
      </span>
    </div>
  );

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-black/30 z-40"
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={false}
        animate={{ height: isOpen ? 'min(65vh, 480px)' : 'auto' }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.08)] flex flex-col overflow-hidden"
      >
        <button
          onClick={() => setIsOpen(o => !o)}
          className="relative shrink-0 flex items-center justify-center gap-2 px-4 py-3 w-full"
        >
          <div className="absolute left-1/2 top-1.5 -translate-x-1/2 w-9 h-1 rounded-full bg-border" />
          <ListChecks className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Tareas pendientes</span>
          {total > 0 && (
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
              {total}
            </span>
          )}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground ml-1" />
          ) : (
            <ChevronUp className="w-4 h-4 text-muted-foreground ml-1" />
          )}
        </button>

        {isOpen && (
          <div className="flex-1 overflow-hidden">
            {selectedTaskId ? (
              renderTaskEditor()
            ) : (
              <div className="overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {total === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No hay tareas vencidas ni para hoy 🎉
              </div>
            ) : (
              <>
                {overdue.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-destructive/8">
                      <h3 className="text-[11px] font-semibold text-destructive uppercase tracking-wide">
                        Vencidas ({overdue.length})
                      </h3>
                    </div>
                    {overdue.map(item => renderRow(item, formatOverdue(item.reviewDate), true))}
                  </div>
                )}
                {today.length > 0 && (
                  <div>
                    <div className="px-4 py-2 bg-primary/8">
                      <h3 className="text-[11px] font-semibold text-primary uppercase tracking-wide">
                        Para hoy ({today.length})
                      </h3>
                    </div>
                    {today.map(item => renderRow(item, 'Hoy', false))}
                  </div>
                )}
              </>
            )}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </>
  );
}
