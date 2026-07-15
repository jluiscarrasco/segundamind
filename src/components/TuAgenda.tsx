import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Calendar, CheckCircle2 } from 'lucide-react';
import type { Task, Project, Area, Importance, EntityType, Resource } from '@/types';
import { getTaskDisplayId } from '@/types';
import { ImportanceDot } from './StatusBadges';
import { getTodayKeyCET, addDaysCETKey } from '@/lib/dateUtils';
import { scoreTaskDetailed } from '@/lib/scoring';
import { QuickTaskEdit } from './QuickTaskEdit';
import { LinkedFilesList } from './LinkedFilesList';

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
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<'24h' | '48h' | '7d' | '14d'>('24h');

  const todayKey = getTodayKeyCET();
  const limitKey =
    timeRange === '24h' ? addDaysCETKey(1) :
    timeRange === '48h' ? addDaysCETKey(2) :
    timeRange === '7d' ? addDaysCETKey(7) :
    addDaysCETKey(14);

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
        onClick={() => {
          if (item.type === 'task') setSelectedTaskId(item.id);
          else onEditEntity(item.type, item.id);
        }}
        className={`px-4 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors ${
          item.id === selectedTaskId ? 'bg-primary/10' : getRowBgColor(item, section)
        }`}
      >
        {item.type === 'task' && (
          <>
            <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-2 py-1 rounded shrink-0">
              {(() => {
                const task = tasks.find(t => t.id === item.id);
                return task ? getTaskDisplayId(projects, task) : '?-?';
              })()}
            </span>
            {item.score !== undefined && (
              <span className={`text-[10px] font-bold px-2 py-1 rounded shrink-0 ${
                item.score >= 100 ? 'bg-destructive/15 text-destructive' :
                item.score >= 60 ? 'bg-orange-500/15 text-orange-600' :
                item.score >= 30 ? 'bg-primary/10 text-primary' :
                'bg-muted text-muted-foreground'
              }`}>
                {item.score}pts
              </span>
            )}
          </>
        )}
        <span className="text-sm font-semibold text-foreground flex-1 truncate">{item.name}</span>
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

  const selectedTask = selectedTaskId ? tasks.find(t => t.id === selectedTaskId) : null;
  const selectedProject = selectedTask ? projects.find(p => p.id === selectedTask.projectId) : null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden flex flex-col h-full">
      <div className="px-5 py-4 bg-primary/8 border-b border-primary/10 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-primary">Tu Agenda</h2>
        <div className="flex items-center gap-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as any)}
            className="text-xs bg-transparent text-muted-foreground border border-primary/20 rounded px-2 py-1 hover:border-primary/50 cursor-pointer"
          >
            <option value="24h">24h</option>
            <option value="48h">48h</option>
            <option value="7d">7d</option>
            <option value="14d">14d</option>
          </select>
          <span className="text-xs text-muted-foreground">{total}</span>
        </div>
      </div>
      <div className="flex flex-1 min-h-0 divide-x divide-border">
        <div className="flex-1 divide-y divide-border overflow-y-auto">
        {total === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">No hay nada urgente. ¡Buen trabajo! 🎉</div>
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
            {upcoming.length > 0 && (
              <>
                {upcoming.map((item, i) => renderItem(item, i, 'upcoming'))}
              </>
            )}
          </>
        )}
        </div>
        {selectedTask && selectedProject && onQuickEdit ? (
          <div className="w-80 overflow-y-auto p-4 space-y-4 bg-secondary/30">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">TAREA</p>
              <p className="text-sm font-semibold text-foreground truncate">{selectedTask.name}</p>
            </div>
            <div
              className="space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <QuickTaskEdit
                task={selectedTask}
                projects={projects}
                areas={areas}
                onUpdate={(field, value) => onQuickEdit(selectedTask.id, field, value)}
                layout="hover"
              />
            </div>
            {selectedTask.description && (
              <div className="border-t border-border pt-3">
                <p className="text-xs font-semibold text-muted-foreground mb-1">DESCRIPCIÓN</p>
                <p className="text-xs text-muted-foreground">{selectedTask.description}</p>
              </div>
            )}
            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">ARCHIVOS</p>
              <LinkedFilesList entityType="task" entityId={selectedTask.id} />
            </div>
          </div>
        ) : (
          <div className="w-80 flex items-center justify-center text-center text-xs text-muted-foreground p-4">
            Selecciona una tarea
          </div>
        )}
      </div>
    </div>
  );
}
