import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, MoreHorizontal, GripVertical, CalendarClock, ArrowRight, StickyNote, Link2, Paperclip, ArrowUpDown } from 'lucide-react';
import type { Task, Project, Area, Resource, Status, EntityType } from '@/types';
import { ImportanceBadge, StatusIcon } from './StatusBadges';
import { STATUS_LABELS, getTaskDisplayId } from '@/types';
import { scoreTask } from '@/lib/scoring';
import { QuickTaskEdit } from './QuickTaskEdit';

const KANBAN_COLUMNS: { status: Status; label: string; color: string; dotColor: string }[] = [
  { status: 'funnel', label: 'Embudo', color: 'bg-status-funnel/10 border-status-funnel/30', dotColor: 'bg-status-funnel' },
  { status: 'ready', label: 'Listo', color: 'bg-status-ready/10 border-status-ready/30', dotColor: 'bg-status-ready' },
  { status: 'blocked', label: 'Bloqueado', color: 'bg-status-blocked/10 border-status-blocked/30', dotColor: 'bg-status-blocked' },
  { status: 'waiting', label: 'Esperando', color: 'bg-status-waiting/10 border-status-waiting/30', dotColor: 'bg-status-waiting' },
  { status: 'active', label: 'En Progreso', color: 'bg-status-active/10 border-status-active/30', dotColor: 'bg-status-active' },
  { status: 'finished', label: 'Cerrado', color: 'bg-status-finished/10 border-status-finished/30', dotColor: 'bg-status-finished' },
];

interface KanbanBoardProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  resources: Resource[];
  onEditEntity: (type: EntityType, id: string) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onAddTask: (projectId: string) => void;
  selectedProjectId: string | null;
  onQuickEdit?: (id: string, field: keyof Task, value: any) => void;
}

