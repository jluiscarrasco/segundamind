import { motion } from 'framer-motion';
import { Zap, Clock, AlertCircle } from 'lucide-react';
import type { Task, Project, Area } from '@/types';
import { ImportanceDot } from './StatusBadges';

interface TaskCardProps {
  task: Task;
  project?: Project;
  area?: Area;
  onClick?: () => void;
  onStatusToggle?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isSelected?: boolean;
  variant?: 'compact' | 'full';
  showProject?: boolean;
  delay?: number;
}

export function TaskCard({
  task,
  project,
  area,
  onClick,
  onStatusToggle,
  onEdit,
  onDelete,
  isSelected = false,
  variant = 'compact',
  showProject = true,
  delay = 0,
}: TaskCardProps) {
  const isOverdue = task.reviewDate && task.reviewDate < new Date().toISOString().split('T')[0];
  const isCompleted = task.status === 'finished';
  const isBlocked = task.status === 'blocked';

  const getStatusColor = () => {
    if (isCompleted) return 'bg-green-500/10 border-green-500/20';
    if (isBlocked) return 'bg-red-500/10 border-red-500/20';
    if (isOverdue) return 'bg-destructive/5 border-destructive/20';
    return 'bg-card border-border';
  };

  const getStatusTextColor = () => {
    if (isCompleted) return 'text-green-600';
    if (isBlocked) return 'text-red-600';
    if (isOverdue) return 'text-destructive';
    return 'text-foreground';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      onClick={onClick}
      className={`rounded-lg border transition-all cursor-pointer group ${getStatusColor()} ${
        isSelected ? 'ring-2 ring-primary ring-offset-2' : 'hover:border-primary/30'
      }`}
    >
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          {/* Checkbox/Status */}
          <button
            onClick={e => {
              e.stopPropagation();
              onStatusToggle?.();
            }}
            className="mt-0.5 flex-shrink-0 w-5 h-5 rounded border border-border flex items-center justify-center transition-colors hover:bg-primary/20"
          >
            {isCompleted && <div className="w-3 h-3 bg-green-500 rounded-full" />}
            {isBlocked && <div className="w-3 h-3 bg-red-500 rounded-full" />}
          </button>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <h3
              className={`text-sm font-semibold truncate ${
                isCompleted ? 'line-through text-muted-foreground' : getStatusTextColor()
              }`}
            >
              {task.name}
            </h3>
            {project && showProject && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {area?.name} › {project.name}
              </p>
            )}
          </div>

          {/* Importance */}
          <ImportanceDot importance={task.importance} size="sm" />
        </div>

        {/* Meta info - compact view */}
        {variant === 'compact' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isOverdue && (
              <div className="flex items-center gap-1 text-destructive">
                <AlertCircle className="w-3 h-3" />
                Overdue
              </div>
            )}
            {task.reviewDate && !isOverdue && (
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {task.reviewDate}
              </div>
            )}
            {task.effort && (
              <div className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {task.effort}h
              </div>
            )}
          </div>
        )}

        {/* Description - full view */}
        {variant === 'full' && task.description && (
          <p className="text-sm text-foreground/80 line-clamp-2">{task.description}</p>
        )}

        {/* Full meta info - full view */}
        {variant === 'full' && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-muted-foreground">Status</p>
                <p className="font-medium text-foreground capitalize">{task.status}</p>
              </div>
              {task.reviewDate && (
                <div>
                  <p className="text-muted-foreground">Review</p>
                  <p className="font-medium text-foreground">{task.reviewDate}</p>
                </div>
              )}
              {task.effort && (
                <div>
                  <p className="text-muted-foreground">Effort</p>
                  <p className="font-medium text-foreground">{task.effort}h</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions - hover state */}
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-2 pt-2 border-t border-border/50 opacity-0 group-hover:opacity-100 transition-opacity">
            {onEdit && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="flex-1 px-2 py-1 rounded text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
              >
                Edit
              </button>
            )}
            {onDelete && (
              <button
                onClick={e => {
                  e.stopPropagation();
                  onDelete();
                }}
                className="flex-1 px-2 py-1 rounded text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
