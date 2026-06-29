import { motion } from 'framer-motion';
import { Inbox, StickyNote, Link2, ImageIcon, ArrowRight } from 'lucide-react';
import type { InboxItem } from '@/types';

interface UnprocessedNotesProps {
  items: InboxItem[];
  onOpenInbox: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
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
  image: { icon: ImageIcon, label: 'Imagen', color: 'text-importance-important' },
};

export function UnprocessedNotes({ items, onOpenInbox }: UnprocessedNotesProps) {
  if (items.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <Inbox className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">Notas sin procesar</h2>
        <span className="text-xs text-muted-foreground ml-auto">{items.length} pendiente{items.length > 1 ? 's' : ''}</span>
      </div>

      <div className="divide-y divide-border">
        {items.slice(0, 8).map((item, i) => {
          const config = typeConfig[item.type] || typeConfig.note;
          const Icon = config.icon;

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
              onClick={onOpenInbox}
              className="px-5 py-2.5 flex items-center gap-3 hover:bg-secondary/30 transition-colors cursor-pointer overflow-hidden"
            >
              <Icon className={`w-3.5 h-3.5 shrink-0 ${config.color}`} />
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground uppercase shrink-0">{config.label}</span>
                <span className="text-xs text-foreground truncate block">{item.content.slice(0, 80)}</span>
              </div>
              <span className="text-[11px] text-muted-foreground shrink-0">{timeAgo(item.createdAt)}</span>
            </motion.div>
          );
        })}
      </div>

      {items.length > 8 && (
        <button
          onClick={onOpenInbox}
          className="w-full px-5 py-2 border-t border-border text-[11px] text-primary hover:bg-secondary/30 transition-colors flex items-center justify-center gap-1"
        >
          Ver {items.length - 8} más <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
