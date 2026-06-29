/**
 * CET/CEST timezone-aware date utilities.
 * All date keys (YYYY-MM-DD) are generated in Europe/Madrid (CET) timezone
 * to avoid UTC shift issues.
 */

const CET_TIMEZONE = 'Europe/Madrid';

/** Get today's date key (YYYY-MM-DD) in CET */
export function getTodayKeyCET(): string {
  return dateToCETKey(new Date());
}

/** Convert a JS Date to a YYYY-MM-DD string in CET timezone */
export function dateToCETKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find(p => p.type === 'year')!.value;
  const month = parts.find(p => p.type === 'month')!.value;
  const day = parts.find(p => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

/** Get a date key N days from now in CET */
export function addDaysCETKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateToCETKey(d);
}

/** Parse a YYYY-MM-DD string into a local Date (avoiding UTC interpretation) */
export function parseDateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}
