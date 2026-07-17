import { motion } from 'framer-motion';
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
    <header className="sticky top-0 z-40 w-full border-b border-border/40 bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60 shadow-sm">
      <div className="w-full px-4 md:px-6 py-3.5 flex items-center gap-4">
        {/* Logo + Breadcrumb Section */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Logo Button */}
          <motion.button
            onClick={onBackToDashboard}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-secondary/60 transition-all duration-200 flex-shrink-0 active:scale-95"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            title="Ir al Dashboard"
          >
            <div className="relative w-6 h-6 flex-shrink-0">
              <img src="/logo.svg" alt="JL's Brain" className="w-full h-full" />
            </div>
            <span className="hidden sm:inline text-sm font-bold bg-gradient-to-r from-primary to-primary/80 bg-clip-text text-transparent">
              JL's Brain
            </span>
          </motion.button>

          {/* Breadcrumb Navigation */}
          <nav className="flex items-center gap-1.5 min-w-0 flex-1 text-xs md:text-sm">
            <motion.button
              onClick={onBackToDashboard}
              className={`px-2.5 py-1.5 rounded-md font-medium transition-all duration-200 flex-shrink-0 ${
                showDashboard && viewMode === 'dashboard'
                  ? 'text-primary bg-primary/10 ring-1 ring-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              }`}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              Dashboard
            </motion.button>

            {selectedArea && (
              <>
                <span className="text-muted-foreground/30 font-light flex-shrink-0">/</span>
                <motion.button
                  onClick={() => onSelectArea(selectedArea.id)}
                  className="text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-md transition-all duration-200 truncate hover:bg-secondary/40"
                  title={selectedArea.name}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  {selectedArea.name}
                </motion.button>
              </>
            )}

            {selectedProject && (
              <>
                <span className="text-muted-foreground/30 font-light flex-shrink-0">/</span>
                <span className="text-foreground font-semibold px-2.5 py-1.5 rounded-md truncate" title={selectedProject.name}>
                  {selectedProject.name}
                </span>
              </>
            )}
          </nav>
        </div>

        {/* Search - Center */}
        <div className="flex-1 max-w-xl mx-auto px-2 hidden sm:block">
          <GlobalSearch
            areas={areas}
            projects={projects}
            tasks={tasks}
            onSelectArea={onSelectArea}
            onSelectProject={onSelectProject}
            onEditEntity={onEditEntity}
          />
        </div>

        {/* View Toggle - Right */}
        <div className="flex items-center gap-1.5 bg-secondary/30 rounded-xl p-1.5 flex-shrink-0 ring-1 ring-secondary/40">
          {viewOptions.map(({ id, label, icon: Icon }) => (
            <motion.button
              key={id}
              onClick={() => onChangeView(id as ViewMode)}
              className={`relative flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                viewMode === id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              title={label}
            >
              {viewMode === id && (
                <motion.div
                  layoutId="navbar-indicator"
                  className="absolute inset-0 bg-card rounded-lg shadow-sm ring-1 ring-primary/10"
                  transition={{ duration: 0.3 }}
                />
              )}
              <Icon className="w-4 h-4 flex-shrink-0 relative z-10" />
              <span className="hidden lg:inline relative z-10">{label}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </header>
  );
}
