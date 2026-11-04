import type { Shipment } from './types';

/**
 * What shipped, newest first. Append-only: add an entry when a change goes
 * live, and don't rewrite old ones except to fix a fact.
 *
 * An entry can be drafted before its feature is live. The landing page shows
 * only entries whose feature is `live`, so a draft appears on its own once the
 * feature flips. When it does, set `date` to the day it went live.
 */
export const changelog: Shipment[] = [
  { date: '2026-11-04', feature: 'account-preferences', title: 'Preferences that follow you', body: 'Pick a theme and timezone in Settings once, and every device you sign in on uses them.' },
  { date: '2026-10-15', feature: 'design-system-picker', title: 'Swatch menu with hover preview', body: 'Hover over a Design System to preview it before you pick.' },
  { date: '2026-10-15', feature: 'design-systems', title: 'Design Systems for documents', body: 'Six designed systems for one-pagers and carousels, chosen per document.' },
  { date: '2026-10-14', feature: 'document-refine-from-source', title: 'Refine a document from its source', body: 'Mark edits the document he already made, so the parts you liked stay put.' },
  { date: '2026-08-06', feature: 'polls', title: 'Polls', body: 'Ask Mark for a poll and publish it as a native LinkedIn poll.' },
  { date: '2026-08-06', feature: 'documents', title: 'Documents', body: 'One-pagers and carousels, rendered to PDF and published as a LinkedIn document.' },
  { date: '2026-07-18', feature: 'run-progress', title: 'Live progress', body: 'Watch each step as Mark researches, writes, and renders.' },
  { date: '2026-06-11', feature: 'scheduling', title: 'Schedule in plain words', body: 'Type “next Tuesday 9am” and Mark schedules the post.' },
  { date: '2026-04-19', feature: 'post-media', title: 'Images and video', body: 'Attach several images or one video to a post.' },
  { date: '2026-04-14', feature: 'company-pages', title: 'Company pages', body: 'Connect a LinkedIn company page and publish to it on a schedule.' },
];
