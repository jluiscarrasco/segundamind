import { useEffect, useState, useMemo } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { FolderOpen, Layers3, CheckSquare, Search } from 'lucide-react';
import { ImportanceDot, StatusIcon } from './StatusBadges';
import type { Area, Project, Task } from '@/types';
import { getTaskDisplayId, STATUS_LABELS } from '@/types';

interface GlobalSearchProps {
  areas: Area[];
  projects: Project[];
  tasks: Task[];
  onSelectArea: (id: string) => void;
  onSelectProject: (id: string) => void;
  onEditEntity: (type: 'area' | 'project' | 'task', id: string) => void;
}

export function GlobalSearch({ areas, projects, tasks, onSelectArea, onSelectProject, onEditEntity }: GlobalSearchProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const select = (type: 'area' | 'project' | 'task', id: string) => {
    setOpen(false);
    if (type === 'area') {
      onSelectArea(id);
    } else if (type === 'project') {
      onSelectProject(id);
    } else {
      const task = tasks.find(t => t.id === id);
      if (task) {
        onSelectProject(task.projectId);
        onEditEntity('task', id);
      }
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-input bg-background/50 text-muted-foreground text-xs hover:bg-accent transition-colors"
      >
        <Search className="w-3.5 h-3.5" />
        <span>Buscar…</span>
        <kbd className="ml-2 pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Buscar áreas, proyectos o tareas…" />
        <CommandList>
          <CommandEmpty>No se encontraron resultados.</CommandEmpty>

          {areas.length > 0 && (
            <CommandGroup heading="Áreas">
              {areas.map(area => (
                <CommandItem key={area.id} value={`area-${area.name}`} onSelect={() => select('area', area.id)}>
                  <Layers3 className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                  <ImportanceDot importance={area.importance} />
                  <span className="ml-1.5 truncate">{area.name}</span>
                  <StatusIcon status={area.status} className="ml-auto shrink-0" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {projects.length > 0 && (
            <CommandGroup heading="Proyectos">
              {projects.map(project => (
                <CommandItem key={project.id} value={`project-${project.key}-${project.name}`} onSelect={() => select('project', project.id)}>
                  <FolderOpen className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-[10px] font-mono font-bold text-muted-foreground mr-1.5">{project.key}</span>
                  <span className="truncate">{project.name}</span>
                  <StatusIcon status={project.status} className="ml-auto shrink-0" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {tasks.length > 0 && (
            <CommandGroup heading="Tareas">
              {tasks.map(task => (
                <CommandItem key={task.id} value={`task-${getTaskDisplayId(projects, task)}-${task.name}`} onSelect={() => select('task', task.id)}>
                  <CheckSquare className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-[10px] font-mono font-bold text-muted-foreground mr-1.5">{getTaskDisplayId(projects, task)}</span>
                  <span className="truncate">{task.name}</span>
                  <StatusIcon status={task.status} className="ml-auto shrink-0" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
