export enum StylePreset {
  PROFESSIONAL = 'professional',
  STORYTELLING = 'storytelling',
  EDUCATIONAL = 'educational',
  BOLD = 'bold',
  CONTRARIAN = 'contrarian',
  FOUNDER = 'founder',
}

export const STYLE_PRESET_INSTRUCTIONS: Record<StylePreset, string> = {
  [StylePreset.PROFESSIONAL]:
    'Write in a polished, credible, concise style with calm authority and practical clarity.',
  [StylePreset.STORYTELLING]:
    'Use a personal narrative arc with a clear turning point, concrete details, and a practical lesson.',
  [StylePreset.EDUCATIONAL]:
    'Teach with structure, plain language, and practical takeaways that the reader can apply immediately.',
  [StylePreset.BOLD]:
    'Use confident, direct framing with decisive language while staying grounded and professional.',
  [StylePreset.CONTRARIAN]:
    'Challenge a common assumption respectfully and back it with nuanced reasoning.',
  [StylePreset.FOUNDER]:
    'Write like an experienced operator sharing practical lessons, tradeoffs, and execution insights.',
};

export function resolveStylePresetInstruction(stylePreset?: StylePreset) {
  if (!stylePreset) return undefined;
  return STYLE_PRESET_INSTRUCTIONS[stylePreset];
}
