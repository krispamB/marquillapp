const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * The line that tells the model what day it is. Without it the model takes
 * its training-era year as the present. `today` is the run's UTC date as
 * `YYYY-MM-DD`; the builder only reads it, so the prompt stays a pure
 * function of its input.
 */
export function todaySection(today: string): string {
  const weekday = WEEKDAYS[new Date(`${today}T00:00:00Z`).getUTCDay()];
  const year = today.slice(0, 4);
  return `TODAY: ${today} (${weekday}). Treat this date as the present: "this year" means ${year}. Prefer the most recent figures, and do not present an earlier year as current.`;
}
