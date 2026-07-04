export type Importance = 'critical' | 'important' | 'normal' | 'low' | 'none';
export type Status = 'funnel' | 'ready' | 'blocked' | 'waiting' | 'active' | 'finished';
export type EntityType = 'area' | 'project' | 'task';

export type Effort = 5 | 10 | 15 | 25 | 45 | 60 | 120 | 180 | 300 | 480 | null;

export const EFFORT_OPTIONS: { value: Effort; label: string }[] = [
  { value: null, label: 'Sin estimar' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 15, label: '15 min' },
  { value: 25, label: '25 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
  { value: 180, label: '3 h' },
  { value: 300, label: '5 h' },
  { value: 480, label: '8 h' },
];

export function getEffortLabel(minutes: number | null | undefined): string {
  if (minutes == null) return '';
  const opt = EFFORT_OPTIONS.find(o => o.value === minutes);
  return opt?.label || `${minutes} min`;
}

export interface Area {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: Status;
  importance: Importance;
  reviewDate: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  userId: string;
  areaId: string;
  key: string; // 3-letter key, e.g. "SEC"
  name: string;
  description: string;
  status: Status;
  importance: Importance;
  reviewDate: string | null;
  createdAt: string;
  taskCounter: number; // auto-increment counter for task IDs
}

export interface Subtask {
  id: string;
  name: string;
  completed: boolean;
}

export interface Task {
  id: string;
  userId: string;
  projectId: string;
  taskNumber: number; // sequential number within project
  name: string;
  description: string;
  status: Status;
  importance: Importance;
  effort: Effort;
  reviewDate: string | null;
  subtasks?: Subtask[];
  createdAt: string;
}

export interface InboxItem {
  id: string;
  userId: string;
  type: 'note' | 'link' | 'image';
  content: string;
  createdAt: string;
}

export interface WikiPage {
  id: string;
  userId: string;
  entityType: EntityType;
  entityId: string;
  parentId: string | null;
  title: string;
  content: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface Resource {
  id: string;
  userId: string;
  entityType: EntityType;
  entityId: string;
  type: 'note' | 'link' | 'image' | 'file';
  content: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  createdAt: string;
}

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  critical: 'Crítico',
  important: 'Importante',
  normal: 'Normal',
  low: 'Baja',
  none: 'Sin importancia',
};

export const STATUS_LABELS: Record<Status, string> = {
  funnel: 'Embudo',
  ready: 'Listo',
  blocked: 'Bloqueado',
  waiting: 'Esperando',
  active: 'En Progreso',
  finished: 'Cerrado',
};

/** Generate a display ID like "SEC-3" */
export function getTaskDisplayId(projects: Project[], task: Task): string {
  const project = projects.find(p => p.id === task.projectId);
  if (!project) return `?-${task.taskNumber}`;
  return `${project.key}-${task.taskNumber}`;
}

export interface UserFolder {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserFile {
  id: string;
  folderId: string | null;
  name: string;
  storagePath: string;
  mimeType: string | null;
  size: number;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface UserFileLink {
  id: string;
  fileId: string;
  entityType: EntityType;
  entityId: string;
  createdAt: string;
}

/** Generate a 3-letter key from a project name */
export function generateProjectKey(name: string, existingKeys: string[]): string {
  // Try first 3 chars uppercase
  const clean = name.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑ]/g, '').toUpperCase();
  let key = clean.slice(0, 3).padEnd(3, 'X');
  
  // If collision, try variations
  let attempt = 0;
  while (existingKeys.includes(key) && attempt < 26) {
    key = clean.slice(0, 2) + String.fromCharCode(65 + attempt);
    attempt++;
  }
  
  return key;
}
