-- Migrate status values: planning → funnel, waiting → blocked (merge), active stays, finished stays
-- Add new 'ready' status (no existing rows to migrate)

UPDATE public.areas SET status = 'funnel' WHERE status = 'planning';
UPDATE public.areas SET status = 'blocked' WHERE status = 'waiting';

UPDATE public.projects SET status = 'funnel' WHERE status = 'planning';
UPDATE public.projects SET status = 'blocked' WHERE status = 'waiting';

UPDATE public.tasks SET status = 'funnel' WHERE status = 'planning';
UPDATE public.tasks SET status = 'blocked' WHERE status = 'waiting';