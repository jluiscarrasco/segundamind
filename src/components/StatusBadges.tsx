import type { Importance, Status } from '@/types';
import { Circle, AlertTriangle, Flame, Minus, Ghost, Lock, Pause, CheckCircle2, Zap, Clock, Filter, CircleCheck } from 'lucide-react';

export function ImportanceDot({ importance, size = 'sm', showLabel = false }: { importance: Importance; size?: 'sm' | 'md'; showLabel?: boolean }) {
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3';
  const colorMap: Record<Importance, string> = {
    critical: 'bg-importance-critical',
    important: 'bg-importance-important',
    normal: 'bg-importance-normal',
    low: 'bg-importance-low',
    none: 'bg-importance-none',
  };
  const labels: Record<Importance, string> = {
    critical: 'Crítico', important: 'Importante', normal: 'Normal', low: 'Baja', none: 'Sin imp.',
  };

  if (showLabel) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={`inline-block rounded-full ${sizeClass} ${colorMap[importance]} ${importance === 'critical' ? 'animate-pulse-soft' : ''}`} />
        <span className="text-[9px] text-muted-foreground">{labels[importance]}</span>
      </span>
    );
  }

  return (
    <span className={`inline-block rounded-full ${sizeClass} ${colorMap[importance]} ${importance === 'critical' ? 'animate-pulse-soft' : ''}`} />
  );
}

export function ImportanceBadge({ importance }: { importance: Importance }) {
  const labels: Record<Importance, string> = {
    critical: 'Crítico', important: 'Importante', normal: 'Normal', low: 'Baja', none: 'Sin imp.',
  };
  const bgMap: Record<Importance, string> = {
    critical: 'bg-importance-critical/15 importance-critical',
    important: 'bg-importance-important/15 importance-important',
    normal: 'bg-importance-normal/15 importance-normal',
    low: 'bg-importance-low/15 importance-low',
    none: 'bg-importance-none/15 importance-none',
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bgMap[importance]}`}>
      <ImportanceDot importance={importance} />
      {labels[importance]}
    </span>
  );
}

export function StatusIcon({ status, className = '' }: { status: Status; className?: string }) {
  const iconClass = `w-3.5 h-3.5 ${className}`;
  switch (status) {
    case 'funnel': return <Filter className={`${iconClass} text-status-funnel`} />;
    case 'ready': return <CircleCheck className={`${iconClass} text-status-ready`} />;
    case 'blocked': return <Lock className={`${iconClass} text-status-blocked`} />;
    case 'active': return <Zap className={`${iconClass} text-status-active`} />;
    case 'finished': return <CheckCircle2 className={`${iconClass} text-status-finished`} />;
  }
}
