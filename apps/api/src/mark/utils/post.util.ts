// LinkedIn counts emojis by their Unicode code unit length,
// not grapheme clusters. We replicate that here.
function linkedInCharCount(text: string): number {
  let count = 0;
  for (const char of text) {
    // Each code point that falls outside BMP (surrogate pairs) = 2 units
    const cp = char.codePointAt(0) ?? 0;
    count += cp > 0xffff ? 2 : 1;
  }
  return count;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LINKEDIN_POST_RULES = {
  MAX_CHARS: 3000,
  PREVIEW_DESKTOP: 210,
  PREVIEW_MOBILE: 140,
  MAX_MENTIONS: 40,
  MAX_HASHTAGS: 30, // soft best-practice limit; no hard cap
  HASHTAG_REGEX: /(?<!\w)#([a-zA-Z0-9\u{1F300}-\u{1FAFF}]+)/gu,
  MENTION_REGEX: /@[\w\s]+/g, // simplified; real mentions are resolved by LinkedIn UI
  URL_REGEX: /https?:\/\/[^\s]+/g,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LinkedInValidationResult {
  valid: boolean;
  charCount: number;
  errors: string[];
  warnings: string[];
  preview: {
    desktop: string;
    mobile: string;
    hookComplete: boolean; // does the hook end naturally before cutoff?
  };
  stats: {
    hashtagCount: number;
    mentionCount: number;
    urlCount: number;
    lineBreakCount: number;
    emojiCharCost: number; // extra chars consumed by emojis
  };
}

// ─── Validator ────────────────────────────────────────────────────────────────

export function validateLinkedInPost(text: string): LinkedInValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const charCount = linkedInCharCount(text);

  // Hard limit
  if (charCount > LINKEDIN_POST_RULES.MAX_CHARS) {
    errors.push(
      `Post exceeds 3,000 characters (currently ${charCount}). LinkedIn will block publishing.`,
    );
  }

  // Mention count
  const mentions = text.match(LINKEDIN_POST_RULES.MENTION_REGEX) ?? [];
  if (mentions.length > LINKEDIN_POST_RULES.MAX_MENTIONS) {
    errors.push(
      `Too many mentions (${mentions.length}). LinkedIn allows up to 40 per post.`,
    );
  }

  // Hashtag validation
  const hashtags = [...text.matchAll(LINKEDIN_POST_RULES.HASHTAG_REGEX)];
  if (hashtags.length > LINKEDIN_POST_RULES.MAX_HASHTAGS) {
    warnings.push(
      `${hashtags.length} hashtags detected. Using more than 5–10 looks spammy and wastes character budget.`,
    );
  }

  // Invalid hashtags (spaces or symbols inside)
  const invalidHashtags = hashtags.filter((m) => /[\s\-'",!]/.test(m[1]));
  if (invalidHashtags.length > 0) {
    errors.push(
      `Invalid hashtag(s): ${invalidHashtags.map((m) => '#' + m[1]).join(', ')}. Hashtags cannot contain spaces or symbols.`,
    );
  }

  // Hook warnings
  const desktopPreview = getPreview(text, LINKEDIN_POST_RULES.PREVIEW_DESKTOP);
  const mobilePreview = getPreview(text, LINKEDIN_POST_RULES.PREVIEW_MOBILE);
  const hookComplete = !endsAbruptly(desktopPreview);

  if (!hookComplete) {
    warnings.push(
      `Your hook is cut off mid-sentence at the desktop "see more" boundary (~210 chars). Consider restructuring your opening.`,
    );
  }

  if (charCount < 400) {
    warnings.push(
      `Post is very short (${charCount} chars). Posts under 400 characters typically underperform on LinkedIn.`,
    );
  }

  // Emoji cost analysis
  const emojiCharCost = calcEmojiOverhead(text);
  if (emojiCharCost > 100) {
    warnings.push(
      `Emojis are consuming ${emojiCharCost} extra characters due to Unicode encoding. Consider reducing emoji use if near the limit.`,
    );
  }

  // URL count
  const urls = text.match(LINKEDIN_POST_RULES.URL_REGEX) ?? [];
  const lineBreakCount = (text.match(/\n/g) ?? []).length;

  return {
    valid: errors.length === 0,
    charCount,
    errors,
    warnings,
    preview: {
      desktop: desktopPreview,
      mobile: mobilePreview,
      hookComplete,
    },
    stats: {
      hashtagCount: hashtags.length,
      mentionCount: mentions.length,
      urlCount: urls.length,
      lineBreakCount,
      emojiCharCost,
    },
  };
}

function getPreview(text: string, charLimit: number): string {
  let count = 0;
  let result = '';
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    const cost = cp > 0xffff ? 2 : 1;
    if (count + cost > charLimit) break;
    result += char;
    count += cost;
  }
  return result;
}

function endsAbruptly(preview: string): boolean {
  // Heuristic: if preview doesn't end with sentence-ending punctuation or newline
  return !/[.!?\n]$/.test(preview.trimEnd());
}

function calcEmojiOverhead(text: string): number {
  let overhead = 0;
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp > 0xffff) overhead += 1; // costs 2, baseline is 1, so +1 overhead
  }
  return overhead;
}
