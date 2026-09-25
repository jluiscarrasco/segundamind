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

/** Get a date key N months from now in CET */
export function addMonthsCETKey(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return dateToCETKey(d);
}

/** Parse a YYYY-MM-DD string into a local Date (avoiding UTC interpretation) */
export function parseDateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Returns Madrid's UTC offset (+01:00 or +02:00) for a given date. Handles
 * the EU DST rule: forward on the last Sunday of March, back on the last
 * Sunday of October, both at 01:00 UTC.
 */
function madridOffsetOn(year: number, month1to12: number, day: number): '+01:00' | '+02:00' {
  const lastSundayOfMonth = (m0: number) => {
    const last = new Date(Date.UTC(year, m0 + 1, 0));
    return last.getUTCDate() - last.getUTCDay();
  };
  if (month1to12 < 3 || month1to12 > 10) return '+01:00';
  if (month1to12 > 3 && month1to12 < 10) return '+02:00';
  if (month1to12 === 3) return day >= lastSundayOfMonth(2) ? '+02:00' : '+01:00';
  return day < lastSundayOfMonth(9) ? '+02:00' : '+01:00';
}

/**
 * Compute the UTC Date at which a task's notification should fire, given its
 * reviewDate (YYYY-MM-DD in Madrid) and optional startTime (HH:mm in Madrid).
 * Missing startTime defaults to 09:30, matching the iCal fallback.
 */
export function taskNotifyDate(reviewDate: string, startTime: string | null | undefined): Date {
  const time = (startTime && /^\d{2}:\d{2}$/.test(startTime)) ? startTime : '09:30';
  const [y, m, d] = reviewDate.split('-').map(Number);
  return new Date(`${reviewDate}T${time}:00${madridOffsetOn(y, m, d)}`);
}
