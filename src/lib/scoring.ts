import type { Task, Project, Area, Importance, Status } from '@/types';

const IMPORTANCE_SCORE: Record<Importance, number> = {
  critical: 100,
  important: 70,
  normal: 40,
  low: 10,
  none: 0,
};

const importanceScore = (i: Importance | string | null | undefined): number => {
  if (!i) return 0;
  if (i === 'high') return IMPORTANCE_SCORE.important;
  if (i === 'medium') return IMPORTANCE_SCORE.normal;
  return IMPORTANCE_SCORE[i as Importance] ?? 0;
};

const STATUS_MULTIPLIER: Record<Status, number> = {
  funnel: 0.5,
  ready: 1,
  blocked: 0.1,
  waiting: 0.1,
  active: 1,
  finished: 0,
};

function getDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getUrgencyBonus(reviewDate: string | null): number {
  if (!reviewDate) return 0;
  const today = getDateStr(new Date());
  const tomorrow = getDateStr(new Date(Date.now() + 86400000));
  if (reviewDate < today) return 50;
  if (reviewDate === today) return 35;
  if (reviewDate === tomorrow) return 25;
  return 0;
}

function getCascadeBonus(task: Task, projects: Project[], areas: Area[]): number {
  const project = projects.find(p => p.id === task.projectId);
  if (!project) return 0;
  if (project.importance === 'critical') return 20;
  const area = areas.find(a => a.id === project.areaId);
  if (area?.importance === 'critical') return 20;
  return 0;
}

export interface ScoreBreakdown {
  total: number;
  base: number;
  urgency: number;
  cascade: number;
  multiplier: number;
  baseLabel: string;
  urgencyLabel: string;
  cascadeLabel: string;
  multiplierLabel: string;
}

export function scoreTaskDetailed(task: Task, projects: Project[], areas: Area[]): ScoreBreakdown {
  if (task.status === 'finished') return { total: 0, base: 0, urgency: 0, cascade: 0, multiplier: 0, baseLabel: 'Cerrada', urgencyLabel: '', cascadeLabel: '', multiplierLabel: '' };
  const base = importanceScore(task.importance);
  const urgency = getUrgencyBonus(task.reviewDate);
  const cascade = getCascadeBonus(task, projects, areas);
  const multiplier = STATUS_MULTIPLIER[task.status];
  const total = Math.round((base + urgency + cascade) * multiplier);

  const urgencyLabels: Record<number, string> = { 50: 'Vencida', 35: 'Hoy', 25: 'Mañana' };
  const statusLabels: Record<string, string> = { funnel: '×0.5 embudo', ready: '×1', active: '×1', blocked: '×0.1 bloqueada', waiting: '×0.1 esperando' };

  return {
    total, base, urgency, cascade, multiplier,
    baseLabel: `Importancia: ${task.importance} (${base})`,
    urgencyLabel: urgency > 0 ? `Urgencia: ${urgencyLabels[urgency] || ''} (+${urgency})` : '',
    cascadeLabel: cascade > 0 ? `Proyecto/Área crítico (+${cascade})` : '',
    multiplierLabel: multiplier !== 1 ? statusLabels[task.status] || '' : '',
  };
}

export function scoreTask(task: Task, projects: Project[], areas: Area[]): number {
  return scoreTaskDetailed(task, projects, areas).total;
}

export function scoreProject(project: Project, areas: Area[]): number {
  if (project.status === 'finished') return 0;
  const base = importanceScore(project.importance);
  const urgency = getUrgencyBonus(project.reviewDate);
  const area = areas.find(a => a.id === project.areaId);
  const cascade = area?.importance === 'critical' ? 20 : 0;
  const multiplier = STATUS_MULTIPLIER[project.status];
  return Math.round((base + urgency + cascade) * multiplier);
}

export function scoreArea(area: Area): number {
  if (area.status === 'finished') return 0;
  const base = importanceScore(area.importance);
  const urgency = getUrgencyBonus(area.reviewDate);
  const multiplier = STATUS_MULTIPLIER[area.status];
  return Math.round((base + urgency) * multiplier);
}

/** Check if task is a grooming candidate (score < 20 or waiting > 30 days) */
export function isGroomingCandidate(task: Task, score: number): boolean {
  if (score < 20) return true;
  if (task.status === 'blocked') {
    const created = new Date(task.createdAt).getTime();
    const daysSinceCreated = (Date.now() - created) / 86400000;
    if (daysSinceCreated > 30) return true;
  }
  return false;
}

/* ── Area Health Score ───────────────────────────────────── */

export type HealthLevel = 'healthy' | 'warning' | 'critical';

export interface HealthSegments {
  active: number;
  waiting: number;
  blocked: number;
  noReview: number;
  overdue: number;
  finished: number;
}

export interface AreaHealth {
  score: number;
  level: HealthLevel;
  segments: HealthSegments;
  total: number;
}

export function computeAreaHealth(
  area: Area,
  areaProjects: Project[],
  areaTasks: Task[],
): AreaHealth {
  const today = getDateStr(new Date());
  const nonFinished = areaTasks.filter(t => t.status !== 'finished');

  const active = areaTasks.filter(t => t.status === 'active' || t.status === 'ready').length;
  const waiting = areaTasks.filter(t => t.status === 'funnel').length;
  const blocked = areaTasks.filter(t => t.status === 'blocked').length;
  const finished = areaTasks.filter(t => t.status === 'finished').length;
  const noReview = nonFinished.filter(t => !t.reviewDate).length;
  const overdue = nonFinished.filter(t => t.reviewDate && t.reviewDate < today).length;

  // Score: start at 100, penalize issues
  let score = 100;
  score -= blocked * 15;
  score -= overdue * 10;
  score -= noReview * 5;
  // Penalize if area review is overdue
  if (area.reviewDate && area.reviewDate < today) score -= 15;
  score = Math.max(0, Math.min(100, score));

  const level: HealthLevel = score > 70 ? 'healthy' : score > 40 ? 'warning' : 'critical';

  return {
    score,
    level,
    segments: { active, waiting, blocked, noReview, overdue, finished },
    total: areaTasks.length,
  };
}

/** Compute a global health score from multiple area healths */
export function computeGlobalHealth(healths: AreaHealth[]): { score: number; level: HealthLevel } {
  if (healths.length === 0) return { score: 100, level: 'healthy' };
  const avg = Math.round(healths.reduce((s, h) => s + h.score, 0) / healths.length);
  const level: HealthLevel = avg > 70 ? 'healthy' : avg > 40 ? 'warning' : 'critical';
  return { score: avg, level };
}
