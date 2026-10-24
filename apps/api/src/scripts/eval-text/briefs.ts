import { ArtifactType } from 'src/database/schemas';
import { StylePreset } from '../../agent/style-presets.config';

export type TextEvalType = ArtifactType.POST | ArtifactType.POLL;

/** A fixed brief every model is given, so models compare like for like. */
export interface TextEvalBrief {
  /** Stable id, `post-1`, `poll-3`, ...; the report's row key. */
  id: string;
  type: TextEvalType;
  prompt: string;
  stylePreset?: StylePreset;
}

const POST_PROMPTS: Array<[string, StylePreset | undefined]> = [
  [
    'Why staff engineers should write down their decisions, with one example of a decision record that saved a team a week of rework.',
    StylePreset.PROFESSIONAL,
  ],
  [
    'The week I shipped a feature nobody asked for, and what the empty analytics dashboard taught me about talking to users first.',
    StylePreset.STORYTELLING,
  ],
  [
    'A short guide to running a 25-minute weekly team retro that people do not dread: agenda, one rule, one metric.',
    StylePreset.EDUCATIONAL,
  ],
  [
    'Announce that our open-source CLI just reached version 2.0, faster cold starts and a plugin API, and thank the contributors.',
    undefined,
  ],
  [
    'Hot take: most dashboards are decoration. Argue that a team should delete half of theirs and keep only the ones tied to a decision.',
    undefined,
  ],
];

const POLL_PROMPTS: Array<[string, StylePreset | undefined]> = [
  ['Ask engineers whether they prefer tabs or spaces.', undefined],
  [
    'Ask my network how many days a week their team should be in the office.',
    StylePreset.PROFESSIONAL,
  ],
  [
    'Ask product managers which part of discovery they find hardest: recruiting users, synthesising notes, or prioritising.',
    StylePreset.EDUCATIONAL,
  ],
  [
    'Poll founders on how they handle their first hire: friend, referral, recruiter, or job board.',
    undefined,
  ],
  [
    'Ask which AI coding tool people reach for first in their day-to-day work.',
    undefined,
  ],
];

const build = (
  type: TextEvalType,
  prefix: string,
  prompts: Array<[string, StylePreset | undefined]>,
): TextEvalBrief[] =>
  prompts.map(([prompt, stylePreset], i) => ({
    id: `${prefix}-${i + 1}`,
    type,
    prompt,
    ...(stylePreset ? { stylePreset } : {}),
  }));

export const TEXT_EVAL_BRIEFS: TextEvalBrief[] = [
  ...build(ArtifactType.POST, 'post', POST_PROMPTS),
  ...build(ArtifactType.POLL, 'poll', POLL_PROMPTS),
];
