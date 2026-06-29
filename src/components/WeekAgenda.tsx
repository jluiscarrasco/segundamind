import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays } from 'lucide-react';
import type { Task, Project, Area, EntityType } from '@/types';
import { getTodayKeyCET, addDaysCETKey } from '@/lib/dateUtils';
import { ImportanceDot } from './StatusBadges';

interface WeekItem {
  type: 'task' | 'project' | 'area';
  id: string;
  name: string;
  date: string;
  importance: Task['importance'];
  displayId?: string;
  parentInfo?: string;
}

interface WeekAgendaProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onEditEntity: (type: EntityType, id: string) => void;
}

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function WeekAgenda({ tasks, projects, areas, onEditEntity }: WeekAgendaProps) {
  const todayKey = getTodayKeyCET();

  // Generate next 7 days starting from today
  const weekDates = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDaysCETKey(i));
  }, []);

  const allItems = useMemo<WeekItem[]>(() => {
    const items: WeekItem[] = [];

    tasks.forEach(t => {
      if (t.reviewDate && weekDates.includes(t.reviewDate)) {
        const project = projects.find(p => p.id === t.projectId);
        const area = project ? areas.find(a => a.id === project.areaId) : null;
        items.push({
          type: 'task',
          id: t.id,
          name: t.name,
          date: t.reviewDate,
          importance: t.importance,
          displayId: `${project?.key}-${t.id.slice(0, 4)}`,
          parentInfo: [area?.name, project?.name].filter(Boolean).join(' › '),
        });
      }
    });

    projects.forEach(p => {
      if (p.reviewDate && weekDates.includes(p.reviewDate)) {
        const area = areas.find(a => a.id === p.areaId);
        items.push({
          type: 'project',
          id: p.id,
          name: p.name,
          date: p.reviewDate,
          importance: p.importance,
          displayId: p.key,
          parentInfo: area?.name,
        });
      }
    });

    areas.forEach(a => {
      if (a.reviewDate && weekDates.includes(a.reviewDate)) {
        items.push({
          type: 'area',
          id: a.id,
          name: a.name,
          date: a.reviewDate,
          importance: a.importance,
        });
      }
    });

    return items;
  }, [tasks, projects, areas, weekDates]);

  const itemsByDate = useMemo(() => {
    const map: Record<string, WeekItem[]> = {};
    allItems.forEach(item => {
      if (!map[item.date]) map[item.date] = [];
      map[item.date].push(item);
    });
    return map;
  }, [allItems]);

  if (allItems.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Próximos 7 Días</h2>
      </div>

      <div className="overflow-x-auto">
        <div className="grid gap-0.5 p-4" style={{ gridTemplateColumns: `repeat(7, minmax(160px, 1fr))` }}>
          {weekDates.map((date) => {
            const items = itemsByDate[date] || [];
            const isToday = date === todayKey;
            const dateObj = new Date(date + 'T00:00:00');
            const dayIdx = dateObj.getDay();
            const dayLabel = DAY_NAMES[dayIdx === 0 ? 6 : dayIdx - 1];
            const dayNum = dateObj.getDate();
            const monthLabel = dateObj.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase();

            return (
              <div
                key={date}
                className={`rounded-lg border overflow-hidden flex flex-col h-96 ${
                  isToday ? 'bg-primary/5 border-primary/30' : 'bg-secondary/30 border-border/50'
                }`}
              >
                {/* Header */}
                <div
                  className={`px-3 py-2 text-center border-b ${
                    isToday ? 'bg-primary/10 border-primary/20' : 'bg-secondary/50 border-border/30'
                  }`}
                >
                  <div className={`text-[11px] font-semibold uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                    {dayLabel}
                  </div>
                  <div className={`text-sm font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>{dayNum}</div>
                  <div className="text-[9px] text-muted-foreground">{monthLabel}</div>
                </div>

                {/* Items */}
                <div className="flex-1 space-y-1 p-2 overflow-y-auto">
                  {items.map((item, i) => (
                    <motion.button
                      key={`${item.type}-${item.id}`}
                      initial={{ opacity: 0, y: 2 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      onClick={() => onEditEntity(item.type as EntityType, item.id)}
                      className={`w-full text-left px-2 py-1.5 rounded text-[10px] border transition-all hover:shadow-sm group ${
                        item.type === 'task'
                          ? 'bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20'
                          : item.type === 'project'
                            ? 'bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20'
                            : 'bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20'
                      }`}
                    >
                      <div className="flex items-start gap-1.5">
                        <ImportanceDot importance={item.importance} size="sm" />
                        <div className="flex-1 min-w-0">
                          {item.displayId && (
                            <div className="text-[9px] font-mono font-bold text-muted-foreground truncate">{item.displayId}</div>
                          )}
                          <div className="font-medium truncate line-clamp-2" title={item.name}>
                            {item.name}
                          </div>
                          {item.parentInfo && <div className="text-[9px] text-muted-foreground truncate">{item.parentInfo}</div>}
                        </div>
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
