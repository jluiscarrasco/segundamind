import { motion } from 'framer-motion';
import { Activity, StickyNote, Link2, FileText, Zap, BookOpen } from 'lucide-react';
import type { Task, Resource, Project, WikiPage, EntityType } from '@/types';

interface RecentActivityProps {
  tasks: Task[];
  resources: Resource[];
  projects: Project[];
  wikiPages?: WikiPage[];
  onEditEntity: (type: EntityType, id: string) => void;
}

function timeAgo(dateStr: string | any): string {
  let timestamp: number;

  // Handle Firestore Timestamp objects
  if (dateStr && typeof dateStr === 'object' && 'toDate' in dateStr) {
    timestamp = dateStr.toDate().getTime();
  } else if (typeof dateStr === 'string') {
    timestamp = new Date(dateStr).getTime();
  } else {
    return '?';
  }

  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Ayer';
  return `Hace ${days}d`;
}

const typeConfig = {
  note: { icon: StickyNote, label: 'Nota', color: 'text-importance-normal' },
  link: { icon: Link2, label: 'Enlace', color: 'text-primary' },
  file: { icon: FileText, label: 'Archivo', color: 'text-importance-important' },
  image: { icon: FileText, label: 'Imagen', color: 'text-importance-important' },
  task: { icon: Zap, label: 'Tarea', color: 'text-status-active' },
  wiki: { icon: BookOpen, label: 'Wiki', color: 'text-primary' },
};

export function RecentActivity({ tasks, resources, projects, wikiPages = [], onEditEntity }: RecentActivityProps) {
  // Merge tasks, resources, and wiki pages into a single timeline
  const items = [
    ...tasks.map(t => ({
      id: t.id,
      type: 'task' as const,
      entityType: 'task' as EntityType,
      entityId: t.id,
      content: t.name,
      createdAt: t.createdAt,
    })),
    ...resources.map(r => ({
      id: r.id,
      type: r.type,
      entityType: r.entityType,
      entityId: r.entityId,
      content: r.type === 'file' ? (r.fileName || 'Archivo') : r.content,
      createdAt: r.createdAt,
    })),
    ...wikiPages.map(w => ({
      id: w.id,
      type: 'wiki' as const,
      entityType: w.entityType,
      entityId: w.entityId,
      content: w.title || 'Página sin título',
      createdAt: w.updatedAt || w.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Actividad Reciente</h2>
      </div>

      <div className="divide-y divide-border">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Sin actividad reciente
          </div>
        ) : (
          items.map((item, i) => {
            const config = typeConfig[item.type] || typeConfig.note;
            const Icon = config.icon;

            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onEditEntity(item.entityType, item.entityId)}
                className="px-5 py-2.5 flex items-center gap-3 hover:bg-secondary/30 transition-colors cursor-pointer overflow-hidden"
              >
                <div className="relative shrink-0">
                  <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                  {i < items.length - 1 && (
                    <div className="absolute left-1/2 top-full w-px h-3 bg-border -translate-x-1/2" />
                  )}
                </div>
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase shrink-0">{config.label}</span>
                  <span className="text-xs text-foreground truncate block">{item.content.slice(0, 60)}</span>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(item.createdAt)}</span>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
