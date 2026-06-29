import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Archive, AlertTriangle, ArrowRight, Timer, TrendingDown, Layers, FolderKanban, CheckSquare, List, Columns, LayoutGrid } from 'lucide-react';
import type { Task, Project, Area, Resource, EntityType } from '@/types';
import { getTaskDisplayId, getEffortLabel, IMPORTANCE_LABELS, STATUS_LABELS } from '@/types';
import { ImportanceBadge, StatusIcon } from './StatusBadges';
import { scoreTask, scoreProject, scoreArea, isGroomingCandidate, scoreTaskDetailed, type ScoreBreakdown } from '@/lib/scoring';
import { getTodayKeyCET } from '@/lib/dateUtils';
import { BacklogKanban } from './BacklogKanban';
import { BacklogEntityKanban } from './BacklogEntityKanban';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

type BacklogTab = 'tasks' | 'projects' | 'areas';
type ViewMode = 'list' | 'kanban-importance' | 'kanban-status';

interface BacklogViewProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  resources: Resource[];
  onEditEntity: (type: EntityType, id: string) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onUpdateProject: (id: string, patch: Partial<Project>) => void;
  onUpdateArea: (id: string, patch: Partial<Area>) => void;
}

const ScoreBadge = ({ score, breakdown }: { score: number; breakdown?: ScoreBreakdown }) => {
  const badge = (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${breakdown ? 'cursor-help' : ''} ${
      score >= 100 ? 'bg-importance-critical/15 text-importance-critical' :
      score >= 60 ? 'bg-importance-important/15 text-importance-important' :
      score >= 30 ? 'bg-primary/10 text-primary' :
      'bg-muted text-muted-foreground'
    }`}>
      {score} pts
    </span>
  );
  if (!breakdown) return badge;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent side="right" className="max-w-[220px] p-3 space-y-1.5 text-xs">
          <p className="font-semibold text-foreground mb-1">Desglose de score</p>
          <p className="text-muted-foreground">{breakdown.baseLabel}</p>
          {breakdown.urgencyLabel && <p className="text-importance-important">{breakdown.urgencyLabel}</p>}
          {breakdown.cascadeLabel && <p className="text-primary">{breakdown.cascadeLabel}</p>}
          {breakdown.multiplierLabel && <p className="text-muted-foreground">{breakdown.multiplierLabel}</p>}
          <p className="font-semibold text-foreground pt-1 border-t border-border">Total: ({breakdown.base}{breakdown.urgency > 0 ? `+${breakdown.urgency}` : ''}{breakdown.cascade > 0 ? `+${breakdown.cascade}` : ''}) {breakdown.multiplier !== 1 ? `× ${breakdown.multiplier}` : ''} = {score}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export function BacklogView({ tasks, projects, areas, resources, onEditEntity, onUpdateTask, onUpdateProject, onUpdateArea }: BacklogViewProps) {
  const [tab, setTab] = useState<BacklogTab>('tasks');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const scoredTasks = useMemo(() => {
    return tasks.filter(t => t.status !== 'finished')
      .map(t => ({ task: t, score: scoreTask(t, projects, areas), breakdown: scoreTaskDetailed(t, projects, areas) }))
      .sort((a, b) => b.score - a.score);
  }, [tasks, projects, areas]);

  const groomingCandidates = useMemo(() =>
    scoredTasks.filter(({ task, score }) => isGroomingCandidate(task, score)), [scoredTasks]);
  const regularTasks = useMemo(() =>
    scoredTasks.filter(({ task, score }) => !isGroomingCandidate(task, score)), [scoredTasks]);

  const scoredProjects = useMemo(() => {
    return projects.filter(p => p.status !== 'finished')
      .map(p => ({ project: p, score: scoreProject(p, areas) }))
      .sort((a, b) => b.score - a.score);
  }, [projects, areas]);

  const scoredAreas = useMemo(() => {
    return areas.filter(a => a.status !== 'finished')
      .map(a => ({ area: a, score: scoreArea(a) }))
      .sort((a, b) => b.score - a.score);
  }, [areas]);

  const getProjectName = (projectId: string) => projects.find(p => p.id === projectId)?.name || '';
  const getAreaName = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return '';
    return areas.find(a => a.id === project.areaId)?.name || '';
  };
  const getAreaNameById = (areaId: string) => areas.find(a => a.id === areaId)?.name || '';

  const handleArchive = (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdateTask(taskId, { status: 'finished' });
  };

  const today = getTodayKeyCET();

  const tabs: { key: BacklogTab; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'tasks', label: 'Tareas', icon: <CheckSquare className="w-3.5 h-3.5" />, count: scoredTasks.length },
    { key: 'projects', label: 'Proyectos', icon: <FolderKanban className="w-3.5 h-3.5" />, count: scoredProjects.length },
    { key: 'areas', label: 'Áreas', icon: <Layers className="w-3.5 h-3.5" />, count: scoredAreas.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {/* Tab selector (left) */}
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-0.5">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setViewMode('list'); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                tab === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.icon}
              {t.label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                tab === t.key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>{t.count}</span>
            </button>
          ))}
        </div>

        {/* View mode selector (right) */}
        <div className="flex items-center gap-1 bg-secondary rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              viewMode === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            Lista
          </button>
          <button
            onClick={() => setViewMode('kanban-importance')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              viewMode === 'kanban-importance' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            Por Importancia
          </button>
          <button
            onClick={() => setViewMode('kanban-status')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              viewMode === 'kanban-status' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Por Estado
          </button>
        </div>
      </div>

      {/* ── Tasks Tab ── */}
      {tab === 'tasks' && (
        viewMode === 'list' ? (
          <>
            <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
              <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Backlog de Tareas</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  {scoredTasks.length} tareas · ordenadas por prioridad calculada
                </span>
              </div>
              <div className="divide-y divide-border">
                {regularTasks.length === 0 ? (
                  <div className="px-5 py-8 text-center text-xs text-muted-foreground">No hay tareas pendientes.</div>
                ) : (
                  regularTasks.map(({ task, score, breakdown }) => (
                    <TaskRow key={task.id} task={task} score={score} breakdown={breakdown} projects={projects} areas={areas}
                      getAreaName={getAreaName} getProjectName={getProjectName}
                      onEditEntity={onEditEntity} today={today} />
                  ))
                )}
              </div>
            </div>
            {groomingCandidates.length > 0 && (
              <div className="bg-card rounded-xl border border-dashed border-muted-foreground/30 shadow-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-importance-important" />
                  <h2 className="text-sm font-semibold text-foreground">Candidatas a Limpieza</h2>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {groomingCandidates.length} tareas de bajo valor o estancadas
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {groomingCandidates.map(({ task, score, breakdown }) => (
                    <TaskRow key={task.id} task={task} score={score} breakdown={breakdown} projects={projects} areas={areas}
                      getAreaName={getAreaName} getProjectName={getProjectName}
                      onEditEntity={onEditEntity} onArchive={handleArchive} today={today} isGrooming />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <BacklogKanban tasks={tasks} projects={projects} areas={areas}
            onEditEntity={onEditEntity} onUpdateTask={onUpdateTask}
            mode={viewMode === 'kanban-importance' ? 'importance' : 'status'} />
        )
      )}

      {/* ── Projects Tab ── */}
      {tab === 'projects' && (
        viewMode === 'list' ? (
          <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <FolderKanban className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Backlog de Proyectos</h2>
              <span className="text-xs text-muted-foreground ml-auto">
                {scoredProjects.length} proyectos · ordenados por prioridad calculada
              </span>
            </div>
            <div className="divide-y divide-border">
              {scoredProjects.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-muted-foreground">No hay proyectos activos.</div>
              ) : (
                scoredProjects.map(({ project, score }) => {
                  const taskCount = tasks.filter(t => t.projectId === project.id && t.status !== 'finished').length;
                  return (
                    <motion.div key={project.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors cursor-pointer"
                      onClick={() => onEditEntity('project', project.id)}>
                      <ScoreBadge score={score} />
                      <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">{project.key}</span>
                      <StatusIcon status={project.status} />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-foreground truncate block">{project.name}</span>
                        <span className="text-[10px] text-primary hover:underline cursor-pointer"
                          onClick={(e) => { e.stopPropagation(); onEditEntity('area', project.areaId); }}>{getAreaNameById(project.areaId)}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                        {taskCount} tarea{taskCount !== 1 ? 's' : ''}
                      </span>
                      <ImportanceBadge importance={project.importance} />
                      {project.reviewDate && (
                        <span className={`text-[10px] shrink-0 ${project.reviewDate < today ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          {project.reviewDate}
                        </span>
                      )}
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <BacklogEntityKanban entityKind="project" projects={projects} areas={areas}
            tasks={tasks} onEditEntity={onEditEntity} onUpdateProject={onUpdateProject}
            mode={viewMode === 'kanban-importance' ? 'importance' : 'status'} />
        )
      )}

      {/* ── Areas Tab ── */}
      {tab === 'areas' && (
        viewMode === 'list' ? (
          <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Backlog de Áreas</h2>
              <span className="text-xs text-muted-foreground ml-auto">
                {scoredAreas.length} áreas · ordenadas por prioridad calculada
              </span>
            </div>
            <div className="divide-y divide-border">
              {scoredAreas.length === 0 ? (
                <div className="px-5 py-8 text-center text-xs text-muted-foreground">No hay áreas activas.</div>
              ) : (
                scoredAreas.map(({ area, score }) => {
                  const projectCount = projects.filter(p => p.areaId === area.id && p.status !== 'finished').length;
                  const taskCount = tasks.filter(t => {
                    const proj = projects.find(p => p.id === t.projectId);
                    return proj?.areaId === area.id && t.status !== 'finished';
                  }).length;
                  return (
                    <motion.div key={area.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors cursor-pointer"
                      onClick={() => onEditEntity('area', area.id)}>
                      <ScoreBadge score={score} />
                      <StatusIcon status={area.status} />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-foreground truncate block">{area.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {projectCount} proyecto{projectCount !== 1 ? 's' : ''} · {taskCount} tarea{taskCount !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <ImportanceBadge importance={area.importance} />
                      {area.reviewDate && (
                        <span className={`text-[10px] shrink-0 ${area.reviewDate < today ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                          {area.reviewDate}
                        </span>
                      )}
                    </motion.div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <BacklogEntityKanban entityKind="area" projects={projects} areas={areas}
            tasks={tasks} onEditEntity={onEditEntity} onUpdateArea={onUpdateArea}
            mode={viewMode === 'kanban-importance' ? 'importance' : 'status'} />
        )
      )}
    </div>
  );
}

/* ── Task Row (extracted) ── */
function TaskRow({
  task, score, breakdown, projects, areas, getAreaName, getProjectName, onEditEntity, onArchive, today, isGrooming,
}: {
  task: Task; score: number; breakdown: ScoreBreakdown; projects: Project[]; areas: Area[];
  getAreaName: (projectId: string) => string; getProjectName: (projectId: string) => string;
  onEditEntity: (type: EntityType, id: string) => void;
  onArchive?: (id: string, e: React.MouseEvent) => void;
  today: string; isGrooming?: boolean;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className={`px-4 py-3 flex items-center gap-3 hover:bg-secondary/30 transition-colors group cursor-pointer ${
        isGrooming ? 'border border-dashed border-muted-foreground/30 rounded-lg' : ''
      }`}
      onClick={() => onEditEntity('task', task.id)}>
      <ScoreBadge score={score} breakdown={breakdown} />
      <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">
        {getTaskDisplayId(projects, task)}
      </span>
      <StatusIcon status={task.status} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-foreground truncate block">{task.name}</span>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-primary hover:underline cursor-pointer"
            onClick={(e) => { e.stopPropagation(); const project = projects.find(p => p.id === task.projectId); if (project) { const area = areas.find(a => a.id === project.areaId); if (area) onEditEntity('area', area.id); } }}>
            {getAreaName(task.projectId)}
          </span>
          <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
          <span className="text-[10px] text-primary hover:underline cursor-pointer"
            onClick={(e) => { e.stopPropagation(); onEditEntity('project', task.projectId); }}>
            {getProjectName(task.projectId)}
          </span>
        </div>
      </div>
      {task.effort && (
        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
          <Timer className="w-2.5 h-2.5" />{getEffortLabel(task.effort)}
        </span>
      )}
      <ImportanceBadge importance={task.importance} />
      {task.reviewDate && (
        <span className={`text-[10px] shrink-0 ${task.reviewDate < today ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
          {task.reviewDate}
        </span>
      )}
      {isGrooming && onArchive && (
        <button onClick={(e) => onArchive(task.id, e)}
          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all opacity-0 group-hover:opacity-100 shrink-0"
          title="Archivar (marcar como finalizada)">
          <Archive className="w-3.5 h-3.5" />
        </button>
      )}
    </motion.div>
  );
}
