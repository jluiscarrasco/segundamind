import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  FolderOpen,
  Lock,
  Eye,
  EyeOff,
  LogOut,
  KeyRound,
  Settings,
  Bell,
  BellOff,
  Brain,
  Zap,
  AlertTriangle,
  Clock,
  CalendarOff,
  Inbox,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import type { Area, Project, Task } from "@/types";
import { ImportanceDot, StatusIcon } from "./StatusBadges";
import { computeAreaHealth } from "@/lib/scoring";
import { getTodayKeyCET } from "@/lib/dateUtils";
import { filterByQuickView, QUICK_VIEW_LABELS, type QuickView } from "@/lib/quickViews";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { McpAccessDialog } from "./McpAccessDialog";
import { Plug } from "lucide-react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface AppSidebarProps {
  areas: Area[];
  projects: Project[];
  tasks: Task[];
  inboxCount: number;
  selectedAreaId: string | null;
  selectedProjectId: string | null;
  activeQuickView: QuickView | null;
  onSelectArea: (id: string) => void;
  onSelectProject: (id: string) => void;
  onSelectQuickView: (view: QuickView) => void;
  onOpenInbox: () => void;
  onAddArea: () => void;
  onAddProject: (areaId: string) => void;
}

const QUICK_VIEW_META: { key: QuickView; Icon: typeof Zap; accent: string }[] = [
  { key: 'today', Icon: Zap, accent: 'text-primary' },
  { key: 'overdue', Icon: AlertTriangle, accent: 'text-destructive' },
  { key: 'waiting', Icon: Clock, accent: 'text-status-waiting' },
  { key: 'undated', Icon: CalendarOff, accent: 'text-muted-foreground' },
];

function SignOutButton() {
  const { user, signOut } = useAuth();
  return (
    <button
      onClick={signOut}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors p-1.5"
      title={user?.email || ""}>
      <LogOut className="w-4 h-4" />
    </button>);

}

function PushNotificationToggle() {
  const { isSupported, isEnabled, isLoading, toggle } = usePushNotifications();
  if (!isSupported) return null;
  return (
    <button
      onClick={toggle}
      disabled={isLoading}
      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors disabled:opacity-50 p-1.5"
      title={isEnabled ? "Desactivar notificaciones" : "Activar notificaciones"}>
      {isEnabled ? <Bell className="w-4 h-4 text-blue-600" /> : <BellOff className="w-4 h-4" />}
    </button>);

}

export function AppSidebar({
  areas,
  projects,
  tasks,
  inboxCount,
  selectedAreaId,
  selectedProjectId,
  activeQuickView,
  onSelectArea,
  onSelectProject,
  onSelectQuickView,
  onOpenInbox,
  onAddArea,
  onAddProject,
}: AppSidebarProps) {
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set(areas.map((a) => a.id)));
  const [showSettings, setShowSettings] = useState(false);
  const todayKey = getTodayKeyCET();

  const toggleArea = (id: string) => {
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const activeAreas = areas.filter((a) => a.status !== "blocked" && a.status !== "finished");

  return (
    <aside className="w-56 h-screen bg-white border-r border-gray-200 flex flex-col overflow-hidden shrink-0">
      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Quick views */}
        <div className="space-y-1.5">
          <h2 className="text-xs font-semibold uppercase text-gray-500 px-2 py-1">Vistas rápidas</h2>
          {QUICK_VIEW_META.map(({ key, Icon, accent }) => {
            const count = filterByQuickView(key, tasks, todayKey).length;
            const active = activeQuickView === key;
            return (
              <button
                key={key}
                onClick={() => onSelectQuickView(key)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${
                  active
                    ? "bg-blue-600 text-white font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left">{QUICK_VIEW_LABELS[key]}</span>
                {count > 0 && (
                  <span className="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full tabular-nums">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
          <button
            onClick={onOpenInbox}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-all"
          >
            <Inbox className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left">Bandeja</span>
            {inboxCount > 0 && (
              <span className="text-xs font-semibold text-white bg-blue-600 px-2 py-0.5 rounded-full tabular-nums">
                {inboxCount}
              </span>
            )}
          </button>
        </div>

        {/* Areas */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-2 py-1">
            <h2 className="text-xs font-semibold uppercase text-gray-500">Áreas</h2>
            <button
              onClick={onAddArea}
              className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-900 transition-colors"
              title="Nueva área"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {activeAreas.map((area) => {
            const areaProjects = projects.filter((p) => p.areaId === area.id);
            const activeProjects = areaProjects.filter((p) => p.status !== "blocked" && p.status !== "finished");
            const isExpanded = expandedAreas.has(area.id);
            const isSelected = selectedAreaId === area.id && !selectedProjectId;
            const isBlocked = area.status === "blocked";
            const areaProjectIds = new Set(areaProjects.map((p) => p.id));
            const areaTasks = tasks.filter((t) => areaProjectIds.has(t.projectId));
            const health = computeAreaHealth(area, areaProjects, areaTasks);
            const openCount = areaTasks.filter((t) => t.status !== "finished").length;
            const healthColor =
              health.level === "healthy" ? "bg-status-active" : health.level === "warning" ? "bg-status-blocked" : "bg-destructive";

            return (
              <div key={area.id}>
                <button
                  onClick={() => {
                    onSelectArea(area.id);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all group ${
                    isSelected
                      ? "bg-blue-600 text-white font-medium"
                      : "text-gray-600 hover:bg-gray-100"
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
                  {openCount > 0 && (
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{openCount}</span>
                  )}
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${healthColor}`}
                    title={`Salud del área: ${health.score}/100`}
                  />
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
      <div className="border-t border-gray-200 p-3 space-y-2">
        <div className="flex items-center justify-center gap-2">
          <PushNotificationToggle />
          <ChangePasswordDialog>
            <button
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors p-1.5"
              title="Cambiar contraseña"
            >
              <KeyRound className="w-4 h-4" />
            </button>
          </ChangePasswordDialog>
          <McpAccessDialog>
            <button
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors p-1.5"
              title="Acceso MCP para Claude"
            >
              <Plug className="w-4 h-4" />
            </button>
          </McpAccessDialog>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 transition-colors p-1.5 ml-auto"
            title="Ajustes"
          >
            <Settings className="w-4 h-4" />
          </button>
          <SignOutButton />
        </div>
      </div>
    </aside>
  );

}