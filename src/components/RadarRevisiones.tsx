import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Radar, CalendarClock, AlertTriangle } from 'lucide-react';
import type { Task, Project, Area, Importance, EntityType } from '@/types';
import { ImportanceDot } from './StatusBadges';
import { getTodayKeyCET, addDaysCETKey } from '@/lib/dateUtils';

const IMPORTANCE_ORDER: Importance[] = ['critical', 'important', 'normal', 'low', 'none'];

interface RadarRevisionesProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onPostpone: (type: 'area' | 'project' | 'task', id: string, days: number) => void;
  onEditEntity: (type: EntityType, id: string) => void;
}

interface RadarItem {
  type: 'area' | 'project' | 'task';
  id: string;
  name: string;
  importance: Importance;
  reviewDate: string;
  parentInfo: string;
}

export function RadarRevisiones({ tasks, projects, areas, onPostpone, onEditEntity }: RadarRevisionesProps) {
  const todayKey = getTodayKeyCET();

  const { overdue, upcoming } = useMemo(() => {
    const limitKey = addDaysCETKey(7);

    const all: RadarItem[] = [];

    areas.forEach(a => {
      if (a.reviewDate && a.reviewDate <= limitKey) {
        all.push({ type: 'area', id: a.id, name: a.name, importance: a.importance, reviewDate: a.reviewDate, parentInfo: 'Área' });
      }
    });

    projects.forEach(p => {
      if (p.reviewDate && p.reviewDate <= limitKey) {
        const area = areas.find(a => a.id === p.areaId);
        all.push({ type: 'project', id: p.id, name: p.name, importance: p.importance, reviewDate: p.reviewDate, parentInfo: area?.name || '' });
      }
    });

    tasks.forEach(t => {
      if (t.reviewDate && t.status !== 'finished' && t.reviewDate <= limitKey) {
        const project = projects.find(p => p.id === t.projectId);
        const area = project ? areas.find(a => a.id === project.areaId) : null;
        all.push({ type: 'task', id: t.id, name: t.name, importance: t.importance, reviewDate: t.reviewDate, parentInfo: `${area?.name || ''} › ${project?.name || ''}` });
      }
    });

    const sortFn = (a: RadarItem, b: RadarItem) => {
      const dateCmp = a.reviewDate.localeCompare(b.reviewDate);
      if (dateCmp !== 0) return dateCmp;
      return IMPORTANCE_ORDER.indexOf(a.importance) - IMPORTANCE_ORDER.indexOf(b.importance);
    };

    return {
      overdue: all.filter(i => i.reviewDate < todayKey).sort(sortFn),
      upcoming: all.filter(i => i.reviewDate >= todayKey).sort(sortFn),
    };
  }, [tasks, projects, areas, todayKey]);

  const total = overdue.length + upcoming.length;

  const typeLabels = { area: 'Área', project: 'Proy', task: 'Tarea' };

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

  const renderItem = (item: RadarItem, i: number, isOverdue: boolean) => (
    <motion.div
      key={`${item.type}-${item.id}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.02 }}
      onClick={() => onEditEntity(item.type, item.id)}
      className={`px-4 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors group ${
        isOverdue ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-secondary/50'
      }`}
    >
      <ImportanceDot importance={item.importance} size="sm" />
      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground shrink-0">
        {typeLabels[item.type]}
      </span>
      <span className="text-xs font-medium text-foreground truncate flex-1">{item.name}</span>
      <span className="text-[11px] text-muted-foreground truncate max-w-[100px] hidden sm:block">{item.parentInfo}</span>
      <span className={`text-[11px] font-medium shrink-0 ${isOverdue ? 'text-destructive' : item.reviewDate === todayKey ? 'text-primary' : 'text-muted-foreground'}`}>
        {formatDate(item.reviewDate)}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onPostpone(item.type, item.id, 1); }}
          className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors"
        >
          +1d
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onPostpone(item.type, item.id, 7); }}
          className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors"
        >
          +7d
        </button>
      </div>
    </motion.div>
  );

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Radar className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Radar de Revisiones</h2>
        <div className="ml-auto flex items-center gap-2">
          {overdue.length > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertTriangle className="w-3 h-3" />
              <span className="text-[11px] font-medium">{overdue.length} vencida{overdue.length > 1 ? 's' : ''}</span>
            </span>
          )}
          {upcoming.length > 0 && (
            <span className="text-[11px] text-muted-foreground">{upcoming.length} próxima{upcoming.length > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {total === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          No hay revisiones pendientes. ¡Todo al día! ✅
        </div>
      ) : (
        <div>
          {overdue.length > 0 && (
            <div>
              <div className="px-4 py-1.5 bg-destructive/8 border-b border-destructive/10">
                <span className="text-[11px] font-semibold text-destructive uppercase tracking-wide">Vencidas</span>
              </div>
              {overdue.map((item, i) => renderItem(item, i, true))}
            </div>
          )}
          {upcoming.length > 0 && (
            <div>
              <div className="px-4 py-1.5 bg-secondary/50 border-b border-border">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Próximos 7 días</span>
              </div>
              {upcoming.map((item, i) => renderItem(item, i, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
