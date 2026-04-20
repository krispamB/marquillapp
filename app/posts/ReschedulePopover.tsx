"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3 } from "lucide-react";

// ─── Utility functions (unchanged) ────────────────────────────────────────────

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

// ─── Shared inner content ──────────────────────────────────────────────────────

function PickerContent({
    viewYear,
    viewMonth,
    scheduleDate,
    hours,
    minutes,
    scheduleError,
    timezoneLabel,
    isScheduling,
    onPrevMonth,
    onNextMonth,
    onSelectDay,
    onChangeHours,
    onChangeMinutes,
    onClose,
    onConfirm,
}: {
    viewYear: number;
    viewMonth: number;
    scheduleDate: string;
    hours: number;
    minutes: number;
    scheduleError: string | null;
    timezoneLabel: string;
    isScheduling: boolean;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    onSelectDay: (d: string) => void;
    onChangeHours: (h: number) => void;
    onChangeMinutes: (m: number) => void;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <>
            {/* Header */}
            <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#eef3ff] text-[#3451d1]">
                    <CalendarClock className="h-4 w-4" />
                </span>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Schedule Post</p>
            </div>

            {/* Calendar */}
            <CalendarGrid
                viewYear={viewYear}
                viewMonth={viewMonth}
                scheduleDate={scheduleDate}
                isScheduling={isScheduling}
                onPrevMonth={onPrevMonth}
                onNextMonth={onNextMonth}
                onSelectDay={onSelectDay}
            />

            {/* Divider */}
            <div className="my-4 border-t border-[var(--color-border)]" />

            {/* Time label */}
            <p className="mb-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                Time
            </p>

            {/* Time stepper */}
            <TimeStepper
                hours={hours}
                minutes={minutes}
                isScheduling={isScheduling}
                onChangeHours={onChangeHours}
                onChangeMinutes={onChangeMinutes}
            />

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
                    onClick={onClose}
                    disabled={isScheduling}
                    className="inline-flex items-center rounded-full border border-[#d4dae6] bg-white px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isScheduling}
                    className="inline-flex items-center rounded-full bg-[#1C1B27] px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                    {isScheduling ? "Scheduling…" : "Confirm Schedule"}
                </button>
            </div>
        </>
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
    const now = new Date();

    // ── State ──
    const [scheduleDate, setScheduleDate] = useState(initialDate || "");
    const [hours, setHours] = useState(() => {
        if (initialTime) {
            const h = parseInt(initialTime.split(":")[0], 10);
            return Number.isFinite(h) ? h : now.getHours();
        }
        return now.getHours();
    });
    const [minutes, setMinutes] = useState(() => {
        if (initialTime) {
            const m = parseInt(initialTime.split(":")[1], 10);
            return Number.isFinite(m) ? m : now.getMinutes();
        }
        return now.getMinutes();
    });
    const [viewYear, setViewYear] = useState(() => {
        if (initialDate) {
            const y = parseInt(initialDate.split("-")[0], 10);
            return Number.isFinite(y) ? y : now.getFullYear();
        }
        return now.getFullYear();
    });
    const [viewMonth, setViewMonth] = useState(() => {
        if (initialDate) {
            const m = parseInt(initialDate.split("-")[1], 10);
            return Number.isFinite(m) ? m - 1 : now.getMonth();
        }
        return now.getMonth();
    });
    const [scheduleError, setScheduleError] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState(false);

    // scheduleTime string derived from hours/minutes
    const scheduleTime = `${pad(hours)}:${pad(minutes)}`;

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
        const d = new Date();
        setScheduleDate(initialDate || "");
        setScheduleError(null);
        if (initialTime) {
            const h = parseInt(initialTime.split(":")[0], 10);
            const m = parseInt(initialTime.split(":")[1], 10);
            setHours(Number.isFinite(h) ? h : d.getHours());
            setMinutes(Number.isFinite(m) ? m : d.getMinutes());
        } else {
            setHours(d.getHours());
            setMinutes(d.getMinutes());
        }
        if (initialDate) {
            const y = parseInt(initialDate.split("-")[0], 10);
            const mo = parseInt(initialDate.split("-")[1], 10);
            if (Number.isFinite(y) && Number.isFinite(mo)) {
                setViewYear(y);
                setViewMonth(mo - 1);
            }
        } else {
            setViewYear(d.getFullYear());
            setViewMonth(d.getMonth());
        }
    }, [isOpen, initialDate, initialTime]);

    // ── Desktop outside-click handler ──
    useEffect(() => {
        if (!isOpen || isMobile) return;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
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

    // ── Navigation ──
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
    const getScheduledTimeValue = useCallback(() => {
        if (!scheduleDate || !scheduleTime) {
            return { error: "Please select both date and time." } as const;
        }
        const [year, month, day] = scheduleDate.split("-").map(Number);
        const [h, m] = scheduleTime.split(":").map(Number);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) ||
            !Number.isFinite(h) || !Number.isFinite(m)) {
            return { error: "Please provide a valid date and time." } as const;
        }
        const localDate = new Date(year, month - 1, day, h, m, 0, 0);
        if (Number.isNaN(localDate.getTime()) ||
            localDate.getFullYear() !== year ||
            localDate.getMonth() !== month - 1 ||
            localDate.getDate() !== day) {
            return { error: "Please provide a valid date and time." } as const;
        }
        if (localDate.getTime() < Date.now() + 5 * 60 * 1000) {
            return { error: "Choose a time at least 5 minutes in the future." } as const;
        }
        return { scheduledTime: formatOffsetDateTime(localDate) } as const;
    }, [scheduleDate, scheduleTime]);

    const handleConfirm = useCallback(() => {
        const result = getScheduledTimeValue();
        if ("error" in result) {
            setScheduleError(result.error as string);
            return;
        }
        setScheduleError(null);
        onConfirm(result.scheduledTime, userTimezone);
    }, [getScheduledTimeValue, onConfirm, userTimezone]);

    const handleClose = useCallback(() => {
        setScheduleError(null);
        onClose();
    }, [onClose]);

    if (!isOpen) return null;

    const contentProps = {
        viewYear,
        viewMonth,
        scheduleDate,
        hours,
        minutes,
        scheduleError,
        timezoneLabel,
        isScheduling,
        onPrevMonth: handlePrevMonth,
        onNextMonth: handleNextMonth,
        onSelectDay: setScheduleDate,
        onChangeHours: setHours,
        onChangeMinutes: setMinutes,
        onClose: handleClose,
        onConfirm: handleConfirm,
    };

    // ── Mobile: bottom sheet ──
    if (isMobile) {
        return (
            <>
                <div
                    className="fixed inset-0 z-40 bg-black/40"
                    onClick={handleClose}
                />
                <div
                    className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl bg-white px-5 pb-10 pt-4 shadow-[0_-8px_30px_-4px_rgba(15,23,42,0.15)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-slate-200" />
                    <PickerContent {...contentProps} />
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
            <PickerContent {...contentProps} />
        </div>
    );
}
