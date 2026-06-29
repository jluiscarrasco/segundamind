import { useState, useCallback } from 'react';
import { GlobalSearch } from '@/components/GlobalSearch';
import { AnimatePresence } from 'framer-motion';
import { AppSidebar } from '@/components/AppSidebar';
import { TuAgenda } from '@/components/TuAgenda';
import { WeekAgenda } from '@/components/WeekAgenda';
import { UnprocessedNotes } from '@/components/UnprocessedNotes';
import { CommandDialog } from '@/components/CommandDialog';
import { ContextPanel } from '@/components/ContextPanel';
import { ShortcutsHelpDialog } from '@/components/ShortcutsHelpDialog';
import { useCommandPalette } from '@/hooks/useCommandPalette';
import { useContextPanel } from '@/hooks/useContextPanel';
import { useKeyboardShortcut } from '@/hooks/useKeyboardShortcuts';

import { DashboardStats } from '@/components/DashboardStats';
import { AreaHealthCards } from '@/components/AreaHealthCards';
import { RecentActivity } from '@/components/RecentActivity';
import { InboxPanel } from '@/components/InboxPanel';
import { DetailPanel } from '@/components/DetailPanel';
import { EntitySidebar, type EntityFormData } from '@/components/EntitySidebar';
import { KanbanBoard } from '@/components/KanbanBoard';
import { CalendarView } from '@/components/CalendarView';
import { BacklogView } from '@/components/BacklogView';
import { KnowledgeBaseView } from '@/components/KnowledgeBaseView';
import { FilesView } from '@/components/FilesView';
import { MobileNoteCaptureView } from '@/components/MobileNoteCaptureView';
import { AiAssistantView } from '@/components/AiAssistantView';

import { useStore } from '@/store/useStore';
import { useIsMobile } from '@/hooks/use-mobile';
import type { EntityType } from '@/types';
import { getTaskDisplayId } from '@/types';
import { LayoutDashboard, Columns3, CalendarDays, ListOrdered, BookOpen, FolderArchive, Sparkles } from 'lucide-react';
import { addDaysCETKey } from '@/lib/dateUtils';

type ModalState =
  | null
  | { mode: 'create'; type: 'area' }
  | { mode: 'create'; type: 'project'; areaId: string }
  | { mode: 'create'; type: 'task'; projectId: string }
  | { mode: 'edit'; type: EntityType; id: string };

type ViewMode = 'dashboard' | 'kanban' | 'calendar' | 'backlog' | 'knowledge' | 'files' | 'assistant';

