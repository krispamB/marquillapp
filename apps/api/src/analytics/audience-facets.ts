import { round1 } from './analytics-metrics';
import type {
  AudienceFacet,
  AudienceFacetItem,
  AudienceFacetKey,
} from './interfaces';
import type {
  FollowerCounts,
  OrganizationFollowerStatisticsElement,
} from './linkedin-analytics.types';

export const MAX_FACET_ITEMS = 8;

/** LinkedIn's static seniority taxonomy (`urn:li:seniority:{id}`). */
export const SENIORITY_LABELS: Record<string, string> = {
  '1': 'Unpaid',
  '2': 'Training',
  '3': 'Entry-level',
  '4': 'Senior',
  '5': 'Manager',
  '6': 'Director',
  '7': 'VP',
  '8': 'CXO',
  '9': 'Partner',
  '10': 'Owner',
};

export function seniorityLabel(urn: string): string {
  const id = urn.split(':').pop() ?? urn;
  return SENIORITY_LABELS[id] ?? `Seniority ${id}`;
}

const numberFormat = new Intl.NumberFormat('en-US');

/**
 * `SIZE_2_TO_10` → "2–10 employees", `SIZE_1` → "1 employee",
 * `SIZE_10001_OR_MORE` → "10,001+ employees". Anything else is made readable.
 */
export function staffCountRangeLabel(range: string): string {
  const between = /^SIZE_(\d+)_TO_(\d+)$/.exec(range);
  if (between) {
    return `${numberFormat.format(Number(between[1]))}–${numberFormat.format(
      Number(between[2]),
    )} employees`;
  }
  const orMore = /^SIZE_(\d+)_OR_MORE$/.exec(range);
  if (orMore) {
    return `${numberFormat.format(Number(orMore[1]))}+ employees`;
  }
  const single = /^SIZE_(\d+)$/.exec(range);
  if (single) {
    const size = Number(single[1]);
    return `${numberFormat.format(size)} ${size === 1 ? 'employee' : 'employees'}`;
  }
  const words = range
    .replace(/^SIZE_/, '')
    .replace(/_/g, ' ')
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown';
}

/**
 * Demographic counts use `organicFollowerCount` only: for demographics it
 * already includes paid followers, so adding `paidFollowerCount` would count
 * them twice.
 */
function organicCount(counts: FollowerCounts | undefined): number {
  const value = counts?.organicFollowerCount;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

/**
 * Items sorted by count, highest first, at most 8; zeros dropped. `share` is
 * the percentage of the facet's total (all items, not just the top 8).
 * Returns null when no item has a count.
 */
export function buildFacet(
  key: AudienceFacetKey,
  label: string,
  entries: Array<{ label: string; count: number }>,
): AudienceFacet | null {
  const merged = new Map<string, number>();
  for (const entry of entries) {
    if (entry.count <= 0) continue;
    merged.set(entry.label, (merged.get(entry.label) ?? 0) + entry.count);
  }
  const total = [...merged.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return null;
  const items: AudienceFacetItem[] = [...merged.entries()]
    .map(([itemLabel, count]) => ({
      label: itemLabel,
      count,
      share: round1((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_FACET_ITEMS);
  return { key, label, items };
}

export function buildAudienceFacets(
  element: OrganizationFollowerStatisticsElement | undefined,
): AudienceFacet[] {
  const seniority = buildFacet(
    'seniority',
    'Seniority',
    (element?.followerCountsBySeniority ?? [])
      .filter((entry) => entry.seniority)
      .map((entry) => ({
        label: seniorityLabel(entry.seniority!),
        count: organicCount(entry.followerCounts),
      })),
  );
  const companySize = buildFacet(
    'companySize',
    'Company size',
    (element?.followerCountsByStaffCountRange ?? [])
      .filter((entry) => entry.staffCountRange)
      .map((entry) => ({
        label: staffCountRangeLabel(entry.staffCountRange!),
        count: organicCount(entry.followerCounts),
      })),
  );
  return [seniority, companySize].filter(
    (facet): facet is AudienceFacet => facet !== null,
  );
}
