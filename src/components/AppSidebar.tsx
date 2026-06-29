import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FolderOpen,
  Calendar,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  KeyRound,
  Settings,
  Bell,
  BellOff,
  BookMarked,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import type { Area, Project } from "@/types";
import { ImportanceDot, StatusIcon } from "./StatusBadges";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { McpAccessDialog } from "./McpAccessDialog";
import { Plug } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { getTodayKeyCET, addDaysCETKey } from "@/lib/dateUtils";

interface AppSidebarProps {
  areas: Area[];
  projects: Project[];
  selectedAreaId: string | null;
  selectedProjectId: string | null;
  onSelectArea: (id: string) => void;
  onSelectProject: (id: string) => void;
  onAddArea: () => void;
  onAddProject: (areaId: string) => void;
  onSelectQuickView?: (view: 'today' | 'tomorrow' | 'unassigned') => void;
}

function SignOutButton() {
  const { user, signOut } = useAuth();
  return (
    <button
      onClick={signOut}
      className="w-full flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors py-1"
      title={user?.email || ""}>
      
      <LogOut className="w-3 h-3" />
      <span className="truncate">{user?.email}</span>
    </button>);

}

function PushNotificationToggle() {
  const { isSupported, isEnabled, isLoading, toggle } = usePushNotifications();
  if (!isSupported) return null;
  return (
    <button
      onClick={toggle}
      disabled={isLoading}
      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      title={isEnabled ? "Desactivar notificaciones" : "Activar notificaciones"}>
      
      {isEnabled ? <Bell className="w-3 h-3 text-primary" /> : <BellOff className="w-3 h-3" />}
    </button>);

}

export function AppSidebar({
  areas,
  projects,
  selectedAreaId,
  selectedProjectId,
  onSelectArea,
  onSelectProject,
  onAddArea,
  onAddProject,
  onSelectQuickView,
}: AppSidebarProps) {
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set(areas.map((a) => a.id)));
  const [showSettings, setShowSettings] = useState(false);

  const toggleArea = (id: string) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const activeAreas = areas.filter((a) => a.status !== "blocked" && a.status !== "finished");
  const todayKey = getTodayKeyCET();
  const tomorrowKey = addDaysCETKey(1);

  return (
    <aside className="w-56 h-screen bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <img src="/icon-192.png" alt="MyBrain" className="w-6 h-6 rounded-lg" />
          <h1 className="text-sm font-bold text-sidebar-accent-foreground">SEGUNDAMIND</h1>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-3">
        {/* Quick Views */}
        <div className="space-y-1">
          <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">📍 Quick Views</h2>
          <button
            onClick={() => onSelectQuickView?.('today')}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all group"
          >
            <Calendar className="w-4 h-4 text-primary" />
            <span>Hoy</span>
          </button>
          <button
            onClick={() => onSelectQuickView?.('tomorrow')}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all group"
          >
            <Calendar className="w-4 h-4 text-orange-500" />
            <span>Mañana</span>
          </button>
          <button
            onClick={() => onSelectQuickView?.('unassigned')}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all group"
          >
            <BookMarked className="w-4 h-4 text-muted-foreground" />
            <span>Sin asignar</span>
          </button>
        </div>

        {/* Areas */}
        <div className="space-y-1">
          <div className="flex items-center justify-between px-2 py-1">
            <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">📚 Áreas</h2>
            <button
              onClick={onAddArea}
              className="p-0.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Nueva área"
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {activeAreas.map((area) => {
            const areaProjects = projects.filter((p) => p.areaId === area.id);
            const activeProjects = areaProjects.filter((p) => p.status !== "blocked" && p.status !== "finished");
            const isExpanded = expandedAreas.has(area.id);
            const isSelected = selectedAreaId === area.id && !selectedProjectId;
            const isBlocked = area.status === "blocked";

            return (
              <div key={area.id}>
                <button
                  onClick={() => {
                    onSelectArea(area.id);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-all group ${
                    isSelected
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                  } ${isBlocked ? "opacity-50" : ""}`}
                >
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleArea(area.id);
                    }}
                    className="p-0.5 -ml-0.5 cursor-pointer"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </div>
                  <ImportanceDot importance={area.importance} />
                  {isBlocked && <Lock className="w-3 h-3 text-status-blocked" />}
                  <span className="truncate flex-1 text-left">{area.name}</span>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddProject(area.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-sidebar-accent transition-all cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </div>
                </button>

                <AnimatePresence>
                  {isExpanded && activeProjects.length > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="ml-4 pl-2 border-l border-sidebar-border space-y-0.5 py-0.5">
                        {activeProjects.map((project) => {
                          const isProjectSelected = selectedProjectId === project.id;
                          const isPBlocked = project.status === "blocked";

                          return (
                            <button
                              key={project.id}
                              onClick={() => onSelectProject(project.id)}
                              className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-all group ${
                                isProjectSelected
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                              } ${isPBlocked ? "opacity-50" : ""}`}
                            >
                              <ImportanceDot importance={project.importance} />
                              {isPBlocked && <Lock className="w-3 h-3 text-status-blocked" />}
                              <span className="text-[9px] font-mono font-bold text-muted-foreground shrink-0">
                                {project.key}
                              </span>
                              <span className="truncate flex-1 text-left">{project.name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2 space-y-2">
        <div className="flex items-center justify-center gap-1">
          <PushNotificationToggle />
          <ChangePasswordDialog>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors p-1.5"
              title="Cambiar contraseña"
            >
              <KeyRound className="w-3 h-3" />
            </button>
          </ChangePasswordDialog>
          <McpAccessDialog>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors p-1.5"
              title="Acceso MCP para Claude"
            >
              <Plug className="w-3 h-3" />
            </button>
          </McpAccessDialog>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors p-1.5 ml-auto"
            title="Ajustes"
          >
            <Settings className="w-3 h-3" />
          </button>
          <SignOutButton />
        </div>
      </div>
    </aside>
  );

}