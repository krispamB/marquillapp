import * as chrono from "chrono-node";

// Natural-language date parsing and ghost-completion logic for the schedule
// popover. Pure functions over (text, now) so the behavior is testable
// without rendering the component.

export interface ParsedSchedule {
    date: Date;
    /** True when the input only specified a day, so the time is our 9 AM default. */
    timeWasDefaulted: boolean;
}

const DEFAULT_HOUR = 9;

export function parseNaturalDate(text: string, now: Date = new Date()): ParsedSchedule | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    const results = chrono.parse(trimmed, now, { forwardDate: true });
    if (results.length === 0) return null;

    // Require the parse to cover the meat of the input — otherwise chrono
    // happily extracts "may" out of "maybe later" and we preview nonsense.
    const result = results[0];
    const matchedRatio = result.text.length / trimmed.length;
    if (matchedRatio < 0.5) return null;

    const timeWasDefaulted = !result.start.isCertain("hour");
    const date = result.start.date();
    if (timeWasDefaulted) {
        date.setHours(DEFAULT_HOUR, 0, 0, 0);
        // Defaulting to 9 AM can land in the past (e.g. "today" at 3 PM);
        // forwardDate already handled chrono's side, this handles ours.
        if (date.getTime() <= now.getTime()) {
            if (result.start.isCertain("day")) {
                // The user named this very day, so keep it and pick the next hour.
                date.setTime(now.getTime() + 60 * 60 * 1000);
            } else {
                date.setDate(date.getDate() + 1);
            }
        }
    }
    return { date, timeWasDefaulted };
}

// ─── Ghost completions ─────────────────────────────────────────────────────────

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
];

/** Full phrases offered when they extend everything typed so far. */
const PHRASES = [
    "today at ",
    "tonight at 8pm",
    "tomorrow at 9am",
    "tomorrow morning",
    "tomorrow afternoon",
    "tomorrow evening",
    "in 30 minutes",
    "in an hour",
    "in 2 hours",
    "next week",
    "next monday at 9am",
    ...WEEKDAYS.map((d) => `${d} at 9am`),
];

/** Single words completed at the end of a longer input ("7am on fri…"). */
const WORDS = [
    ...WEEKDAYS,
    ...MONTHS,
    "today", "tomorrow", "tonight", "noon", "midnight",
    "morning", "afternoon", "evening",
    "minutes", "hours", "week", "month",
];

/** Presets cycled as the ghost hint while the input is empty. */
export const EMPTY_INPUT_PRESETS = [
    "tomorrow at 9am",
    "in 2 hours",
    "monday morning",
    "friday at noon",
];

/**
 * Returns the suffix to render as ghost text after `text`, or null.
 * The completed string is guaranteed to parse to a valid date.
 */
export function getGhostCompletion(text: string, now: Date = new Date()): string | null {
    if (!text.trim()) return null;
    const lower = text.toLowerCase();

    for (const phrase of PHRASES) {
        if (phrase.startsWith(lower) && phrase.length > lower.length) {
            const suffix = phrase.slice(lower.length);
            if (parseNaturalDate(text + suffix, now)) return suffix;
        }
    }

    // Complete the word being typed: "7am on fri" → "+day".
    const lastWordMatch = lower.match(/([a-z]+)$/);
    if (lastWordMatch) {
        const lastWord = lastWordMatch[1];
        for (const word of WORDS) {
            if (word.startsWith(lastWord) && word.length > lastWord.length) {
                const suffix = word.slice(lastWord.length);
                if (parseNaturalDate(text + suffix, now)) return suffix;
            }
        }
    }
    return null;
}

// ─── Formatting ────────────────────────────────────────────────────────────────

/** Canonical text written back into the input after a manual calendar pick. */
export function formatCanonicalText(date: Date): string {
    const datePart = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const timePart = date
        .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        .toLowerCase()
        .replace(" ", "");
    return `${datePart} at ${timePart}`;
}

/** Human-readable preview shown under the input. */
export function formatPreviewText(date: Date, now: Date = new Date()): string {
    const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const sameDay = (a: Date, b: Date) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayLabel: string;
    if (sameDay(date, now)) {
        dayLabel = "Today";
    } else if (sameDay(date, tomorrow)) {
        dayLabel = "Tomorrow";
    } else {
        dayLabel = date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
            year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
        });
    }
    return `${dayLabel} · ${time}`;
}
