import { useMemo } from "react";
import { motion } from "framer-motion";
import { CalendarOff } from "lucide-react";
import type { Task, Project, Area, EntityType } from "@/types";
import { getTaskDisplayId, STATUS_LABELS } from "@/types";
import { ImportanceDot } from "./StatusBadges";
import { getTodayKeyCET, addDaysCETKey } from "@/lib/dateUtils";
import { scoreTaskDetailed } from "@/lib/scoring";

interface UndatedTasksProps {
  tasks: Task[];
  projects: Project[];
  areas: Area[];
  onEditEntity: (type: EntityType, id: string) => void;
  onSetTaskDate: (id: string, date: string) => void;
}

export function UndatedTasks({
  tasks,
  projects,
  areas,
  onEditEntity,
  onSetTaskDate,
}: UndatedTasksProps) {
  const todayKey = getTodayKeyCET();
  const tomorrowKey = addDaysCETKey(1);
  const weekKey = addDaysCETKey(7);

  const items = useMemo(() => {
    return tasks
      .filter((t) => !t.reviewDate && t.status !== "finished")
      .map((t) => {
        const project = projects.find((p) => p.id === t.projectId);
        const area = project
          ? areas.find((a) => a.id === project.areaId)
          : null;
        return {
          task: t,
          displayId: getTaskDisplayId(projects, t),
          parentInfo: [area?.name, project?.name].filter(Boolean).join(" › "),
          score: scoreTaskDetailed(t, projects, areas).total,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [tasks, projects, areas]);

  return (
    <div className="bg-card rounded-xl border border-border shadow-card overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <CalendarOff className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">
          Tareas sin fecha
        </h2>
        <span className="ml-auto text-[11px] font-medium text-muted-foreground bg-secondary rounded-full px-2 py-0.5">
          {items.length}
        </span>
      </div>

      <div className="divide-y divide-border overflow-y-auto max-h-96">
        {items.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            Todas las tareas tienen fecha 🎉
          </div>
        ) : (
          items.map((item, i) => {
            const rowBg =
              item.task.status === "blocked"
                ? "hover:bg-muted/20 opacity-60"
                : item.task.status === "funnel"
                  ? "hover:bg-secondary/20 opacity-75"
                  : "hover:bg-secondary/30";
            return (
              <motion.div
                key={item.task.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => onEditEntity("task", item.task.id)}
                className={`px-5 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors group ${rowBg}`}
              >
                <ImportanceDot importance={item.task.importance} size="sm" />
                <span className="font-mono text-[10px] font-semibold text-muted-foreground shrink-0">
                  {item.displayId}
                </span>
                <span className="text-xs font-medium text-foreground truncate flex-1">
                  {item.task.name}
                </span>
                {item.task.status !== "active" &&
                  item.task.status !== "ready" && (
                    <span
                      title={STATUS_LABELS[item.task.status]}
                      className="text-[10px] font-bold px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0 uppercase"
                    >
                      {item.task.status === "blocked"
                        ? "🔒"
                        : item.task.status === "funnel"
                          ? "⏳"
                          : "?"}
                    </span>
                  )}
                <span className="text-[11px] text-muted-foreground truncate max-w-[120px] hidden sm:block">
                  {item.parentInfo}
                </span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetTaskDate(item.task.id, todayKey);
                    }}
                    className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors"
                  >
                    Hoy
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetTaskDate(item.task.id, tomorrowKey);
                    }}
                    className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors"
                  >
                    Mañana
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetTaskDate(item.task.id, weekKey);
                    }}
                    className="text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 rounded px-1.5 py-0.5 transition-colors"
                  >
                    +7d
                  </button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
}
