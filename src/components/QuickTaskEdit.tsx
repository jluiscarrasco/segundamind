import { ChevronDown } from 'lucide-react';
import type { Task, Project, Area, Status, Importance, Effort } from '@/types';
import { STATUS_LABELS, IMPORTANCE_LABELS, EFFORT_OPTIONS } from '@/types';
import { ImportanceDot } from './StatusBadges';
import { getTodayKeyCET, addDaysCETKey } from '@/lib/dateUtils';

interface QuickTaskEditProps {
  task: Task;
  projects: Project[];
  areas: Area[];
  onUpdate: (field: keyof Task, value: any) => void;
  layout?: 'row' | 'hover'; // 'row' shows controls in row, 'hover' shows on hover
}

export function QuickTaskEdit({ task, projects, areas, onUpdate, layout = 'hover' }: QuickTaskEditProps) {
  const todayKey = getTodayKeyCET();

  const statusOptions = Object.entries(STATUS_LABELS) as [Status, string][];
  const importanceOptions = Object.entries(IMPORTANCE_LABELS) as [Importance, string][];

  return (
    <div className="flex items-center gap-2">
      {/* Status Dropdown */}
      <div className={`relative ${layout === 'hover' ? 'opacity-0 group-hover:opacity-100' : ''} transition-opacity`}>
        <select
          value={task.status}
          onChange={e => onUpdate('status', e.target.value as Status)}
          className="text-[11px] px-2 py-1 rounded bg-secondary text-foreground outline-none focus:ring-1 focus:ring-primary appearance-none pr-6 cursor-pointer hover:bg-secondary/80"
          title="Cambiar estado"
        >
          {statusOptions.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-1.5 top-1.5 w-3 h-3 text-muted-foreground pointer-events-none" />
      </div>

      {/* Importance Selector - 5 dots */}
      <div className={`flex gap-1 ${layout === 'hover' ? 'opacity-0 group-hover:opacity-100' : ''} transition-opacity`}>
        {importanceOptions.map(([key]) => (
          <button
            key={key}
            type="button"
            onClick={() => onUpdate('importance', key)}
            title={IMPORTANCE_LABELS[key]}
            className={`w-2 h-2 rounded-full transition-opacity ${
              task.importance === key
                ? 'opacity-100 ring-1 ring-offset-1 ring-primary'
                : 'opacity-40 hover:opacity-60'
            }`}
            style={{ backgroundColor: `var(--importance-${key})` }}
          />
        ))}
      </div>

      {/* Review Date - with quick actions */}
      <div className={`flex items-center gap-1 ${layout === 'hover' ? 'opacity-0 group-hover:opacity-100' : ''} transition-opacity`}>
        <input
          type="date"
          value={task.reviewDate || ''}
          onChange={e => onUpdate('reviewDate', e.target.value || null)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-foreground outline-none focus:ring-1 focus:ring-primary"
          title="Cambiar fecha de revisión"
        />
        {/* Quick actions: +1d, +7d */}
        <button
          type="button"
          onClick={() => onUpdate('reviewDate', addDaysCETKey(1))}
          className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground hover:text-primary hover:bg-secondary/80 transition-colors"
          title="Posponerse 1 día"
        >
          +1d
        </button>
        <button
          type="button"
          onClick={() => onUpdate('reviewDate', addDaysCETKey(7))}
          className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground hover:text-primary hover:bg-secondary/80 transition-colors"
          title="Posponerse 7 días"
        >
          +7d
        </button>
      </div>

      {/* Effort Selector - only for tasks */}
      {task.effort !== undefined && (
        <div className={`flex gap-1 ${layout === 'hover' ? 'opacity-0 group-hover:opacity-100' : ''} transition-opacity`}>
          {EFFORT_OPTIONS.map(opt => (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() => onUpdate('effort', opt.value)}
              className={`text-[9px] px-1.5 py-0.5 rounded font-medium transition-all ${
                task.effort === opt.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