export function KanbanBoard({ tasks, projects, areas, resources, onEditEntity, onUpdateTask, onAddTask, selectedProjectId, onQuickEdit }: KanbanBoardProps) {
  const [sortBy, setSortBy] = useState<'score' | 'date'>('score');

  const filteredTasks = selectedProjectId
    ? tasks.filter(t => t.projectId === selectedProjectId)
    : tasks;

  const getProjectName = (projectId: string) => projects.find(p => p.id === projectId)?.name || '';
  const getAreaName = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return '';
    return areas.find(a => a.id === project.areaId)?.name || '';
  };

  const getTaskNoteCount = (taskId: string) => resources.filter(r => r.entityId === taskId && r.entityType === 'task' && r.type === 'note').length;
  const getTaskLinkCount = (taskId: string) => resources.filter(r => r.entityId === taskId && r.entityType === 'task' && r.type === 'link').length;
  const getTaskFileCount = (taskId: string) => resources.filter(r => r.entityId === taskId && r.entityType === 'task' && r.type === 'file').length;

  const handleDrop = (e: React.DragEvent, targetStatus: Status) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    if (taskId) {
      onUpdateTask(taskId, { status: targetStatus });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="space-y-3">
      {/* Sort control */}
      <div className="flex items-center gap-1 bg-secondary rounded-lg p-0.5 w-fit">
        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground ml-2" />
        <button
          onClick={() => setSortBy('score')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            sortBy === 'score' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Por Score
        </button>
        <button
          onClick={() => setSortBy('date')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            sortBy === 'date' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Por Fecha
        </button>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 min-h-[400px]">
      {KANBAN_COLUMNS.map(col => {
        const columnTasks = filteredTasks.filter(t => t.status === col.status);
        const allTasks = columnTasks.sort((a, b) => {
          if (sortBy === 'score') {
            return scoreTask(b, projects, areas) - scoreTask(a, projects, areas);
          }
          // Sort by reviewDate: tasks with dates first (ascending), then without dates
          const dateA = a.reviewDate || '9999-12-31';
          const dateB = b.reviewDate || '9999-12-31';
          return dateA.localeCompare(dateB);
        });

        return (
          <div
            key={col.status}
            className="flex-1 min-w-[260px] max-w-[320px] flex flex-col"
            onDrop={e => handleDrop(e, col.status)}
            onDragOver={handleDragOver}
          >
            <div className={`rounded-xl border ${col.color} px-4 py-3 mb-3`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${col.dotColor}`} />
                <span className="text-sm font-semibold text-foreground">{col.label}</span>
                <span className="text-xs text-muted-foreground">({allTasks.length})</span>
                <button className="ml-auto p-0.5 rounded hover:bg-secondary/50 transition-colors">
                  <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            {col.status === 'funnel' && selectedProjectId && (
              <button
                onClick={() => onAddTask(selectedProjectId)}
                className="w-full mb-2 py-2 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-all flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> Añadir Tarea
              </button>
            )}

            <div className="space-y-2 flex-1">
              {allTasks.map((task, i) => {
                const noteCount = getTaskNoteCount(task.id);
                const linkCount = getTaskLinkCount(task.id);
                const fileCount = getTaskFileCount(task.id);
                const score = scoreTask(task, projects, areas);

                return (
                  <motion.div
                    key={task.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    draggable
                    onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, task.id)}
                    onClick={() => onEditEntity('task', task.id)}
                    className="bg-card border border-border rounded-xl p-3.5 shadow-card hover:shadow-glow/30 cursor-pointer group transition-all hover:border-primary/30 relative"
                  >
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {getTaskDisplayId(projects, task)}
                      </span>
                      <ImportanceBadge importance={task.importance} />
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        score >= 100 ? 'bg-importance-critical/15 text-importance-critical' :
                        score >= 60 ? 'bg-importance-important/15 text-importance-important' :
                        score >= 30 ? 'bg-primary/10 text-primary' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {score}pts
                      </span>
                      {task.status === 'blocked' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-medium">
                          Bloqueado
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-medium text-foreground mb-1 leading-snug">{task.name}</h4>

                    {task.description && (
                      <p className="text-[11px] text-muted-foreground mb-2 line-clamp-2 leading-relaxed">{task.description}</p>
                    )}

                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
                      <div className="flex items-center gap-1 flex-1 min-w-0">
                        <span className="text-[10px] text-muted-foreground truncate">{getAreaName(task.projectId)}</span>
                        <ArrowRight className="w-2 h-2 text-muted-foreground shrink-0" />
                        <span className="text-[10px] text-muted-foreground truncate">{getProjectName(task.projectId)}</span>
                      </div>
                      {/* Resource indicators */}
                      {(noteCount > 0 || linkCount > 0 || fileCount > 0) && (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {noteCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                              <StickyNote className="w-2.5 h-2.5" /> {noteCount}
                            </span>
                          )}
                          {linkCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[9px] text-primary">
                              <Link2 className="w-2.5 h-2.5" /> {linkCount}
                            </span>
                          )}
                          {fileCount > 0 && (
                            <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                              <Paperclip className="w-2.5 h-2.5" /> {fileCount}
                            </span>
                          )}
                        </div>
                      )}
                      {task.reviewDate && (
                        <div className="flex items-center gap-1 shrink-0">
                          <CalendarClock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">{task.reviewDate}</span>
                        </div>
                      )}
                    </div>

                    {/* Inline quick edits */}
                    {onQuickEdit && (
                      <div
                        className="mt-2 pt-2 border-t border-border/50 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <QuickTaskEdit
                          task={task}
                          projects={projects}
                          areas={areas}
                          onUpdate={(field, value) => onQuickEdit(task.id, field, value)}
                          layout="row"
                        />
                      </div>
                    )}

                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-50 transition-opacity">
                      <GripVertical className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </motion.div>
                );
              })}

              {allTasks.length === 0 && (
                <div className="rounded-xl border border-dashed border-border/50 py-8 flex items-center justify-center">
                  <span className="text-xs text-muted-foreground">Sin tareas</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
