"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { CalendarClock, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, Sparkles } from "lucide-react";
import {
    parseNaturalDate,
    getGhostCompletion,
    formatCanonicalText,
    formatPreviewText,
    EMPTY_INPUT_PRESETS,
} from "./naturalDate";

// ─── Utility functions ─────────────────────────────────────────────────────────

export function formatUtcOffsetLabel(offsetMinutes: number) {
    const totalMinutes = -offsetMinutes;
    const sign = totalMinutes >= 0 ? "+" : "-";
    const absoluteMinutes = Math.abs(totalMinutes);
    const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
    const minutes = String(absoluteMinutes % 60).padStart(2, "0");
    return `UTC${sign}${hours}:${minutes}`;
}

export function formatOffsetDateTime(localDate: Date) {
    const year = localDate.getFullYear();
    const month = String(localDate.getMonth() + 1).padStart(2, "0");
    const day = String(localDate.getDate()).padStart(2, "0");
    const hours = String(localDate.getHours()).padStart(2, "0");
    const minutes = String(localDate.getMinutes()).padStart(2, "0");
    const seconds = String(localDate.getSeconds()).padStart(2, "0");
    const offset = formatUtcOffsetLabel(localDate.getTimezoneOffset());
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offset.slice(3)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MIN_LEAD_MS = 5 * 60 * 1000;

// ─── Calendar grid ─────────────────────────────────────────────────────────────

function CalendarGrid({
    viewYear,
    viewMonth,
    scheduleDate,
    isScheduling,
    onPrevMonth,
    onNextMonth,
    onSelectDay,
}: {
    viewYear: number;
    viewMonth: number;
    scheduleDate: string;
    isScheduling: boolean;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    onSelectDay: (dateStr: string) => void;
}) {
    const today = useMemo(() => {
        const d = new Date();
        return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
    }, []);

    const cells = useMemo(() => {
        const firstDay = new Date(viewYear, viewMonth, 1).getDay();
        const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
        const result: Array<{ day: number | null }> = [];
        for (let i = 0; i < firstDay; i++) result.push({ day: null });
        for (let d = 1; d <= daysInMonth; d++) result.push({ day: d });
        while (result.length % 7 !== 0) result.push({ day: null });
        return result;
    }, [viewYear, viewMonth]);

    const selectedParts = useMemo(() => {
        if (!scheduleDate) return null;
        const [y, m, d] = scheduleDate.split("-").map(Number);
        return { y, m: m - 1, d };
    }, [scheduleDate]);

    return (
        <div>
            {/* Month navigation */}
            <div className="mb-3 flex items-center justify-between">
                <button
                    type="button"
                    onClick={onPrevMonth}
                    disabled={isScheduling}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Previous month"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <button
                    type="button"
                    onClick={onNextMonth}
                    disabled={isScheduling}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Next month"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>

            {/* Day-of-week headers */}
            <div className="mb-1 grid grid-cols-7 text-center">
                {DAY_LABELS.map((label) => (
                    <span key={label} className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                        {label}
                    </span>
                ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7 gap-y-0.5">
                {cells.map((cell, idx) => {
                    if (cell.day === null) {
                        return <div key={`empty-${idx}`} />;
                    }

                    const isToday = today.y === viewYear && today.m === viewMonth && today.d === cell.day;
                    const isSelected = selectedParts
                        ? selectedParts.y === viewYear && selectedParts.m === viewMonth && selectedParts.d === cell.day
                        : false;

                    // Past day: before today (not today itself)
                    const cellDate = new Date(viewYear, viewMonth, cell.day);
                    const todayMidnight = new Date(today.y, today.m, today.d);
                    const isPast = cellDate < todayMidnight;

                    return (
                        <button
                            key={cell.day}
                            type="button"
                            disabled={isPast || isScheduling}
                            onClick={() => {
                                const dateStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(cell.day!)}`;
                                onSelectDay(dateStr);
                            }}
                            className={[
                                "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition",
                                isPast
                                    ? "cursor-not-allowed opacity-30"
                                    : "cursor-pointer",
                                isSelected
                                    ? "bg-[#1C1B27] text-white"
                                    : isToday
                                        ? "ring-2 ring-[var(--color-primary)] text-[var(--color-primary)]"
                                        : !isPast
                                            ? "text-[var(--color-text-primary)] hover:bg-slate-100"
                                            : "text-[var(--color-text-secondary)]",
                            ].join(" ")}
                            aria-label={`${MONTH_NAMES[viewMonth]} ${cell.day}, ${viewYear}`}
                            aria-pressed={isSelected}
                        >
                            {cell.day}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Time stepper ──────────────────────────────────────────────────────────────

function TimeStepper({
    hours,
    minutes,
    isScheduling,
    onChangeHours,
    onChangeMinutes,
}: {
    hours: number;
    minutes: number;
    isScheduling: boolean;
    onChangeHours: (h: number) => void;
    onChangeMinutes: (m: number) => void;
}) {
    return (
        <div className="flex items-center justify-center gap-3">
            {/* Hours */}
            <div className="flex flex-col items-center gap-1">
                <button
                    type="button"
                    disabled={isScheduling}
                    onClick={() => onChangeHours((hours + 1) % 24)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Increase hours"
                >
                    <ChevronUp className="h-4 w-4" />
                </button>
                <span className="w-10 rounded-xl border border-[#cfd5e1] bg-white py-1.5 text-center text-base font-semibold tabular-nums text-[var(--color-text-primary)]">
                    {pad(hours)}
                </span>
                <button
                    type="button"
                    disabled={isScheduling}
                    onClick={() => onChangeHours((hours + 23) % 24)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Decrease hours"
                >
                    <ChevronDown className="h-4 w-4" />
                </button>
            </div>

            <span className="mb-0.5 text-xl font-semibold text-[var(--color-text-secondary)]">:</span>

            {/* Minutes */}
            <div className="flex flex-col items-center gap-1">
                <button
                    type="button"
                    disabled={isScheduling}
                    onClick={() => onChangeMinutes((minutes + 1) % 60)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Increase minutes"
                >
                    <ChevronUp className="h-4 w-4" />
                </button>
                <span className="w-10 rounded-xl border border-[#cfd5e1] bg-white py-1.5 text-center text-base font-semibold tabular-nums text-[var(--color-text-primary)]">
                    {pad(minutes)}
                </span>
                <button
                    type="button"
                    disabled={isScheduling}
                    onClick={() => onChangeMinutes((minutes + 59) % 60)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-secondary)] transition hover:bg-slate-100 disabled:opacity-40"
                    aria-label="Decrease minutes"
                >
                    <ChevronDown className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

// ─── Natural language input with ghost completion ──────────────────────────────

function NaturalInput({
    text,
    ghost,
    isScheduling,
    onTextChange,
    onAcceptGhost,
    onEnter,
    onFocusChange,
    inputRef,
}: {
    text: string;
    ghost: string | null;
    isScheduling: boolean;
    onTextChange: (value: string) => void;
    onAcceptGhost: () => void;
    onEnter: () => void;
    onFocusChange: (focused: boolean) => void;
    inputRef: React.RefObject<HTMLInputElement | null>;
}) {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (ghost && (e.key === "Tab" || (e.key === "ArrowRight" && e.currentTarget.selectionStart === text.length))) {
            e.preventDefault();
            onAcceptGhost();
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
        }
    };

    return (
        <div className="relative">
            <input
                ref={inputRef}
                type="text"
                value={text}
                disabled={isScheduling}
                onChange={(e) => onTextChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => onFocusChange(true)}
                onBlur={() => onFocusChange(false)}
                placeholder={ghost ? "" : "Try “tomorrow at 9am” or “in 2 hours”…"}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Schedule time in natural language"
                className="w-full rounded-xl border border-[#cfd5e1] bg-white px-3 py-2.5 text-sm font-medium text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]/60 focus:border-[var(--color-primary)] focus:outline-none disabled:opacity-50"
            />
            {/* Ghost completion overlay: mirrors the typed text invisibly so the
                gray suffix lands exactly where the caret is. */}
            {ghost ? (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre px-3 text-sm font-medium"
                >
                    <span className="invisible">{text}</span>
                    <span
                        className="pointer-events-auto cursor-pointer text-[var(--color-text-secondary)]/50"
                        onMouseDown={(e) => {
                            // preventDefault keeps focus in the input; stopPropagation
                            // keeps document-level outside-click handlers from seeing a
                            // node that React unmounts when the ghost is accepted.
                            e.preventDefault();
                            e.stopPropagation();
                            onAcceptGhost();
                        }}
                    >
                        {ghost}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function ReschedulePopover({
    isOpen,
    initialDate,
    initialTime,
    onClose,
    onConfirm,
    isScheduling = false,
    positionClasses = "top-full right-0 mt-2",
    zIndexClass = "z-[72]",
}: {
    isOpen: boolean;
    initialDate?: string;
    initialTime?: string;
    onClose: () => void;
    onConfirm: (scheduledTime: string, timezone: string) => void;
    isScheduling?: boolean;
    positionClasses?: string;
    zIndexClass?: string;
}) {
    // ── State ──
    const [text, setText] = useState("");
    const [resolved, setResolved] = useState<Date | null>(null);
    const [showManual, setShowManual] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [presetIndex, setPresetIndex] = useState(0);
    const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
    const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
    const [scheduleError, setScheduleError] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);

    const desktopPopoverRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const userTimezone = useMemo(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        [],
    );
    const timezoneLabel = useMemo(
        () => `${formatUtcOffsetLabel(new Date().getTimezoneOffset())} (${userTimezone})`,
        [userTimezone],
    );

    // ── Mobile detection ──
    useEffect(() => {
        const mq = window.matchMedia("(max-width: 767px)");
        setIsMobile(mq.matches);
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    // ── Reset state on open ──
    useEffect(() => {
        if (!isOpen) return;
        const now = new Date();
        setScheduleError(null);
        setShowManual(false);

        let initial: Date | null = null;
        if (initialDate) {
            const [y, mo, d] = initialDate.split("-").map(Number);
            const [h, mi] = (initialTime || "").split(":").map(Number);
            if (Number.isFinite(y) && Number.isFinite(mo) && Number.isFinite(d)) {
                initial = new Date(
                    y, mo - 1, d,
                    Number.isFinite(h) ? h : now.getHours(),
                    Number.isFinite(mi) ? mi : now.getMinutes(),
                    0, 0,
                );
            }
        }
        setResolved(initial);
        setText(initial ? formatCanonicalText(initial) : "");
        setViewYear((initial ?? now).getFullYear());
        setViewMonth((initial ?? now).getMonth());

        // Focus the input once the popover has rendered.
        requestAnimationFrame(() => inputRef.current?.focus());
    }, [isOpen, initialDate, initialTime]);

    // ── Cycle ghost presets while focused and empty ──
    useEffect(() => {
        if (!isOpen || !isInputFocused || text.trim()) return;
        const id = setInterval(
            () => setPresetIndex((i) => (i + 1) % EMPTY_INPUT_PRESETS.length),
            3000,
        );
        return () => clearInterval(id);
    }, [isOpen, isInputFocused, text]);

    // ── Desktop outside-click handler ──
    useEffect(() => {
        if (!isOpen || isMobile) return;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            // A click can unmount its own target (e.g. accepting the ghost
            // completion) before this listener runs; a detached node is never
            // "contained", so it would read as an outside click and close us.
            if (!target.isConnected) return;
            if (desktopPopoverRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest("[data-action-menu-boundary]")) return;
            if (target instanceof Element && target.closest("[data-schedule-trigger='true']")) return;
            onClose();
            setScheduleError(null);
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
                setScheduleError(null);
            }
        };

        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("keydown", handleEscape);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("keydown", handleEscape);
        };
    }, [isOpen, isMobile, onClose]);

    // ── Text editing ──
    const handleTextChange = useCallback((value: string) => {
        setText(value);
        setScheduleError(null);
        const parsed = parseNaturalDate(value);
        setResolved(parsed ? parsed.date : null);
    }, []);

    const ghost = useMemo(() => {
        if (!isOpen || isScheduling) return null;
        if (!text.trim()) {
            return isInputFocused ? EMPTY_INPUT_PRESETS[presetIndex] : null;
        }
        return getGhostCompletion(text);
    }, [isOpen, isScheduling, text, isInputFocused, presetIndex]);

    const handleAcceptGhost = useCallback(() => {
        if (!ghost) return;
        handleTextChange(text + ghost);
        inputRef.current?.focus();
    }, [ghost, text, handleTextChange]);

    // ── Manual picker (two-way sync: picks write canonical text back) ──
    const applyManualDate = useCallback((next: Date) => {
        setResolved(next);
        setText(formatCanonicalText(next));
        setScheduleError(null);
    }, []);

    const manualBase = useCallback(() => {
        if (resolved) return new Date(resolved);
        const d = new Date();
        d.setHours(9, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return d;
    }, [resolved]);

    const handleSelectDay = useCallback((dateStr: string) => {
        const [y, mo, d] = dateStr.split("-").map(Number);
        const next = manualBase();
        next.setFullYear(y, mo - 1, d);
        applyManualDate(next);
    }, [manualBase, applyManualDate]);

    const handleChangeHours = useCallback((h: number) => {
        const next = manualBase();
        next.setHours(h);
        applyManualDate(next);
    }, [manualBase, applyManualDate]);

    const handleChangeMinutes = useCallback((m: number) => {
        const next = manualBase();
        next.setMinutes(m);
        applyManualDate(next);
    }, [manualBase, applyManualDate]);

    const handleToggleManual = useCallback(() => {
        setShowManual((prev) => {
            const opening = !prev;
            if (opening) {
                const base = resolved ?? new Date();
                setViewYear(base.getFullYear());
                setViewMonth(base.getMonth());
            }
            return opening;
        });
    }, [resolved]);

    const handlePrevMonth = useCallback(() => {
        setViewMonth((m) => {
            if (m === 0) { setViewYear((y) => y - 1); return 11; }
            return m - 1;
        });
    }, []);

    const handleNextMonth = useCallback(() => {
        setViewMonth((m) => {
            if (m === 11) { setViewYear((y) => y + 1); return 0; }
            return m + 1;
        });
    }, []);

    // ── Validation + confirm ──
    const isTooSoon = resolved !== null && resolved.getTime() < Date.now() + MIN_LEAD_MS;
    const isConfirmable = resolved !== null && !isTooSoon;

    const handleConfirm = useCallback(() => {
        if (!resolved) {
            setScheduleError(
                text.trim()
                    ? "Couldn’t understand that — try “tomorrow at 9am” or pick a date below."
                    : "Type a time like “friday at 7am”, or pick a date.",
            );
            if (text.trim()) setShowManual(true);
            return;
        }
        if (resolved.getTime() < Date.now() + MIN_LEAD_MS) {
            setScheduleError("Choose a time at least 5 minutes in the future.");
            return;
        }
        setScheduleError(null);
        onConfirm(formatOffsetDateTime(resolved), userTimezone);
    }, [resolved, text, onConfirm, userTimezone]);

    const handleClose = useCallback(() => {
        setScheduleError(null);
        onClose();
    }, [onClose]);

    if (!isOpen) return null;

    const scheduleDateStr = resolved
        ? `${resolved.getFullYear()}-${pad(resolved.getMonth() + 1)}-${pad(resolved.getDate())}`
        : "";

    const content = (
        <>
            {/* Header */}
            <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#eef3ff] text-[#3451d1]">
                    <CalendarClock className="h-4 w-4" />
                </span>
                <p className="flex-1 text-sm font-semibold text-[var(--color-text-primary)]">Schedule Post</p>
                <button
                    type="button"
                    onClick={handleToggleManual}
                    disabled={isScheduling}
                    className={[
                        "flex h-8 w-8 items-center justify-center rounded-full transition disabled:opacity-40",
                        showManual
                            ? "bg-[#eef3ff] text-[#3451d1]"
                            : "text-[var(--color-text-secondary)] hover:bg-slate-100",
                    ].join(" ")}
                    aria-label={showManual ? "Hide calendar" : "Pick from calendar"}
                    aria-pressed={showManual}
                >
                    <CalendarDays className="h-4 w-4" />
                </button>
            </div>

            {/* Natural language input */}
            <NaturalInput
                text={text}
                ghost={ghost}
                isScheduling={isScheduling}
                onTextChange={handleTextChange}
                onAcceptGhost={handleAcceptGhost}
                onEnter={handleConfirm}
                onFocusChange={setIsInputFocused}
                inputRef={inputRef}
            />

            {/* Live preview */}
            <div className="mt-2 min-h-[1.25rem] text-xs font-medium">
                {resolved ? (
                    <p className={isTooSoon ? "text-rose-600" : "text-[#3451d1]"}>
                        <Sparkles className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                        {formatPreviewText(resolved)}
                        {isTooSoon ? " — at least 5 minutes ahead, please" : ""}
                    </p>
                ) : text.trim() ? (
                    <p className="text-amber-600">
                        Couldn’t read that yet —{" "}
                        <button
                            type="button"
                            onClick={handleToggleManual}
                            className="cursor-pointer font-semibold underline underline-offset-2"
                        >
                            pick manually
                        </button>
                    </p>
                ) : (
                    <p className="text-[var(--color-text-secondary)]/70">
                        Press Tab to accept a suggestion
                    </p>
                )}
            </div>

            {/* Manual fallback: calendar + time stepper */}
            {showManual ? (
                <>
                    <div className="my-4 border-t border-[var(--color-border)]" />
                    <CalendarGrid
                        viewYear={viewYear}
                        viewMonth={viewMonth}
                        scheduleDate={scheduleDateStr}
                        isScheduling={isScheduling}
                        onPrevMonth={handlePrevMonth}
                        onNextMonth={handleNextMonth}
                        onSelectDay={handleSelectDay}
                    />
                    <div className="my-4 border-t border-[var(--color-border)]" />
                    <p className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                        Time
                    </p>
                    <TimeStepper
                        hours={resolved ? resolved.getHours() : 9}
                        minutes={resolved ? resolved.getMinutes() : 0}
                        isScheduling={isScheduling}
                        onChangeHours={handleChangeHours}
                        onChangeMinutes={handleChangeMinutes}
                    />
                </>
            ) : null}

            {/* Timezone */}
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#e2e7f2] bg-[#f7f9ff] px-3 py-2 text-xs font-medium text-[#445065]">
                <Clock3 className="h-4 w-4 shrink-0 text-[#5575F5]" />
                <span className="truncate">{timezoneLabel}</span>
            </div>

            {/* Error */}
            {scheduleError ? (
                <p className="mt-2 text-xs font-medium text-rose-600">{scheduleError}</p>
            ) : null}

            {/* Actions */}
            <div className="mt-4 flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={handleClose}
                    disabled={isScheduling}
                    className="inline-flex items-center rounded-full border border-[#d4dae6] bg-white px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={isScheduling || !isConfirmable}
                    className="inline-flex items-center rounded-full bg-[#1C1B27] px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                    {isScheduling ? "Scheduling…" : "Confirm Schedule"}
                </button>
            </div>
        </>
    );

    // ── Mobile: bottom sheet ──
    if (isMobile) {
        return (
            <>
                <div
                    className="fixed inset-0 z-[100] bg-black/40"
                    onClick={handleClose}
                />
                <div
                    className="fixed bottom-0 left-0 right-0 z-[101] max-h-[90dvh] overflow-y-auto rounded-t-3xl bg-white px-5 pb-10 pt-4 shadow-[0_-8px_30px_-4px_rgba(15,23,42,0.15)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-slate-200" />
                    {content}
                </div>
            </>
        );
    }

    // ── Desktop: absolute popover ──
    return (
        <div
            id="schedule-popover"
            ref={desktopPopoverRef}
            role="dialog"
            aria-label="Schedule post"
            className={`absolute ${positionClasses} ${zIndexClass} w-[min(92vw,380px)] rounded-2xl border border-[#d6dae3] bg-white p-5 shadow-[0_20px_44px_-28px_rgba(15,23,42,0.45)]`}
            onClick={(e) => e.stopPropagation()}
        >
            {content}
        </div>
    );
}
