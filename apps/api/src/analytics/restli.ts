import { utcMidnightMs } from './analytics-range';

/**
 * Rest.li 2.0 query encoding. Values that are URNs are percent-encoded, while
 * the structural `(`, `)`, `:` and `,` of records and `List(...)` stay as they
 * are. `URLSearchParams` would encode those too and LinkedIn would reject the
 * call, so query strings are built by hand.
 */

export function encodeUrn(urn: string): string {
  return encodeURIComponent(urn);
}

/** `(year:2024,month:5,day:4)` for `2024-05-04`. */
export function restliDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `(year:${year},month:${month},day:${day})`;
}

/** `(start:(...),end:(...))`; the end date is exclusive on LinkedIn's side. */
export function restliDateRange(start: string, endExclusive: string): string {
  return `(start:${restliDate(start)},end:${restliDate(endExclusive)})`;
}

/** Daily `timeIntervals` between two UTC midnights, end exclusive. */
export function restliDailyTimeIntervals(
  start: string,
  endExclusive: string,
): string {
  return `(timeRange:(start:${utcMidnightMs(start)},end:${utcMidnightMs(
    endExclusive,
  )}),timeGranularityType:DAY)`;
}

export function restliUrnList(urns: string[]): string {
  return `List(${urns.map(encodeUrn).join(',')})`;
}

/**
 * The `entity` of `memberCreatorPostAnalytics?q=entity`: `(share:...)` for a
 * share URN, `(ugc:...)` for a ugcPost URN.
 */
export function restliPostEntity(postUrn: string): string {
  const key = isUgcPostUrn(postUrn) ? 'ugc' : 'share';
  return `(${key}:${encodeUrn(postUrn)})`;
}

export function isUgcPostUrn(urn: string): boolean {
  return urn.startsWith('urn:li:ugcPost:');
}

export function isShareUrn(urn: string): boolean {
  return urn.startsWith('urn:li:share:');
}

/**
 * Joins already-encoded `key=value` pairs. Values must be encoded by the
 * caller with the helpers above; this only adds `&` and `=`.
 */
export function buildQuery(
  params: Array<[string, string | number | undefined]>,
): string {
  return params
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}
