import type { Task } from '@/types';

/** Cross-area "lenses" shown in the sidebar. Inbox is handled separately (opens its panel). */
export type QuickView = 'today' | 'overdue' | 'waiting' | 'undated' | 'blocked';

export const QUICK_VIEW_LABELS: Record<QuickView, string> = {
  today: 'Hoy',
  overdue: 'Vencidas',
  waiting: 'Esperando',
  undated: 'Sin fecha',
  blocked: 'Bloqueado',
};

/** Filter tasks for a given lens. `todayKey` is the CET YYYY-MM-DD for today. */
export function filterByQuickView(view: QuickView, tasks: Task[], todayKey: string): Task[] {
  switch (view) {
    case 'today':
      return tasks.filter(t => t.status !== 'finished' && t.reviewDate === todayKey);
    case 'overdue':
      return tasks.filter(t => t.status !== 'finished' && !!t.reviewDate && t.reviewDate < todayKey);
    case 'waiting':
      return tasks.filter(t => t.status === 'waiting');
    case 'undated':
      return tasks.filter(t => t.status !== 'finished' && !t.reviewDate);
    case 'blocked':
      return tasks.filter(t => t.status === 'blocked');
  }
}
