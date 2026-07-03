import { useState } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen, ListChecks, CalendarClock, Plus, Trash2, Link2, ExternalLink, StickyNote, Paperclip, Download, FileIcon, Timer, ChevronDown, ChevronRight, CheckCircle2, BookOpen, FolderArchive } from 'lucide-react';
import type { Area, Project, Task, Resource, WikiPage, EntityType } from '@/types';
import { ImportanceBadge, StatusIcon } from './StatusBadges';
import { STATUS_LABELS, getTaskDisplayId, getEffortLabel } from '@/types';
import { scoreTaskDetailed } from '@/lib/scoring';
import { getTodayKeyCET } from '@/lib/dateUtils';
import { WikiPageEditor } from './WikiPageEditor';
import { LinkedFilesList } from './LinkedFilesList';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface DetailPanelProps {
  area: Area | null;
  project: Project | null;
  projects: Project[];
  tasks: Task[];
  areas: Area[];
  resources: Resource[];
  wikiPages: WikiPage[];
  onAddTask: (projectId: string) => void;
  onDeleteTask: (id: string) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onEditEntity: (type: EntityType, id: string) => void;
  onAddResource: (resource: Omit<Resource, 'id' | 'createdAt'>) => void;
  onRemoveResource: (id: string) => void;
  onAddWikiPage: (page: Omit<WikiPage, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdateWikiPage: (id: string, patch: Partial<WikiPage>) => void;
  onDeleteWikiPage: (id: string) => void;
}

export function DetailPanel({ area, project, projects, tasks, areas, resources, wikiPages, onAddTask, onDeleteTask, onUpdateTask, onEditEntity, onAddResource, onRemoveResource, onAddWikiPage, onUpdateWikiPage, onDeleteWikiPage }: DetailPanelProps) {
  const [newUrl, setNewUrl] = useState('');
  const [addingUrlForTask, setAddingUrlForTask] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const [taskSort, setTaskSort] = useState<'score' | 'date'>('score');

  const getEntityResources = (entityType: EntityType, entityId: string) =>
    resources.filter(r => r.entityId === entityId && r.entityType === entityType);

  const getEntityLinks = (entityType: EntityType, entityId: string) =>
    getEntityResources(entityType, entityId).filter(r => r.type === 'link');

  const getEntityNotes = (entityType: EntityType, entityId: string) =>
    getEntityResources(entityType, entityId).filter(r => r.type === 'note');

  const getEntityFiles = (entityType: EntityType, entityId: string) =>
    getEntityResources(entityType, entityId).filter(r => r.type === 'file');

  const handleAddUrl = (entityType: EntityType, entityId: string) => {
    if (!newUrl.trim()) return;
    onAddResource({ entityType, entityId, type: 'link', content: newUrl.trim() });
    setNewUrl('');
    setAddingUrlForTask(null);
  };

  // Small badge showing counts
  const ResourceBadges = ({ entityType, entityId }: { entityType: EntityType; entityId: string }) => {
    const notes = getEntityNotes(entityType, entityId);
    const links = getEntityLinks(entityType, entityId);
    const files = getEntityFiles(entityType, entityId);
    if (notes.length === 0 && links.length === 0 && files.length === 0) return null;
    return (
      <div className="flex items-center gap-1.5">
        {notes.length > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
            <StickyNote className="w-2.5 h-2.5" /> {notes.length}
          </span>
        )}
        {links.length > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
            <Link2 className="w-2.5 h-2.5" /> {links.length}
          </span>
        )}
        {files.length > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
            <Paperclip className="w-2.5 h-2.5" /> {files.length}
          </span>
        )}
      </div>
    );
  };

  // Right sidebar for resources
  const ResourcesSidebar = ({ entityType, entityId }: { entityType: EntityType; entityId: string }) => {
    const notes = getEntityNotes(entityType, entityId);
    const links = getEntityLinks(entityType, entityId);
    const files = getEntityFiles(entityType, entityId);

    // Also collect resources from child entities
    const childNotes: Resource[] = [];
    const childLinks: Resource[] = [];
    const childFiles: Resource[] = [];

    if (entityType === 'project') {
      const projectTasks = tasks.filter(t => t.projectId === entityId);
      projectTasks.forEach(t => {
        childNotes.push(...getEntityNotes('task', t.id));
        childLinks.push(...getEntityLinks('task', t.id));
        childFiles.push(...getEntityFiles('task', t.id));
      });
    } else if (entityType === 'area') {
      const areaProjects = projects.filter(p => p.areaId === entityId);
      areaProjects.forEach(p => {
        childNotes.push(...getEntityNotes('project', p.id));
        childLinks.push(...getEntityLinks('project', p.id));
        childFiles.push(...getEntityFiles('project', p.id));
        const pTasks = tasks.filter(t => t.projectId === p.id);
        pTasks.forEach(t => {
          childNotes.push(...getEntityNotes('task', t.id));
          childLinks.push(...getEntityLinks('task', t.id));
          childFiles.push(...getEntityFiles('task', t.id));
        });
      });
    }

    const allNotes = [...notes, ...childNotes];
    const allLinks = [...links, ...childLinks];
    const allFiles = [...files, ...childFiles];

    const hasOwn = notes.length > 0 || links.length > 0 || files.length > 0;
    const hasChild = childNotes.length > 0 || childLinks.length > 0 || childFiles.length > 0;

    return (
      <div className="space-y-5">
        {/* Links */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5" /> Enlaces ({allLinks.length})
          </h4>
          {allLinks.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60">Sin enlaces</p>
          ) : (
            <div className="space-y-1">
              {allLinks.map(r => (
                <div key={r.id} className="flex items-center gap-2 bg-secondary/40 rounded-lg px-3 py-2 group hover:bg-secondary/60 transition-colors">
                  <ExternalLink className="w-3 h-3 text-primary shrink-0" />
                  <a
                    href={r.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline truncate flex-1"
                  >
                    {(() => {
                      try {
                        return new URL(r.content).hostname.replace('www.', '');
                      } catch {
                        return r.content;
                      }
                    })()}
                  </a>
                  <button
                    onClick={() => onRemoveResource(r.id)}
                    className="p-0.5 rounded hover:bg-secondary text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Files */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Paperclip className="w-3.5 h-3.5" /> Ficheros ({allFiles.length})
          </h4>
          {allFiles.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60">Sin ficheros</p>
          ) : (
            <div className="space-y-1">
              {allFiles.map(r => (
                <div key={r.id} className="flex items-center gap-2 bg-secondary/40 rounded-lg px-3 py-2 group hover:bg-secondary/60 transition-colors">
                  <FileIcon className="w-3 h-3 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground truncate">{r.fileName || 'Archivo'}</p>
                    {r.fileSize && (
                      <span className="text-[9px] text-muted-foreground">
                        {r.fileSize < 1024 * 1024
                          ? `${(r.fileSize / 1024).toFixed(0)} KB`
                          : `${(r.fileSize / (1024 * 1024)).toFixed(1)} MB`}
                      </span>
                    )}
                  </div>
                  <a
                    href={r.content}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-0.5 rounded hover:bg-secondary text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  >
                    <Download className="w-2.5 h-2.5" />
                  </a>
                  <button
                    onClick={() => onRemoveResource(r.id)}
                    className="p-0.5 rounded hover:bg-secondary text-destructive opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <StickyNote className="w-3.5 h-3.5" /> Notas ({allNotes.length})
          </h4>
          {allNotes.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/60">Sin notas</p>
          ) : (
            <div className="space-y-1.5">
              {allNotes.map(r => (
                <div key={r.id} className="bg-secondary/40 rounded-lg px-3 py-2.5 group hover:bg-secondary/60 transition-colors relative">
                  <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-4 pr-5">{r.content}</p>
                  <span className="text-[9px] text-muted-foreground mt-1 block">
                    {new Date(r.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                  </span>
                  <button
                    onClick={() => onRemoveResource(r.id)}
                    className="absolute top-2 right-2 p-0.5 rounded hover:bg-secondary text-destructive opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Files from "Mis Archivos" linked to this entity (and descendants) */}
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <FolderArchive className="w-3.5 h-3.5" /> Mis Archivos
          </h4>
          {(() => {
            const descendants: { type: EntityType; id: string }[] = [];
            if (entityType === 'project') {
              tasks.filter(t => t.projectId === entityId).forEach(t => descendants.push({ type: 'task', id: t.id }));
            } else if (entityType === 'area') {
              const areaProjects = projects.filter(p => p.areaId === entityId);
              areaProjects.forEach(p => {
                descendants.push({ type: 'project', id: p.id });
                tasks.filter(t => t.projectId === p.id).forEach(t => descendants.push({ type: 'task', id: t.id }));
              });
            }
            return (
              <LinkedFilesList
                entityType={entityType}
                entityId={entityId}
                descendantIds={descendants}
              />
            );
          })()}
        </div>
      </div>
    );
  };

  if (project) {
    const parentArea = areas.find(a => a.id === project.areaId);
    const projectTasks = tasks.filter(t => t.projectId === project.id);
    const activeTasks = projectTasks.filter(t => t.status !== 'finished');
    const finishedTasks = projectTasks.filter(t => t.status === 'finished');

    return (
      <div className="flex gap-6 items-start">
        {/* Main column */}
        <motion.div
          key={project.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-1 min-w-0 bg-card rounded-xl border border-border shadow-card overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
              <button onClick={() => onEditEntity('area', parentArea?.id || '')} className="hover:text-primary transition-colors cursor-pointer">
                {parentArea?.name}
              </button>
              <span>›</span>
              <span>Proyecto</span>
            </div>
            <div className="flex items-center gap-3">
              <FolderOpen className="w-5 h-5 text-primary" />
              <h2
                className="text-lg font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                onClick={() => onEditEntity('project', project.id)}
              >
                {project.name}
              </h2>
              <ImportanceBadge importance={project.importance} />
              <StatusIcon status={project.status} />
            </div>
            {project.description && (
              <p className="text-xs text-muted-foreground mt-1">{project.description}</p>
            )}
          </div>

          <Tabs defaultValue="tasks" className="w-full">
            <div className="px-5 py-2 border-b border-border">
              <TabsList className="h-8">
                <TabsTrigger value="tasks" className="text-xs gap-1"><ListChecks className="w-3 h-3" /> Tareas</TabsTrigger>
                <TabsTrigger value="wiki" className="text-xs gap-1"><BookOpen className="w-3 h-3" /> Wiki</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="tasks">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              <ListChecks className="w-3.5 h-3.5 inline mr-1" />
              {activeTasks.length} tareas{finishedTasks.length > 0 && ` · ${finishedTasks.length} cerradas`}
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-[10px]">
                <button
                  onClick={() => setTaskSort('score')}
                  className={`px-1.5 py-0.5 rounded transition-colors ${taskSort === 'score' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Score
                </button>
                <button
                  onClick={() => setTaskSort('date')}
                  className={`px-1.5 py-0.5 rounded transition-colors ${taskSort === 'date' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Fecha
                </button>
              </div>
              <button
                onClick={() => onAddTask(project.id)}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
              >
                <Plus className="w-3 h-3" /> Nueva tarea
              </button>
            </div>
          </div>

          <div className="divide-y divide-border">
            {activeTasks.length === 0 && finishedTasks.length === 0 ? (
              <div className="px-5 py-6 text-center text-xs text-muted-foreground">
                Sin tareas aún. Crea una para empezar.
              </div>
            ) : activeTasks.length === 0 ? (
              <div className="px-5 py-4 text-center text-xs text-muted-foreground">
                Todas las tareas están cerradas.
              </div>
            ) : (
              [...activeTasks].sort((a, b) => {
                if (taskSort === 'score') {
                  return scoreTaskDetailed(b, projects, areas).total - scoreTaskDetailed(a, projects, areas).total;
                }
                // Sort by date: tasks with date first (ascending), then without date
                const da = a.reviewDate || '9999-12-31';
                const db = b.reviewDate || '9999-12-31';
                return da.localeCompare(db);
              }).map(task => {
                const breakdown = scoreTaskDetailed(task, projects, areas);
                return (
                <div key={task.id} className="px-5 py-3 hover:bg-secondary/30 transition-colors group">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">{getTaskDisplayId(projects, task)}</span>
                    <StatusIcon status={task.status} />
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => onEditEntity('task', task.id)}
                    >
                      <span className="text-sm text-foreground hover:text-primary transition-colors">{task.name}</span>
                      {task.reviewDate && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <CalendarClock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">{task.reviewDate}</span>
                        </div>
                      )}
                    </div>
                    {/* Score breakdown */}
                    <div className="shrink-0 flex items-center gap-1.5" title={[breakdown.baseLabel, breakdown.urgencyLabel, breakdown.cascadeLabel, breakdown.multiplierLabel].filter(Boolean).join(' · ')}>
                      <span className={`text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded ${
                        breakdown.total >= 80 ? 'text-destructive bg-destructive/10' :
                        breakdown.total >= 50 ? 'text-amber-600 bg-amber-500/10' :
                        'text-muted-foreground bg-secondary'
                      }`}>
                        {breakdown.total}
                      </span>
                      <div className="hidden group-hover:flex items-center gap-1 text-[9px] text-muted-foreground">
                        {breakdown.urgencyLabel && <span className="bg-destructive/10 text-destructive px-1 py-0.5 rounded">{breakdown.urgencyLabel}</span>}
                        {breakdown.cascadeLabel && <span className="bg-amber-500/10 text-amber-600 px-1 py-0.5 rounded">{breakdown.cascadeLabel}</span>}
                        {breakdown.multiplierLabel && <span className="bg-secondary px-1 py-0.5 rounded">{breakdown.multiplierLabel}</span>}
                      </div>
                    </div>
                  </div>
                </div>
                );
              })
            )}
          </div>

          {/* Finished tasks - collapsible */}
          {finishedTasks.length > 0 && (
            <div className="border-t border-border">
              <button
                onClick={() => setShowFinished(!showFinished)}
                className="w-full flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary/30 transition-colors"
              >
                {showFinished ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                <CheckCircle2 className="w-3.5 h-3.5 text-status-finished" />
                Cerradas ({finishedTasks.length})
              </button>
              {showFinished && (
                <div className="divide-y divide-border bg-muted/20">
                  {finishedTasks.map(task => (
                    <div key={task.id} className="px-5 py-2.5 hover:bg-secondary/20 transition-colors group opacity-60">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{getTaskDisplayId(projects, task)}</span>
                        <StatusIcon status={task.status} />
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => onEditEntity('task', task.id)}
                        >
                          <span className="text-sm text-muted-foreground line-through hover:text-foreground transition-colors">{task.name}</span>
                        </div>
                        <select
                          value={task.status}
                          onChange={e => onUpdateTask(task.id, { status: e.target.value as Task['status'] })}
                          className="text-[10px] bg-secondary text-secondary-foreground rounded px-1.5 py-0.5 outline-none opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {Object.entries(STATUS_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => onDeleteTask(task.id)}
                          className="p-1 rounded hover:bg-secondary text-destructive opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Attention required section */}
          {(() => {
            const today = getTodayKeyCET();
            const attentionTasks = projectTasks.filter(
              t => t.status !== 'finished' && (!t.reviewDate || t.reviewDate < today)
            );
            if (attentionTasks.length === 0) return null;
            return (
              <div className="px-5 py-3 border-t border-border bg-destructive/5">
                <h4 className="text-xs font-semibold text-destructive flex items-center gap-1.5 mb-2">
                  <CalendarClock className="w-3.5 h-3.5" />
                  Requiere atención ({attentionTasks.length})
                </h4>
                <div className="space-y-1.5">
                  {attentionTasks.map(task => (
                    <div
                      key={task.id}
                      onClick={() => onEditEntity('task', task.id)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/5 hover:bg-destructive/10 cursor-pointer transition-colors"
                    >
                      <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                        {getTaskDisplayId(projects, task)}
                      </span>
                      <StatusIcon status={task.status} />
                      <span className="text-xs text-foreground truncate flex-1">{task.name}</span>
                      <ImportanceBadge importance={task.importance} />
                      {task.reviewDate ? (
                        <span className="text-[10px] text-destructive font-medium">{task.reviewDate}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">Sin fecha</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
            </TabsContent>

            <TabsContent value="wiki" className="p-5">
              <WikiPageEditor
                pages={wikiPages}
                entityType="project"
                entityId={project.id}
                entityName={project.name}
                onAdd={onAddWikiPage}
                onUpdate={onUpdateWikiPage}
                onDelete={onDeleteWikiPage}
              />
            </TabsContent>
          </Tabs>
        </motion.div>

        {/* Right sidebar - Resources */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="w-72 shrink-0 sticky top-20 bg-card rounded-xl border border-border shadow-card p-4 max-h-[calc(100vh-120px)] overflow-y-auto"
        >
          {/* Called as a function (not <ResourcesSidebar/>) on purpose: it is
              defined inside DetailPanel, so rendering it as an element gives it
              a new component identity every render, remounting its whole subtree
              (LinkedFilesList → useDrive → 4 Firestore listeners re-subscribed
              on every render). Inlining keeps LinkedFilesList's position stable. */}
          {ResourcesSidebar({ entityType: 'project', entityId: project.id })}
        </motion.div>
      </div>
    );
  }

  if (area) {
    const areaProjects = projects.filter(p => p.areaId === area.id);

    return (
      <div className="flex gap-6 items-start">
        {/* Main column */}
        <motion.div
          key={area.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-1 min-w-0 bg-card rounded-xl border border-border shadow-card overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
                <FolderOpen className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h2
                  className="text-lg font-semibold text-foreground hover:text-primary transition-colors cursor-pointer"
                  onClick={() => onEditEntity('area', area.id)}
                >
                  {area.name}
                </h2>
                <p className="text-xs text-muted-foreground">{area.description}</p>
              </div>
              <ImportanceBadge importance={area.importance} />
              <StatusIcon status={area.status} />
            </div>
          </div>

          <Tabs defaultValue="projects" className="w-full">
            <div className="px-5 py-2 border-b border-border">
              <TabsList className="h-8">
                <TabsTrigger value="projects" className="text-xs gap-1"><FolderOpen className="w-3 h-3" /> Proyectos ({areaProjects.length})</TabsTrigger>
                <TabsTrigger value="wiki" className="text-xs gap-1"><BookOpen className="w-3 h-3" /> Wiki</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="projects">

          <div className="divide-y divide-border">
            {areaProjects.map(p => {
              const pTasks = tasks.filter(t => t.projectId === p.id);
              return (
                <div
                  key={p.id}
                  className="px-5 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors cursor-pointer"
                  onClick={() => onEditEntity('project', p.id)}
                >
                  <StatusIcon status={p.status} />
                  <div className="flex-1">
                    <span className="text-sm text-foreground hover:text-primary transition-colors">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{pTasks.length} tareas</span>
                  </div>
                  {ResourceBadges({ entityType: 'project', entityId: p.id })}
                  <ImportanceBadge importance={p.importance} />
                </div>
              );
            })}
          </div>

          {/* Attention required section */}
          {(() => {
            const today = getTodayKeyCET();
            // Collect projects needing attention
            const attentionProjects = areaProjects.filter(
              p => p.status !== 'finished' && (!p.reviewDate || p.reviewDate < today)
            );
            // Collect tasks from area's projects needing attention
            const areaTasks = tasks.filter(t => areaProjects.some(p => p.id === t.projectId));
            const attentionTasks = areaTasks.filter(
              t => t.status !== 'finished' && (!t.reviewDate || t.reviewDate < today)
            );
            if (attentionProjects.length === 0 && attentionTasks.length === 0) return null;
            return (
              <div className="px-5 py-3 border-t border-border bg-destructive/5">
                <h4 className="text-xs font-semibold text-destructive flex items-center gap-1.5 mb-2">
                  <CalendarClock className="w-3.5 h-3.5" />
                  Requiere atención ({attentionProjects.length + attentionTasks.length})
                </h4>
                <div className="space-y-1.5">
                  {attentionProjects.map(p => (
                    <div
                      key={p.id}
                      onClick={() => onEditEntity('project', p.id)}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/5 hover:bg-destructive/10 cursor-pointer transition-colors"
                    >
                      <FolderOpen className="w-3 h-3 text-muted-foreground shrink-0" />
                      <StatusIcon status={p.status} />
                      <span className="text-xs text-foreground truncate flex-1">{p.name}</span>
                      <span className="text-[9px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">Proyecto</span>
                      <ImportanceBadge importance={p.importance} />
                      {p.reviewDate ? (
                        <span className="text-[10px] text-destructive font-medium">{p.reviewDate}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic">Sin fecha</span>
                      )}
                    </div>
                  ))}
                  {attentionTasks.map(task => {
                    const taskProject = projects.find(p => p.id === task.projectId);
                    return (
                      <div
                        key={task.id}
                        onClick={() => onEditEntity('task', task.id)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/5 hover:bg-destructive/10 cursor-pointer transition-colors"
                      >
                        <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
                          {getTaskDisplayId(projects, task)}
                        </span>
                        <StatusIcon status={task.status} />
                        <span className="text-xs text-foreground truncate flex-1">{task.name}</span>
                        {taskProject && (
                          <span className="text-[9px] text-muted-foreground truncate max-w-[80px]">{taskProject.name}</span>
                        )}
                        <ImportanceBadge importance={task.importance} />
                        {task.reviewDate ? (
                          <span className="text-[10px] text-destructive font-medium">{task.reviewDate}</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground italic">Sin fecha</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
            </TabsContent>

            <TabsContent value="wiki" className="p-5">
              <WikiPageEditor
                pages={wikiPages}
                entityType="area"
                entityId={area.id}
                entityName={area.name}
                onAdd={onAddWikiPage}
                onUpdate={onUpdateWikiPage}
                onDelete={onDeleteWikiPage}
              />
            </TabsContent>
          </Tabs>
        </motion.div>

        {/* Right sidebar - Resources */}
        <motion.div
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="w-72 shrink-0 sticky top-20 bg-card rounded-xl border border-border shadow-card p-4 max-h-[calc(100vh-120px)] overflow-y-auto"
        >
          {ResourcesSidebar({ entityType: 'area', entityId: area.id })}
        </motion.div>
      </div>
    );
  }

  return null;
}
