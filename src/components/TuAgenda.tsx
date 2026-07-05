import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Calendar, CheckCircle2 } from 'lucide-react';
import type { Task, Project, Area, Importance, EntityType, Resource } from '@/types';
import { ImportanceDot } from './StatusBadges';
import { getTodayKeyCET, addDaysCETKey } from '@/lib/dateUtils';
import { scoreTaskDetailed } from '@/lib/scoring';
import { QuickTaskEdit } from './QuickTaskEdit';

const IMPORTANCE_ORDER: Importance[] = ['critical', 'important', 'normal', 'low', 'none'];

interface AgendaItem {
  type: 'area' | 'project' | 'task';
  id: string;
  name: string;
  importance: Importance;
  reviewDate: string;
  parentInfo: string;
  score?: number;
  isOverdue: boolean;
  status: Task['status'];
}

interface TuAgendaProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  resources: Resource[];
  onEditEntity: (type: EntityType, id: string) => void;
  onPostpone: (type: 'area' | 'project' | 'task', id: string, days: number) => void;
  onQuickEdit?: (id: string, field: keyof Task, value: any) => void;
}

export function TuAgenda({ tasks, projects, areas, resources, onEditEntity, onPostpone, onQuickEdit }: TuAgendaProps) {
  const todayKey = getTodayKeyCET();
  const limitKey = addDaysCETKey(7);

  const { overdue, today, upcoming } = useMemo(() => {
    const all: AgendaItem[] = [];

    // Agregar todas las tareas (excepto finished) con reviewDate
    tasks.forEach(t => {
      if (t.status !== 'finished' && t.reviewDate) {
        const project = projects.find(p => p.id === t.projectId);
        const area = project ? areas.find(a => a.id === project.areaId) : null;
        const score = scoreTaskDetailed(t, projects, areas);
        all.push({
          type: 'task',
          id: t.id,
          name: t.name,
          importance: t.importance,
          reviewDate: t.reviewDate,
          parentInfo: `${area?.name || ''} › ${project?.name || ''}`,
          score: score.total,
          isOverdue: t.reviewDate < todayKey,
          status: t.status,
        });
      }
    });

    // Agregar áreas con reviewDate próxima
    areas.forEach(a => {
      if (a.reviewDate && a.reviewDate <= limitKey) {
        all.push({
          type: 'area',
          id: a.id,
          name: a.name,
          importance: a.importance,
          reviewDate: a.reviewDate,
          parentInfo: 'Área',
          isOverdue: a.reviewDate < todayKey,
          status: a.status,
        });
      }
    });

    // Agregar proyectos con reviewDate próxima
    projects.forEach(p => {
      if (p.reviewDate && p.reviewDate <= limitKey) {
        const area = areas.find(a => a.id === p.areaId);
        all.push({
          type: 'project',
          id: p.id,
          name: p.name,
          importance: p.importance,
          reviewDate: p.reviewDate,
          parentInfo: area?.name || '',
          isOverdue: p.reviewDate < todayKey,
          status: p.status,
        });
      }
    });

    // Ordenamiento y separación
    const sortByDate = (a: AgendaItem, b: AgendaItem) => {
      const dateCmp = a.reviewDate.localeCompare(b.reviewDate);
      if (dateCmp !== 0) return dateCmp;
      return IMPORTANCE_ORDER.indexOf(a.importance) - IMPORTANCE_ORDER.indexOf(b.importance);
    };

    const sortByScore = (a: AgendaItem, b: AgendaItem) => {
      return (b.score || 0) - (a.score || 0);
    };

    const overdue = all.filter(i => i.isOverdue).sort(sortByDate);
    const today = all.filter(i => i.reviewDate === todayKey).sort(sortByScore);
    const upcoming = all.filter(i => i.reviewDate > todayKey && i.reviewDate <= limitKey).sort(sortByDate);

    return { overdue, today, upcoming };
  }, [tasks, projects, areas, todayKey, limitKey]);

  const typeLabels = { area: 'Área', project: 'Proy', task: 'Tarea' };
  const total = overdue.length + today.length + upcoming.length;

  const formatDate = (d: string) => {
    if (d === todayKey) return 'Hoy';
    if (d === addDaysCETKey(1)) return 'Mañana';
    if (d < todayKey) {
      const diff = Math.floor((new Date(todayKey + 'T00:00:00').getTime() - new Date(d + 'T00:00:00').getTime()) / 86400000);
      if (diff === 1) return 'Ayer';
      return `Hace ${diff}d`;
    }
    return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  };

  const getRowBgColor = (item: AgendaItem, section: 'overdue' | 'today' | 'upcoming') => {
    if (item.status === 'blocked') return 'bg-muted/20 hover:bg-muted/30 opacity-60';
    if (item.status === 'funnel') return 'bg-secondary/20 hover:bg-secondary/30 opacity-75';

    const isOverdue = section === 'overdue';
    const isToday = section === 'today';
    return isOverdue ? 'bg-destructive/5 hover:bg-destructive/10' : isToday ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-secondary/50';
  };

  const renderItem = (item: AgendaItem, i: number, section: 'overdue' | 'today' | 'upcoming') => {
    const isOverdue = section === 'overdue';
    const isToday = section === 'today';

    return (
      <motion.div
        key={`${item.type}-${item.id}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: i * 0.02 }}
        onClick={() => onEditEntity(item.type, item.id)}
        className={`px-4 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors group ${getRowBgColor(item, section)}`}
      >
        <ImportanceDot importance={item.importance} size="sm" />
        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground shrink-0">
          {typeLabels[item.type]}
        </span>
        <span className="text-xs font-medium text-foreground truncate flex-1">{item.name}</span>
        <span className="text-[11px] text-muted-foreground truncate max-w-[100px] hidden sm:block">{item.parentInfo}</span>
        {item.status !== 'active' && item.status !== 'ready' && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
            {item.status === 'blocked' ? '🔒' : item.status === 'funnel' ? '⏳' : '?'}
          </span>
        )}
        <span className={`text-[11px] font-medium shrink-0 ${isOverdue ? 'text-destructive' : isToday ? 'text-primary' : 'text-muted-foreground'}`}>
          {formatDate(item.reviewDate)}
        </span>
        {/* Inline edits for tasks only */}
        {item.type === 'task' && onQuickEdit ? (
          <div
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const task = tasks.find(t => t.id === item.id);
              return task ? (
                <QuickTaskEdit
                  task={task}
                  projects={projects}
                  areas={areas}
                  onUpdate={(field, value) => onQuickEdit(task.id, field, value)}
                  layout="hover"
                />
              ) : null;
            })()}
          </div>
        ) : (
          /* Fallback for non-tasks: show postpone buttons */
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPostpone(item.type, item.id, 1);
              }}
              className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors"
            >
              +1d
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPostpone(item.type, item.id, 7);
              }}
              className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors"
            >
              +7d
            </button>
          </div>
        )}
      </motion.div>
    );
  };

  if (total === 0) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Tu Agenda</h2>
        </div>
        <div className="px-5 py-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-primary/50" />
          <span>No hay nada urgente. ¡Buen trabajo! 🎉</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-4">
      {/* PARA HOY (incluyendo Vencidas) */}
      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden flex flex-col">
        <div className="px-4 py-3 bg-primary/8 border-b border-primary/10 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-primary uppercase tracking-wide">Por Hacer</h3>
          <span className="text-[10px] text-muted-foreground">
            {overdue.length > 0 && <span className="text-destructive font-semibold">{overdue.length} vencidas</span>}
            {overdue.length > 0 && today.length > 0 && <span className="text-muted-foreground"> + </span>}
            {today.length > 0 && <span className="text-primary font-semibold">{today.length} hoy</span>}
          </span>
        </div>
        <div className="divide-y divide-border overflow-y-auto flex-1 max-h-96">
          {overdue.length === 0 && today.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">-</div>
          ) : (
            <>
              {overdue.length > 0 && (
                <>
                  {overdue.map((item, i) => renderItem(item, i, 'overdue'))}
                </>
              )}
              {today.length > 0 && (
                <>
                  {today.map((item, i) => renderItem(item, i, 'today'))}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* PRÓXIMOS 7 DÍAS */}
      <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden flex flex-col">
        <div className="px-4 py-3 bg-secondary/50 border-b border-border">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Próximos 7d ({upcoming.length})</h3>
        </div>
        <div className="divide-y divide-border overflow-y-auto flex-1 max-h-96">
          {upcoming.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">-</div>
          ) : (
            upcoming.map((item, i) => renderItem(item, i, 'upcoming'))
          )}
        </div>
      </div>
    </div>
  );
}
