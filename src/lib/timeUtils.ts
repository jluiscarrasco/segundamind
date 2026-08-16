/** Calculate end time given start time and duration in minutes */
export function calculateEndTime(startTime: string, durationMinutes: number | null | undefined): string | null {
  if (!startTime || durationMinutes == null) return null;

  const [hours, minutes] = startTime.split(':').map(Number);
  const startDate = new Date();
  startDate.setHours(hours, minutes, 0, 0);

  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

  const endHours = String(endDate.getHours()).padStart(2, '0');
  const endMinutes = String(endDate.getMinutes()).padStart(2, '0');

  return `${endHours}:${endMinutes}`;
}

/** Format time string HH:mm for display */
export function formatTime(time: string | null): string {
  if (!time) return '';
  return time; // Already in HH:mm format
}

/** Parse time string HH:mm to minutes since midnight */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Convert minutes since midnight to HH:mm format */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
