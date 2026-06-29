import { motion } from 'framer-motion';
import { Inbox, Zap, HeartPulse, CheckCircle2, Clock, ShieldAlert } from 'lucide-react';
import type { Task, InboxItem, Project, Area } from '@/types';
import { ImportanceDot } from './StatusBadges';
import { computeAreaHealth, computeGlobalHealth, type HealthLevel } from '@/lib/scoring';
import { addDaysCETKey } from '@/lib/dateUtils';

interface DashboardStatsProps {
  tasks: Task[];
  inbox: InboxItem[];
  projects: Project[];
  areas: Area[];
  onOpenInbox: () => void;
}

const HEALTH_COLORS: Record<HealthLevel, { text: string; bg: string }> = {
  healthy: { text: 'text-status-active', bg: 'bg-status-active/10' },
  warning: { text: 'text-status-blocked', bg: 'bg-status-blocked/10' },
  critical: { text: 'text-destructive', bg: 'bg-destructive/10' },
};

const HEALTH_LABELS: Record<HealthLevel, string> = {
  healthy: 'Saludable',
  warning: 'Atención',
  critical: 'Crítico',
};

export function DashboardStats({ tasks, inbox, projects, areas, onOpenInbox }: DashboardStatsProps) {
  const inProgressTasks = tasks.filter(t => t.status === 'active');
  const readyTasks = tasks.filter(t => t.status === 'ready');
  const blockedTasks = tasks.filter(t => t.status === 'blocked');

  const weekAgoKey = addDaysCETKey(-7);
  const completedThisWeek = tasks.filter(t => t.status === 'finished' && t.createdAt >= weekAgoKey).length;

  // Compute global health
  const areaHealths = areas.map(area => {
    const areaProjects = projects.filter(p => p.areaId === area.id);
    const areaTasks = tasks.filter(t => areaProjects.some(p => p.id === t.projectId));
    return computeAreaHealth(area, areaProjects, areaTasks);
  });
  const globalHealth = computeGlobalHealth(areaHealths);
  const healthColors = HEALTH_COLORS[globalHealth.level];

  const stats = [
    {
      icon: Inbox,
      label: 'Inbox',
      value: inbox.length,
      sub: inbox.length > 0 ? 'pendientes' : 'vacío',
      accent: inbox.length > 0 ? 'text-primary' : 'text-muted-foreground',
      bgAccent: inbox.length > 0 ? 'bg-primary/10' : 'bg-secondary',
      onClick: onOpenInbox,
    },
    {
      icon: Zap,
      label: 'En progreso',
      value: inProgressTasks.length,
      sub: (() => {
        const crit = inProgressTasks.filter(t => t.importance === 'critical').length;
        const imp = inProgressTasks.filter(t => t.importance === 'important').length;
        if (crit === 0 && imp === 0) return 'tareas';
        return (
          <span className="flex items-center gap-2">
            {crit > 0 && <span className="flex items-center gap-0.5"><ImportanceDot importance="critical" /> {crit}</span>}
            {imp > 0 && <span className="flex items-center gap-0.5"><ImportanceDot importance="important" /> {imp}</span>}
          </span>
        );
      })(),
      accent: 'text-status-active',
      bgAccent: 'bg-status-active/10',
    },
    {
      icon: Clock,
      label: 'Listas',
      value: readyTasks.length,
      sub: 'para empezar',
      accent: readyTasks.length > 0 ? 'text-primary' : 'text-muted-foreground',
      bgAccent: readyTasks.length > 0 ? 'bg-primary/10' : 'bg-secondary',
    },
    {
      icon: ShieldAlert,
      label: 'Bloqueadas',
      value: blockedTasks.length,
      sub: 'en espera',
      accent: blockedTasks.length > 0 ? 'text-status-blocked' : 'text-muted-foreground',
      bgAccent: blockedTasks.length > 0 ? 'bg-status-blocked/10' : 'bg-secondary',
    },
    {
      icon: HeartPulse,
      label: 'Salud global',
      value: globalHealth.score,
      sub: HEALTH_LABELS[globalHealth.level],
      accent: healthColors.text,
      bgAccent: healthColors.bg,
    },
    {
      icon: CheckCircle2,
      label: 'Completadas',
      value: completedThisWeek,
      sub: 'esta semana',
      accent: 'text-status-finished',
      bgAccent: 'bg-secondary',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          onClick={stat.onClick}
          className={`bg-card rounded-xl border border-border shadow-card p-4 flex items-start gap-3 ${stat.onClick ? 'cursor-pointer hover:border-primary/30 transition-colors' : ''}`}
        >
          <div className={`p-2 rounded-lg ${stat.bgAccent}`}>
            <stat.icon className={`w-4 h-4 ${stat.accent}`} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
            <p className={`text-xl font-bold ${stat.accent}`}>{stat.value}</p>
            <div className="text-[11px] text-muted-foreground mt-0.5">{stat.sub}</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
