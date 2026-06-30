import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, ChevronDown, ListChecks } from 'lucide-react';
import type { Task, Project, Area } from '@/types';
import { ImportanceDot } from './StatusBadges';
import { getTodayKeyCET } from '@/lib/dateUtils';

interface MobileTasksDrawerProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
}

interface DrawerItem {
  id: string;
  name: string;
  importance: Task['importance'];
  reviewDate: string;
  parentInfo: string;
}

export function MobileTasksDrawer({ tasks, projects, areas }: MobileTasksDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
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

  const renderRow = (item: DrawerItem, dateLabel: string, isOverdue: boolean) => (
    <div key={item.id} className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border/60 last:border-0">
      <ImportanceDot importance={item.importance} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{item.name}</p>
        {item.parentInfo && <p className="text-[11px] text-muted-foreground truncate">{item.parentInfo}</p>}
      </div>
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
          <div className="flex-1 overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
      </motion.div>
    </>
  );
}
