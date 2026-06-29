import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FolderOpen,
  Layers3,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  KeyRound,
  ExternalLink,
  Archive,
  Bell,
  BellOff } from
"lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import type { Area, Project, Status } from "@/types";
import { ImportanceDot, StatusIcon } from "./StatusBadges";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { McpAccessDialog } from "./McpAccessDialog";
import { Plug } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface AppSidebarProps {
  areas: Area[];
  projects: Project[];
  selectedAreaId: string | null;
  selectedProjectId: string | null;
  onSelectArea: (id: string) => void;
  onSelectProject: (id: string) => void;
  onAddArea: () => void;
  onAddProject: (areaId: string) => void;
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
  onAddProject
}: AppSidebarProps) {
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set(areas.map((a) => a.id)));
  const [showHidden, setShowHidden] = useState(false);

  const toggleArea = (id: string) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredAreas = showHidden ? areas : areas.filter((a) => a.status !== "blocked" && a.status !== "finished");
  const hiddenCount = areas.length - areas.filter((a) => a.status !== "blocked" && a.status !== "finished").length;

  return (
    <aside className="w-56 h-screen bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <img src="/icon-192.png" alt="MyBrain" className="w-7 h-7 rounded-lg" />

          <div className="flex-1 min-w-0">
            <h1 className="text-xs font-semibold text-sidebar-accent-foreground truncate">MyBrain</h1>
            <p className="text-[9px] text-muted-foreground truncate">Productive Brain</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <div className="flex items-center justify-between px-2 py-1.5 mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Áreas</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowHidden(!showHidden)}
              className={`p-0.5 rounded hover:bg-sidebar-accent transition-colors ${showHidden ? "text-foreground" : "text-muted-foreground"}`}
              title={showHidden ? "Ocultar archivados" : `Mostrar archivados (${hiddenCount})`}>
              
              {showHidden ? <Eye className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
            </button>
            <button
              onClick={onAddArea}
              className="p-0.5 rounded hover:bg-sidebar-accent text-muted-foreground transition-colors">
              
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>

        {filteredAreas.map((area) => {
          const areaProjects = projects.filter((p) => p.areaId === area.id);
          const filteredProjects = showHidden ?
          areaProjects :
          areaProjects.filter((p) => p.status !== "blocked" && p.status !== "finished");
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
                isSelected ?
                "bg-sidebar-accent text-sidebar-accent-foreground" :
                "text-sidebar-foreground hover:bg-sidebar-accent/50"} ${
                isBlocked ? "opacity-50" : ""}`}>

                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleArea(area.id);
                  }}
                  className="p-0.5 -ml-0.5 cursor-pointer">

                  {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </div>
                <ImportanceDot importance={area.importance} />
                {isBlocked && <Lock className="w-3 h-3 text-status-blocked" />}
                <span className="truncate flex-1 text-left">{area.name}</span>
                <StatusIcon status={area.status} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddProject(area.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-sidebar-accent transition-all cursor-pointer">

                  <Plus className="w-3 h-3" />
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && filteredProjects.length > 0 &&
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden">
                  
                    <div className="ml-4 pl-2 border-l border-sidebar-border space-y-0.5 py-0.5">
                      {filteredProjects.map((project) => {
                      const isProjectSelected = selectedProjectId === project.id;
                      const isPBlocked = project.status === "blocked";

                      return (
                        <button
                          key={project.id}
                          onClick={() => onSelectProject(project.id)}
                          className={`w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-all group ${
                          isProjectSelected ?
                          "bg-sidebar-accent text-sidebar-accent-foreground" :
                          "text-sidebar-foreground hover:bg-sidebar-accent/50"} ${
                          isPBlocked ? "opacity-50" : ""}`}>
                          
                            <ImportanceDot importance={project.importance} />
                            {isPBlocked && <Lock className="w-3 h-3 text-status-blocked" />}
                            <span className="text-[9px] font-mono font-bold text-muted-foreground shrink-0">
                              {project.key}
                            </span>
                            <span className="truncate flex-1 text-left">{project.name}</span>
                          </button>);

                    })}
                    </div>
                  </motion.div>
                }
              </AnimatePresence>
            </div>);

        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-sidebar-border space-y-2">
        <p className="text-[10px] text-muted-foreground text-center">
          {areas.length} áreas · {projects.length} proyectos
        </p>
        <div className="flex items-center justify-center gap-2">
          <PushNotificationToggle />
          <ChangePasswordDialog>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              title="Cambiar contraseña">
              
              <KeyRound className="w-3 h-3" />
            </button>
          </ChangePasswordDialog>
          <McpAccessDialog>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              title="Acceso MCP para Claude">
              <Plug className="w-3 h-3" />
            </button>
          </McpAccessDialog>
          <SignOutButton />
        </div>
      </div>
    </aside>);

}