const Index = () => {
  const store = useStore();
  const isMobile = useIsMobile();
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');

  // Command Palette and Context Panel state
  const commandPalette = useCommandPalette();
  const contextPanel = useContextPanel();
  const [showHelpDialog, setShowHelpDialog] = useState(false);

  const handleSelectArea = (id: string) => {
    setSelectedAreaId(id);
    setSelectedProjectId(null);
  };

  const handleSelectProject = (id: string) => {
    const project = store.projects.find(p => p.id === id);
    if (project) setSelectedAreaId(project.areaId);
    setSelectedProjectId(id);
  };

  const handlePostpone = useCallback((type: 'area' | 'project' | 'task', id: string, days: number) => {
    const newDate = addDaysCETKey(days);
    if (type === 'area') store.updateArea(id, { reviewDate: newDate });
    else if (type === 'project') store.updateProject(id, { reviewDate: newDate });
    else store.updateTask(id, { reviewDate: newDate });
  }, [store]);

  const handleEditEntity = useCallback((type: EntityType, id: string) => {
    setModal({ mode: 'edit', type, id });
  }, []);

  // Keyboard shortcuts
  useKeyboardShortcut('CommandPalette', () => {
    commandPalette.toggle();
  }, !isMobile);

  useKeyboardShortcut('NewTask', () => {
    if (selectedProjectId) {
      setModal({ mode: 'create', type: 'task', projectId: selectedProjectId });
    }
  }, !isMobile);

  useKeyboardShortcut('ContextPanel', () => {
    contextPanel.toggle();
  }, !isMobile);

  useKeyboardShortcut('Help', () => {
    setShowHelpDialog(true);
  }, !isMobile);

  useKeyboardShortcut('Escape', () => {
    commandPalette.close();
    contextPanel.close();
    setShowHelpDialog(false);
  }, !isMobile);

  if (store.loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (isMobile) {
    return (
      <MobileNoteCaptureView
        inbox={store.inbox}
        onAdd={store.addInboxItem}
        onRemove={store.removeInboxItem}
        onEnrichUrl={store.enrichUrlInboxItem}
      />
    );
  }

  const getEditInitialData = (): EntityFormData | undefined => {
    if (!modal || modal.mode !== 'edit') return undefined;
    if (modal.type === 'task') {
      const task = store.tasks.find(t => t.id === modal.id);
      if (!task) return undefined;
      return { name: task.name, description: task.description, importance: task.importance, status: task.status, reviewDate: task.reviewDate, effort: task.effort };
    }
    let entity: { name: string; description: string; importance: any; status: any; reviewDate: string | null } | undefined;
    if (modal.type === 'area') entity = store.areas.find(a => a.id === modal.id);
    else entity = store.projects.find(p => p.id === modal.id);
    if (!entity) return undefined;
    return { name: entity.name, description: entity.description, importance: entity.importance, status: entity.status, reviewDate: entity.reviewDate };
  };

  const handleModalSubmit = (data: EntityFormData) => {
    if (!modal) return;
    if (modal.mode === 'create') {
      if (modal.type === 'area') store.addArea(data);
      else if (modal.type === 'project') store.addProject({ ...data, areaId: modal.areaId });
      else store.addTask({ ...data, effort: data.effort ?? null, projectId: modal.projectId });
    } else {
      if (modal.type === 'area') store.updateArea(modal.id, data);
      else if (modal.type === 'project') store.updateProject(modal.id, data);
      else store.updateTask(modal.id, data);
    }
    setModal(null);
  };

  const handleModalDelete = () => {
    if (!modal || modal.mode !== 'edit') return;
    if (modal.type === 'area') store.deleteArea(modal.id);
    else if (modal.type === 'project') store.deleteProject(modal.id);
    else store.deleteTask(modal.id);
    setModal(null);
  };

  const selectedArea = selectedAreaId ? store.areas.find(a => a.id === selectedAreaId) || null : null;
  const selectedProject = selectedProjectId ? store.projects.find(p => p.id === selectedProjectId) || null : null;
  const showDashboard = !selectedAreaId && !selectedProjectId;

  // Filtered data based on sidebar selection
  const filteredProjects = selectedProjectId
    ? store.projects.filter(p => p.id === selectedProjectId)
    : selectedAreaId
      ? store.projects.filter(p => p.areaId === selectedAreaId)
      : store.projects;
  
  const filteredProjectIds = new Set(filteredProjects.map(p => p.id));
  
  const filteredTasks = store.tasks.filter(t => filteredProjectIds.has(t.projectId));
  
  const filteredAreas = selectedAreaId
    ? store.areas.filter(a => a.id === selectedAreaId)
    : store.areas;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AppSidebar
        areas={store.areas}
        projects={store.projects}
        selectedAreaId={selectedAreaId}
        selectedProjectId={selectedProjectId}
        onSelectArea={handleSelectArea}
        onSelectProject={handleSelectProject}
        onAddArea={() => setModal({ mode: 'create', type: 'area' })}
        onAddProject={(areaId) => setModal({ mode: 'create', type: 'project', areaId })}
      />

      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border px-6 py-3 flex items-center gap-3">
          {/* Breadcrumb */}
          <button
            onClick={() => { setSelectedAreaId(null); setSelectedProjectId(null); setViewMode('dashboard'); }}
            className={`flex items-center gap-2 text-sm font-medium transition-colors ${showDashboard && viewMode === 'dashboard' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          {selectedArea && (
            <>
              <span className="text-muted-foreground text-xs">›</span>
              <button
                onClick={() => { setSelectedProjectId(null); }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {selectedArea.name}
              </button>
            </>
          )}
          {selectedProject && (
            <>
              <span className="text-muted-foreground text-xs">›</span>
              <span className="text-sm text-foreground font-medium">{selectedProject.name}</span>
            </>
          )}

          <GlobalSearch
            areas={store.areas}
            projects={store.projects}
            tasks={store.tasks}
            onSelectArea={handleSelectArea}
            onSelectProject={handleSelectProject}
            onEditEntity={handleEditEntity}
          />

          {/* View mode toggle */}
          <div className="ml-auto flex items-center gap-1 bg-secondary rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('dashboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'dashboard'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Dashboard
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'kanban'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Columns3 className="w-3.5 h-3.5" />
              Board
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'calendar'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              Calendario
            </button>
            <button
              onClick={() => setViewMode('backlog')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'backlog'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ListOrdered className="w-3.5 h-3.5" />
              Backlog
            </button>
            <button
              onClick={() => setViewMode('knowledge')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'knowledge'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Conocimiento
            </button>
            <button
              onClick={() => setViewMode('files')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'files'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <FolderArchive className="w-3.5 h-3.5" />
              Archivos
            </button>
            <button
              onClick={() => setViewMode('assistant')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === 'assistant'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Asistente
            </button>
          </div>
        </header>

        {viewMode === 'knowledge' ? (
          <KnowledgeBaseView
            wikiPages={store.wikiPages}
            areas={store.areas}
            projects={store.projects}
          />
        ) : viewMode === 'files' ? (
          <FilesView />
        ) : viewMode === 'assistant' ? (
          <AiAssistantView />
        ) : viewMode === 'kanban' ? (
          <div className="p-6 space-y-4">
            <KanbanBoard
              tasks={filteredTasks}
              projects={filteredProjects}
              areas={filteredAreas}
              resources={store.resources}
              onEditEntity={handleEditEntity}
              onUpdateTask={store.updateTask}
              onAddTask={(projectId) => setModal({ mode: 'create', type: 'task', projectId })}
              selectedProjectId={selectedProjectId}
            />
          </div>
        ) : viewMode === 'backlog' ? (
          <div className="p-6">
            <BacklogView
              tasks={filteredTasks}
              projects={filteredProjects}
              areas={filteredAreas}
              resources={store.resources}
              onEditEntity={handleEditEntity}
              onUpdateTask={store.updateTask}
              onUpdateProject={store.updateProject}
              onUpdateArea={store.updateArea}
            />
          </div>
        ) : viewMode === 'calendar' ? (
          <div className="p-6">
            <CalendarView
              tasks={filteredTasks}
              projects={filteredProjects}
              areas={filteredAreas}
              onEditEntity={handleEditEntity}
              onPostpone={handlePostpone}
              onUpdateTaskDate={(id, date) => store.updateTask(id, { reviewDate: date })}
              onUpdateProjectDate={(id, date) => store.updateProject(id, { reviewDate: date })}
              onUpdateAreaDate={(id, date) => store.updateArea(id, { reviewDate: date })}
            />
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {!showDashboard ? (
              <DetailPanel
                area={selectedArea}
                project={selectedProject}
                projects={store.projects}
                tasks={store.tasks}
                areas={store.areas}
                resources={store.resources}
                wikiPages={store.wikiPages}
                onAddTask={(projectId) => setModal({ mode: 'create', type: 'task', projectId })}
                onDeleteTask={store.deleteTask}
                onUpdateTask={store.updateTask}
                onEditEntity={handleEditEntity}
                onAddResource={store.addResource}
                onRemoveResource={store.removeResource}
                onAddWikiPage={store.addWikiPage}
                onUpdateWikiPage={store.updateWikiPage}
                onDeleteWikiPage={store.deleteWikiPage}
              />
            ) : (
              <>
                {/* Stat cards */}
                <DashboardStats
                  tasks={filteredTasks}
                  inbox={store.inbox}
                  projects={filteredProjects}
                  areas={filteredAreas}
                  onOpenInbox={() => setInboxOpen(true)}
                />

                {/* Tu Agenda - unified view */}
                <div className="space-y-4">
                  <TuAgenda tasks={filteredTasks} projects={filteredProjects} areas={filteredAreas} resources={store.resources} onEditEntity={handleEditEntity} onPostpone={handlePostpone} />
                  <WeekAgenda tasks={filteredTasks} projects={filteredProjects} areas={filteredAreas} onEditEntity={handleEditEntity} />
                  <UnprocessedNotes items={store.inbox} onOpenInbox={() => setInboxOpen(true)} />
                </div>

                {/* Recent activity */}
                <RecentActivity
                  tasks={filteredTasks}
                  resources={store.resources}
                  projects={filteredProjects}
                  wikiPages={store.wikiPages}
                  onEditEntity={handleEditEntity}
                />
              </>
            )}
          </div>
        )}
      </main>

      <InboxPanel
        items={store.inbox}
        projects={store.projects}
        areas={store.areas}
        tasks={store.tasks}
        onAdd={store.addInboxItem}
        onRemove={store.removeInboxItem}
        onConvertToTask={store.convertInboxToTask}
        onAttachAsNote={store.attachInboxAsNote}
        onEnrichUrl={store.enrichUrlInboxItem}
        isOpen={inboxOpen}
        onToggle={() => setInboxOpen(!inboxOpen)}
      />

      {/* Command Palette */}
      <CommandDialog
        tasks={store.tasks}
        projects={store.projects}
        areas={store.areas}
        isOpen={commandPalette.isOpen}
        onClose={commandPalette.close}
        onEditEntity={handleEditEntity}
        onCreateTask={(projectId) => setModal({ mode: 'create', type: 'task', projectId })}
        onCreateProject={(areaId) => setModal({ mode: 'create', type: 'project', areaId })}
        onCreateArea={() => setModal({ mode: 'create', type: 'area' })}
      />

      {/* Context Panel */}
      <ContextPanel
        isOpen={contextPanel.isOpen}
        entityType={contextPanel.entityType}
        entityId={contextPanel.entityId}
        tasks={store.tasks}
        projects={store.projects}
        areas={store.areas}
        onClose={contextPanel.close}
        onEdit={(type, id) => {
          handleEditEntity(type, id);
          contextPanel.close();
        }}
        onDelete={(type, id) => {
          if (type === 'area') store.deleteArea(id);
          else if (type === 'project') store.deleteProject(id);
          else store.deleteTask(id);
          contextPanel.close();
        }}
      />

      {/* Shortcuts Help Dialog */}
      <ShortcutsHelpDialog isOpen={showHelpDialog} onClose={() => setShowHelpDialog(false)} />

      <AnimatePresence>
        {modal && (
          <EntitySidebar
            type={modal.type}
            mode={modal.mode}
            initialData={modal.mode === 'edit' ? getEditInitialData() : undefined}
            displayId={modal.mode === 'edit' && modal.type === 'task' ? (() => {
              const task = store.tasks.find(t => t.id === modal.id);
              return task ? getTaskDisplayId(store.projects, task) : undefined;
            })() : undefined}
            entityId={modal.mode === 'edit' ? modal.id : undefined}
            resources={store.resources}
            onSubmit={handleModalSubmit}
            onDelete={modal.mode === 'edit' ? handleModalDelete : undefined}
            onClose={() => setModal(null)}
            onAddResource={store.addResource}
            onRemoveResource={store.removeResource}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default Index;
