import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import type { Task, Project, Area, EntityType } from '@/types';
import { getTaskDisplayId, STATUS_LABELS, IMPORTANCE_LABELS } from '@/types';
import { ImportanceDot, StatusIcon } from './StatusBadges';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { scoreTask, scoreProject, scoreArea } from '@/lib/scoring';
import { getTodayKeyCET } from '@/lib/dateUtils';

type CalendarMode = 'week' | 'month';

interface CalendarItem {
  type: 'task' | 'project' | 'area';
  id: string;
  name: string;
  date: string;
  importance: Task['importance'];
  status: Task['status'];
  displayId?: string;
  parentInfo?: string;
  description?: string;
  score: number;
}

interface CalendarViewProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onEditEntity: (type: EntityType, id: string) => void;
  onPostpone: (type: 'area' | 'project' | 'task', id: string, days: number) => void;
  onUpdateTaskDate?: (id: string, newDate: string) => void;
  onUpdateProjectDate?: (id: string, newDate: string) => void;
  onUpdateAreaDate?: (id: string, newDate: string) => void;
  defaultMode?: 'week' | 'month';
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function CalendarView({ tasks, projects, areas, onEditEntity, onPostpone, onUpdateTaskDate, onUpdateProjectDate, onUpdateAreaDate, defaultMode = 'month' }: CalendarViewProps) {
  const [mode, setMode] = useState<CalendarMode>(defaultMode);
  const [refDate, setRefDate] = useState(() => new Date());
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const todayKey = getTodayKeyCET();

  const allItems = useMemo<CalendarItem[]>(() => {
    const items: CalendarItem[] = [];
    tasks.forEach(t => {
      if (t.reviewDate) {
        const project = projects.find(p => p.id === t.projectId);
        const area = project ? areas.find(a => a.id === project.areaId) : null;
        items.push({
          type: 'task', id: t.id, name: t.name, date: t.reviewDate,
          importance: t.importance, status: t.status,
          displayId: getTaskDisplayId(projects, t),
          parentInfo: [area?.name, project?.name].filter(Boolean).join(' › '),
          description: t.description,
          score: scoreTask(t, projects, areas),
        });
      }
    });
    projects.forEach(p => {
      if (p.reviewDate) {
        const area = areas.find(a => a.id === p.areaId);
        items.push({
          type: 'project', id: p.id, name: p.name, date: p.reviewDate,
          importance: p.importance, status: p.status,
          parentInfo: area?.name, description: p.description,
          score: scoreProject(p, areas),
        });
      }
    });
    areas.forEach(a => {
      if (a.reviewDate) {
        items.push({
          type: 'area', id: a.id, name: a.name, date: a.reviewDate,
          importance: a.importance, status: a.status, description: a.description,
          score: scoreArea(a),
        });
      }
    });
    return items;
  }, [tasks, projects, areas]);

  const { days, label } = useMemo(() => {
    if (mode === 'week') {
      const start = startOfWeek(refDate);
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) days.push(addDays(start, i));
      const end = days[6];
      const label = `${start.getDate()} ${MONTH_NAMES[start.getMonth()].slice(0, 3)} – ${end.getDate()} ${MONTH_NAMES[end.getMonth()].slice(0, 3)} ${end.getFullYear()}`;
      return { days, label };
    } else {
      const year = refDate.getFullYear();
      const month = refDate.getMonth();
      const firstDay = new Date(year, month, 1);
      const startDay = startOfWeek(firstDay);
      const adjustedStart = startDay > firstDay ? addDays(startDay, -7) : startDay;
      const days: Date[] = [];
      let d = new Date(adjustedStart);
      for (let i = 0; i < 42; i++) {
        days.push(new Date(d));
        d = addDays(d, 1);
      }
      const label = `${MONTH_NAMES[month]} ${year}`;
      return { days, label };
    }
  }, [mode, refDate]);

  const navigate = (dir: -1 | 1) => {
    setRefDate(prev => {
      if (mode === 'week') return addDays(prev, dir * 7);
      const d = new Date(prev);
      d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  const goToday = () => setRefDate(new Date());

  const itemsByDate = useMemo(() => {
    const map: Record<string, CalendarItem[]> = {};
    allItems.forEach(item => {
      if (!map[item.date]) map[item.date] = [];
      map[item.date].push(item);
    });
    // Sort items within each day by score descending
    Object.values(map).forEach(arr => arr.sort((a, b) => b.score - a.score));
    return map;
  }, [allItems]);

  const handleDragStart = useCallback((e: React.DragEvent, item: CalendarItem) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ type: item.type, id: item.id }));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, dateKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverDate(dateKey);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverDate(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, dateKey: string) => {
    e.preventDefault();
    setDragOverDate(null);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'task') onUpdateTaskDate?.(data.id, dateKey);
      else if (data.type === 'project') onUpdateProjectDate?.(data.id, dateKey);
      else if (data.type === 'area') onUpdateAreaDate?.(data.id, dateKey);
    } catch {}
  }, [onUpdateTaskDate, onUpdateProjectDate, onUpdateAreaDate]);

  const currentMonth = refDate.getMonth();
  const maxVisible = mode === 'week' ? 8 : 3;

  const importanceColor: Record<string, string> = {
    critical: 'border-l-importance-critical',
    important: 'border-l-importance-important',
    normal: 'border-l-primary',
    low: 'border-l-muted-foreground/40',
    none: 'border-l-muted-foreground/20',
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center gap-4">
        <div className="flex items-center gap-2.5">
          <CalendarDays className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground tracking-tight">{label}</h2>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={goToday}
            className="text-[10px] font-semibold text-primary hover:text-primary/80 px-2.5 py-1 rounded-md border border-primary/20 hover:border-primary/40 transition-all"
          >
            Hoy
          </button>
          <div className="flex items-center">
            <button onClick={() => navigate(-1)} className="p-1.5 rounded-md hover:bg-secondary transition-colors">
              <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button onClick={() => navigate(1)} className="p-1.5 rounded-md hover:bg-secondary transition-colors">
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
          <div className="flex items-center bg-secondary rounded-lg p-0.5">
            <button
              onClick={() => setMode('week')}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-all ${mode === 'week' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Semana
            </button>
            <button
              onClick={() => setMode('month')}
              className={`px-3 py-1 rounded-md text-[10px] font-medium transition-all ${mode === 'month' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Mes
            </button>
          </div>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 bg-secondary/30">
        {DAY_NAMES.map((d, i) => (
          <div
            key={d}
            className={`px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-widest ${
              i >= 5 ? 'text-muted-foreground/60' : 'text-muted-foreground'
            }`}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className={`grid grid-cols-7 ${mode === 'month' ? 'auto-rows-[minmax(90px,1fr)]' : 'auto-rows-[minmax(140px,1fr)]'}`}>
        {days.map((day, i) => {
          const key = formatDateKey(day);
          const dayItems = itemsByDate[key] || [];
          const isToday = key === todayKey;
          const isCurrentMonth = mode === 'month' ? day.getMonth() === currentMonth : true;
          const isOverdue = key < todayKey;
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const isDragTarget = dragOverDate === key;

          return (
            <div
              key={i}
              onDragOver={(e) => handleDragOver(e, key)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, key)}
              className={`border-r border-b border-border/60 px-1.5 py-1 transition-all ${
                isDragTarget
                  ? 'bg-primary/8 ring-2 ring-inset ring-primary/30'
                  : !isCurrentMonth
                    ? 'bg-muted/20'
                    : isWeekend
                      ? 'bg-secondary/10'
                      : 'bg-card'
              } ${isToday && !isDragTarget ? 'bg-primary/5' : ''}`}
            >
              {/* Day number */}
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[11px] leading-none ${
                  isToday
                    ? 'bg-primary text-primary-foreground font-bold rounded-full w-5 h-5 flex items-center justify-center'
                    : !isCurrentMonth
                      ? 'text-muted-foreground/30 font-medium'
                      : 'text-muted-foreground font-medium'
                }`}>
                  {day.getDate()}
                </span>
                {dayItems.length > maxVisible && (
                  <span className="text-[8px] text-muted-foreground/60 font-medium">+{dayItems.length - maxVisible}</span>
                )}
              </div>

              {/* Items */}
              <div className="space-y-px overflow-hidden">
                {dayItems.slice(0, maxVisible).map((item, ii) => {
                  const typeLabel = item.type === 'task' ? 'Tarea' : item.type === 'project' ? 'Proyecto' : 'Área';
                  return (
                    <HoverCard key={`${item.type}-${item.id}`} openDelay={350} closeDelay={100}>
                      <HoverCardTrigger asChild>
                        <div
                          draggable
                          onDragStart={(e) => handleDragStart(e, item)}
                          onClick={() => onEditEntity(item.type, item.id)}
                          className={`flex items-center gap-1 pl-1.5 pr-1 py-[3px] rounded-[3px] cursor-grab active:cursor-grabbing transition-colors border-l-2 ${importanceColor[item.importance]} ${
                            item.status === 'finished'
                              ? 'bg-green-100 hover:bg-green-200 text-foreground'
                              : isOverdue
                                ? 'bg-destructive/8 hover:bg-destructive/12 text-foreground'
                                : 'bg-secondary/40 hover:bg-secondary/70 text-foreground'
                          }`}
                        >
                          {item.displayId && (
                            <span className="font-mono text-[8px] font-semibold text-muted-foreground shrink-0">
                              {item.displayId}
                            </span>
                          )}
                          <span className="truncate text-[10px] leading-tight">{item.name}</span>
                        </div>
                      </HoverCardTrigger>
                      <HoverCardContent side="right" align="start" className="w-64 p-3 z-50">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <StatusIcon status={item.status} />
                            <span className="text-xs font-semibold text-foreground flex-1 min-w-0 truncate">{item.name}</span>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                              item.score >= 100 ? 'bg-importance-critical/15 text-importance-critical' :
                              item.score >= 60 ? 'bg-importance-important/15 text-importance-important' :
                              'bg-muted text-muted-foreground'
                            }`}>{item.score} pts</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground font-medium">{typeLabel}</span>
                            {item.displayId && (
                              <span className="text-[9px] font-mono font-bold text-primary">{item.displayId}</span>
                            )}
                            <span className="text-[9px] text-muted-foreground">{STATUS_LABELS[item.status]}</span>
                            <span className="text-[9px] text-muted-foreground">· {IMPORTANCE_LABELS[item.importance]}</span>
                          </div>
                          {item.parentInfo && (
                            <p className="text-[9px] text-muted-foreground/80">{item.parentInfo}</p>
                          )}
                          {item.description && (
                            <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">{item.description}</p>
                          )}
                          <p className="text-[9px] text-muted-foreground">
                            {new Date(item.date + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                          </p>
                        </div>
                      </HoverCardContent>
                    </HoverCard>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
