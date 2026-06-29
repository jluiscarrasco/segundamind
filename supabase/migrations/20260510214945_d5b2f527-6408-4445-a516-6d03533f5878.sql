UPDATE public.tasks SET importance='important' WHERE importance='high';
UPDATE public.projects SET importance='important' WHERE importance='high';
UPDATE public.areas SET importance='important' WHERE importance='high';
UPDATE public.tasks SET importance='normal' WHERE importance NOT IN ('none','low','normal','important','critical');
UPDATE public.projects SET importance='normal' WHERE importance NOT IN ('none','low','normal','important','critical');
UPDATE public.areas SET importance='normal' WHERE importance NOT IN ('none','low','normal','important','critical');