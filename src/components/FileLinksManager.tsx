import { useState, useMemo } from 'react';
import { Link2, Plus, X, FolderOpen, ListChecks, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStore } from '@/store/useStore';
import type { UserFileLink, EntityType } from '@/types';
import { toast } from 'sonner';

interface Props {
  fileId: string;
  links: UserFileLink[];
  onAdd: (fileId: string, entityType: EntityType, entityId: string) => Promise<void> | void;
  onRemove: (linkId: string) => Promise<void> | void;
}

const ICONS: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  area: Layers,
  project: FolderOpen,
  task: ListChecks,
};

const LABELS: Record<EntityType, string> = {
  area: 'Área',
  project: 'Proyecto',
  task: 'Tarea',
};

export function FileLinksManager({ fileId, links, onAdd, onRemove }: Props) {
  const { areas, projects, tasks } = useStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const fileLinks = links.filter(l => l.fileId === fileId);

  const enrich = (l: UserFileLink) => {
    if (l.entityType === 'area') {
      const a = areas.find(x => x.id === l.entityId);
      return a ? { name: a.name, sub: '' } : null;
    }
    if (l.entityType === 'project') {
      const p = projects.find(x => x.id === l.entityId);
      if (!p) return null;
      const a = areas.find(x => x.id === p.areaId);
      return { name: p.name, sub: a?.name || '' };
    }
    const t = tasks.find(x => x.id === l.entityId);
    if (!t) return null;
    const p = projects.find(x => x.id === t.projectId);
    return { name: t.name, sub: p?.name || '' };
  };

  const candidates = useMemo(() => {
    const q = search.toLowerCase().trim();
    const existing = new Set(fileLinks.map(l => `${l.entityType}:${l.entityId}`));
    const items: { type: EntityType; id: string; name: string; sub: string }[] = [];
    areas.forEach(a => items.push({ type: 'area', id: a.id, name: a.name, sub: 'Área' }));
    projects.forEach(p => {
      const a = areas.find(x => x.id === p.areaId);
      items.push({ type: 'project', id: p.id, name: p.name, sub: `Proyecto · ${a?.name || ''}` });
    });
    tasks.forEach(t => {
      const p = projects.find(x => x.id === t.projectId);
      items.push({ type: 'task', id: t.id, name: t.name, sub: `Tarea · ${p?.name || ''}` });
    });
    return items
      .filter(i => !existing.has(`${i.type}:${i.id}`))
      .filter(i => !q || i.name.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q))
      .slice(0, 50);
  }, [search, areas, projects, tasks, fileLinks]);

  const handleAdd = async (type: EntityType, id: string) => {
    try {
      await onAdd(fileId, type, id);
      toast.success('Asociado');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div>
      <p className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
        <Link2 className="w-3 h-3" />
        Asociado a
      </p>
      <div className="space-y-1 mb-2">
        {fileLinks.length === 0 && (
          <p className="text-[11px] text-muted-foreground/60">Sin asociaciones</p>
        )}
        {fileLinks.map(l => {
          const info = enrich(l);
          const Icon = ICONS[l.entityType];
          return (
            <div
              key={l.id}
              className="group flex items-center gap-2 bg-secondary/40 rounded-md px-2 py-1.5"
            >
              <Icon className="w-3 h-3 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">
                  {info?.name || '—'}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {LABELS[l.entityType]}
                  {info?.sub ? ` · ${info.sub}` : ''}
                </p>
              </div>
              <button
                onClick={() => onRemove(l.id)}
                className="p-0.5 rounded hover:bg-secondary text-destructive opacity-0 group-hover:opacity-100"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full h-7 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="w-3 h-3 mr-1.5" /> Asociar a área/proyecto/tarea
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Asociar archivo</DialogTitle>
            <DialogDescription>
              Vincula este archivo a un área, proyecto o tarea.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          <ScrollArea className="max-h-72">
            <div className="space-y-1">
              {candidates.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Sin resultados
                </p>
              )}
              {candidates.map(c => {
                const Icon = ICONS[c.type];
                return (
                  <button
                    key={`${c.type}:${c.id}`}
                    onClick={() => handleAdd(c.type, c.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-accent text-left"
                  >
                    <Icon className="w-4 h-4 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{c.sub}</p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {LABELS[c.type]}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
