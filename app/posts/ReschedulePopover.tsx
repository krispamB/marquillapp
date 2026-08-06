"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3 } from "lucide-react";
import { createPortal } from "react-dom";
import MarquillMark from "../../components/brand/MarquillMark";
import NaturalScheduleField from "./NaturalScheduleField";
import {
    formatCanonicalText,
    formatPreviewText,
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
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] text-[var(--ink-500)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)] disabled:opacity-40"
                    aria-label="Previous month"
                >
                    <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm font-semibold text-[var(--ink-900)]">
                    {MONTH_NAMES[viewMonth]} {viewYear}
                </span>
                <button
                    type="button"
                    onClick={onNextMonth}
                    disabled={isScheduling}
                    className="flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] text-[var(--ink-500)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)] disabled:opacity-40"
                    aria-label="Next month"
                >
                    <ChevronRight className="h-4 w-4" />
                </button>
            </div>

            {/* Day-of-week headers */}
            <div className="mb-1 grid grid-cols-7 text-center">
                {DAY_LABELS.map((label) => (
                    <span key={label} className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-400)]">
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
                                "mx-auto flex h-8 w-8 items-center justify-center rounded-[var(--r-sm)] text-sm font-medium transition",
                                isPast
                                    ? "cursor-not-allowed opacity-30"
                                    : "cursor-pointer",
                                isSelected
                                    ? "bg-[var(--ink-900)] text-[var(--surface)]"
                                    : isToday
                                        ? "ring-1 ring-[var(--ink-900)] text-[var(--ink-900)]"
                                        : !isPast
                                            ? "text-[var(--ink-700)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)]"
                                            : "text-[var(--ink-400)]",
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
                    className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--ink-500)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)] disabled:opacity-40"
                    aria-label="Increase hours"
                >
                    <ChevronUp className="h-4 w-4" />
                </button>
                <span className="w-10 rounded-[var(--r-sm)] border border-[var(--line-strong)] bg-[var(--surface)] py-1.5 text-center text-base font-semibold tabular-nums text-[var(--ink-900)]">
                    {pad(hours)}
                </span>
                <button
                    type="button"
                    disabled={isScheduling}
                    onClick={() => onChangeHours((hours + 23) % 24)}
                    className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--ink-500)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)] disabled:opacity-40"
                    aria-label="Decrease hours"
                >
                    <ChevronDown className="h-4 w-4" />
                </button>
            </div>

            <span className="mb-0.5 text-xl font-semibold text-[var(--ink-400)]">:</span>

            {/* Minutes */}
            <div className="flex flex-col items-center gap-1">
                <button
                    type="button"
                    disabled={isScheduling}
                    onClick={() => onChangeMinutes((minutes + 1) % 60)}
                    className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--ink-500)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)] disabled:opacity-40"
                    aria-label="Increase minutes"
                >
                    <ChevronUp className="h-4 w-4" />
                </button>
                <span className="w-10 rounded-[var(--r-sm)] border border-[var(--line-strong)] bg-[var(--surface)] py-1.5 text-center text-base font-semibold tabular-nums text-[var(--ink-900)]">
                    {pad(minutes)}
                </span>
                <button
                    type="button"
                    disabled={isScheduling}
                    onClick={() => onChangeMinutes((minutes + 59) % 60)}
                    className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[var(--ink-500)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)] disabled:opacity-40"
                    aria-label="Decrease minutes"
                >
                    <ChevronDown className="h-4 w-4" />
                </button>
            </div>
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
    showNaturalInput = true,
    anchorRef,
    positionClasses = "top-full right-0 mt-2",
    zIndexClass = "z-[72]",
}: {
    isOpen: boolean;
    initialDate?: string;
    initialTime?: string;
    onClose: () => void;
    onConfirm: (scheduledTime: string, timezone: string) => void;
    isScheduling?: boolean;
    showNaturalInput?: boolean;
    anchorRef?: React.RefObject<HTMLElement | null>;
    positionClasses?: string;
    zIndexClass?: string;
}) {
    // ── State ──
    const [text, setText] = useState("");
    const [resolved, setResolved] = useState<Date | null>(null);
    const [showManual, setShowManual] = useState(false);
    const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
    const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
    const [scheduleError, setScheduleError] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState({ top: 16, left: 16 });

    const desktopPopoverRef = useRef<HTMLDivElement | null>(null);

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
        setShowManual(!showNaturalInput);

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

    }, [isOpen, initialDate, initialTime, showNaturalInput]);

    // ── Keep portaled desktop popovers inside the viewport ──
    useEffect(() => {
        if (!isOpen || isMobile || !anchorRef?.current) return;

        const updatePosition = () => {
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(380, window.innerWidth - 32);
            const height = desktopPopoverRef.current?.offsetHeight ?? 520;
            const below = rect.bottom + 8;
            const top = below + height <= window.innerHeight - 16
                ? below
                : Math.max(16, rect.top - height - 8);
            setPopoverPosition({
                top,
                left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
            });
        };

        updatePosition();
        const frame = requestAnimationFrame(updatePosition);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("resize", updatePosition);
            window.removeEventListener("scroll", updatePosition, true);
        };
    }, [anchorRef, isMobile, isOpen, showManual]);

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
    const handleTextChange = useCallback((value: string, date: Date | null) => {
        setText(value);
        setScheduleError(null);
        setResolved(date);
    }, []);

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
                <MarquillMark size={32} theme="auto" className="mq-schedule-mark" title="" />
                <p className="flex-1 text-sm font-semibold text-[var(--ink-900)]">{showNaturalInput ? "Schedule post" : "Pick a date and time"}</p>
                {showNaturalInput ? (
                    <button
                        type="button"
                        onClick={handleToggleManual}
                        disabled={isScheduling}
                        className={[
                            "flex h-8 w-8 items-center justify-center rounded-full transition disabled:opacity-40",
                            showManual
                                ? "bg-[var(--ink-900)] text-[var(--surface)]"
                                : "text-[var(--ink-500)] hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)]",
                        ].join(" ")}
                        aria-label={showManual ? "Hide calendar" : "Pick from calendar"}
                        aria-pressed={showManual}
                    >
                        <CalendarDays className="h-4 w-4" />
                    </button>
                ) : null}
            </div>

            {/* Natural language input */}
            {showNaturalInput ? (
                <NaturalScheduleField
                    text={text}
                    disabled={isScheduling}
                    autoFocus
                    onChange={handleTextChange}
                    onEnter={handleConfirm}
                />
            ) : null}

            {/* Live preview */}
            {showNaturalInput ? <div className="mt-2 min-h-[1.25rem] text-xs font-medium">
                {resolved ? (
                    <p className={isTooSoon ? "text-rose-600" : "text-[var(--ink-900)]"}>
                        <MarquillMark size={15} theme="auto" className="mq-schedule-mark mq-schedule-mark-small mr-1" title="" />
                        {formatPreviewText(resolved)}
                        {isTooSoon ? " — at least 5 minutes ahead, please" : ""}
                    </p>
                ) : text.trim() ? (
                    <p className="text-[var(--ink-500)]">
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
                    <p className="text-[var(--ink-400)]">
                        Press Tab to accept a suggestion
                    </p>
                )}
            </div> : null}

            {/* Manual fallback: calendar + time stepper */}
            {showManual ? (
                <>
                    <div className="my-4 border-t border-[var(--line-faint)]" />
                    <CalendarGrid
                        viewYear={viewYear}
                        viewMonth={viewMonth}
                        scheduleDate={scheduleDateStr}
                        isScheduling={isScheduling}
                        onPrevMonth={handlePrevMonth}
                        onNextMonth={handleNextMonth}
                        onSelectDay={handleSelectDay}
                    />
                    <div className="my-4 border-t border-[var(--line-faint)]" />
                    <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-400)]">
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
            <div className="mt-3 flex items-center gap-2 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs font-medium text-[var(--ink-500)]">
                <Clock3 className="h-4 w-4 shrink-0 text-[var(--ink-900)]" />
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
                    className="inline-flex items-center rounded-[var(--r-md)] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold text-[var(--ink-700)] transition hover:bg-[var(--surface-2)] hover:text-[var(--ink-900)] disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={isScheduling || !isConfirmable}
                    className="inline-flex items-center rounded-[var(--r-md)] border border-[var(--ink-900)] bg-[var(--ink-900)] px-4 py-2 text-xs font-semibold text-[var(--surface)] transition hover:bg-[var(--ink-800)] disabled:opacity-50"
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
                    className="mq-schedule-theme fixed bottom-0 left-0 right-0 z-[101] max-h-[90dvh] overflow-y-auto rounded-t-[var(--r-xl)] border-t border-[var(--line-strong)] bg-[var(--surface)] px-5 pb-10 pt-4 shadow-[var(--sh-lg)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[var(--ink-300)]" />
                    {content}
                </div>
            </>
        );
    }

    // ── Desktop: portal when anchored, legacy absolute positioning otherwise ──
    const desktopPopover = (
        <div
            id="schedule-popover"
            ref={desktopPopoverRef}
            role="dialog"
            aria-label="Schedule post"
            className={`mq-schedule-theme ${anchorRef ? "fixed z-[100]" : `absolute ${positionClasses} ${zIndexClass}`} max-h-[calc(100dvh-32px)] w-[min(92vw,380px)] overflow-y-auto rounded-[var(--r-lg)] border border-[var(--line-strong)] bg-[var(--surface)] p-5 text-[var(--ink-900)] shadow-[var(--sh-lg)]`}
            style={anchorRef ? popoverPosition : undefined}
            onClick={(e) => e.stopPropagation()}
        >
            {content}
        </div>
    );

    return anchorRef && typeof document !== "undefined"
        ? createPortal(desktopPopover, document.body)
        : desktopPopover;
}
