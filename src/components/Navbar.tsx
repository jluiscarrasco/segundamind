import { LayoutDashboard, CalendarDays, ListOrdered, BookOpen, FolderArchive } from 'lucide-react';
import type { ViewMode } from '@/pages/Index';
import { GlobalSearch } from './GlobalSearch';
import type { Area, Project, Task, EntityType } from '@/types';

interface NavbarProps {
  viewMode: ViewMode;
  selectedArea: Area | null;
  selectedProject: Project | null;
  showDashboard: boolean;
  onBackToDashboard: () => void;
  onChangeView: (mode: ViewMode) => void;
  areas: Area[];
  projects: Project[];
  tasks: Task[];
  onSelectArea: (id: string) => void;
  onSelectProject: (id: string) => void;
  onEditEntity: (type: EntityType, id: string) => void;
}

const viewOptions = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'calendar', label: 'Calendario', icon: CalendarDays },
  { id: 'backlog', label: 'Backlog', icon: ListOrdered },
  { id: 'knowledge', label: 'Conocimiento', icon: BookOpen },
  { id: 'files', label: 'Archivos', icon: FolderArchive },
] as const;

export function Navbar({
  viewMode,
  selectedArea,
  selectedProject,
  showDashboard,
  onBackToDashboard,
  onChangeView,
  areas,
  projects,
  tasks,
  onSelectArea,
  onSelectProject,
  onEditEntity,
}: NavbarProps) {
  return (
    <header className="sticky top-0 z-40 w-full bg-white border-b border-gray-200">
      <div className="w-full px-6 py-3 flex items-center gap-6">
        {/* Logo */}
        <button
          onClick={onBackToDashboard}
          className="flex items-center gap-2 flex-shrink-0 hover:opacity-75 transition-opacity"
          title="Ir al Dashboard"
        >
          <img src="/logo.svg" alt="JL's Brain" className="w-6 h-6" />
          <span className="hidden sm:inline text-sm font-semibold text-gray-900">JL's Brain</span>
        </button>

        {/* Breadcrumb Navigation */}
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <button
            onClick={onBackToDashboard}
            className={`transition-colors ${
              showDashboard && viewMode === 'dashboard'
                ? 'text-gray-900 font-medium'
                : 'hover:text-gray-900'
            }`}
          >
            Dashboard
          </button>

          {selectedArea && (
            <>
              <span className="text-gray-300">/</span>
              <button
                onClick={() => onSelectArea(selectedArea.id)}
                className="hover:text-gray-900 transition-colors truncate max-w-[150px]"
                title={selectedArea.name}
              >
                {selectedArea.name}
              </button>
            </>
          )}

          {selectedProject && (
            <>
              <span className="text-gray-300">/</span>
              <span className="text-gray-900 truncate max-w-[150px] font-medium" title={selectedProject.name}>
                {selectedProject.name}
              </span>
            </>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search - Center */}
        <div className="hidden sm:block flex-1 max-w-sm">
          <GlobalSearch
            areas={areas}
            projects={projects}
            tasks={tasks}
            onSelectArea={onSelectArea}
            onSelectProject={onSelectProject}
            onEditEntity={onEditEntity}
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* View Toggle - Right */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {viewOptions.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onChangeView(id as ViewMode)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                viewMode === id
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
              title={label}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
