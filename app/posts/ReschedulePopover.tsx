import { useState, useRef, useEffect, useMemo } from "react";
import { CalendarClock, Clock3 } from "lucide-react";

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

export function ReschedulePopover({
    isOpen,
    initialDate,
    initialTime,
    onClose,
    onConfirm,
    isScheduling = false,
    positionClasses = "bottom-full right-0 mb-3",
    zIndexClass = "z-[72]"
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
    const [scheduleDate, setScheduleDate] = useState(initialDate || "");
    const [scheduleTime, setScheduleTime] = useState(initialTime || "");
    const [scheduleError, setScheduleError] = useState<string | null>(null);

    const schedulePopoverRef = useRef<HTMLDivElement | null>(null);
    const scheduleDateInputRef = useRef<HTMLInputElement | null>(null);

    const userTimezone = useMemo(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        [],
    );
    const timezoneLabel = useMemo(
        () => `${formatUtcOffsetLabel(new Date().getTimezoneOffset())} (${userTimezone})`,
        [userTimezone],
    );

    useEffect(() => {
        if (isOpen) {
            setScheduleDate(initialDate || "");
            setScheduleTime(initialTime || "");
            setScheduleError(null);
        }
    }, [isOpen, initialDate, initialTime]);

    useEffect(() => {
        if (!isOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (schedulePopoverRef.current?.contains(target)) return;
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
    }, [isOpen, onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const rafId = window.requestAnimationFrame(() => {
            scheduleDateInputRef.current?.focus();
        });
        return () => window.cancelAnimationFrame(rafId);
    }, [isOpen]);

    const getScheduledTimeValue = () => {
        if (!scheduleDate || !scheduleTime) {
            return { error: "Please select both date and time." } as const;
        }
        const [year, month, day] = scheduleDate.split("-").map((value) => Number(value));
        const [hours, minutes] = scheduleTime.split(":").map((value) => Number(value));
        if (
            !Number.isFinite(year) ||
            !Number.isFinite(month) ||
            !Number.isFinite(day) ||
            !Number.isFinite(hours) ||
            !Number.isFinite(minutes)
        ) {
            return { error: "Please provide a valid date and time." } as const;
        }

        const localDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
        if (
            Number.isNaN(localDate.getTime()) ||
            localDate.getFullYear() !== year ||
            localDate.getMonth() !== month - 1 ||
            localDate.getDate() !== day
        ) {
            return { error: "Please provide a valid date and time." } as const;
        }

        const minLeadTimeMs = 5 * 60 * 1000;
        if (localDate.getTime() < Date.now() + minLeadTimeMs) {
            return { error: "Choose a time at least 5 minutes in the future." } as const;
        }

        return { scheduledTime: formatOffsetDateTime(localDate) } as const;
    };

    const handleConfirmSchedule = () => {
        const result = getScheduledTimeValue();
        if ("error" in result && result.error) {
            setScheduleError(result.error);
            return;
        }
        setScheduleError(null);
        onConfirm(result.scheduledTime, userTimezone);
    };

    if (!isOpen) return null;

    return (
        <div
            id="schedule-popover"
            ref={schedulePopoverRef}
            role="dialog"
            aria-label="Schedule post"
            className={`absolute ${positionClasses} ${zIndexClass} w-[min(92vw,380px)] rounded-2xl border border-[#d6dae3] bg-white p-4 shadow-[0_20px_44px_-28px_rgba(15,23,42,0.45)]`}
            onClick={(e) => e.stopPropagation()} // Prevent list item rows from clicking
        >
            <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#eef3ff] text-[#3451d1]">
                    <CalendarClock className="h-4 w-4" />
                </span>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Schedule Post</p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                        Date
                    </span>
                    <input
                        ref={scheduleDateInputRef}
                        type="date"
                        value={scheduleDate}
                        onChange={(event) => setScheduleDate(event.target.value)}
                        disabled={isScheduling}
                        className="h-11 w-full rounded-xl border border-[#cfd5e1] bg-white px-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[#5575F5] focus:ring-2 focus:ring-[#5575F5]/20 disabled:opacity-50"
                    />
                </label>
                <label className="block">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
                        Time
                    </span>
                    <input
                        type="time"
                        value={scheduleTime}
                        onChange={(event) => setScheduleTime(event.target.value)}
                        disabled={isScheduling}
                        className="h-11 w-full rounded-xl border border-[#cfd5e1] bg-white px-3 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[#5575F5] focus:ring-2 focus:ring-[#5575F5]/20 disabled:opacity-50"
                    />
                </label>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#e2e7f2] bg-[#f7f9ff] px-3 py-2 text-xs font-medium text-[#445065]">
                <Clock3 className="h-4 w-4 text-[#5575F5]" />
                <span>{timezoneLabel}</span>
            </div>
            {scheduleError ? (
                <p className="mt-2 text-xs font-medium text-rose-600">{scheduleError}</p>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={() => {
                        onClose();
                        setScheduleError(null);
                    }}
                    disabled={isScheduling}
                    className="inline-flex items-center rounded-full border border-[#d4dae6] bg-white px-4 py-2 text-xs font-semibold text-[var(--color-text-secondary)] transition hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleConfirmSchedule}
                    disabled={isScheduling}
                    className="inline-flex items-center rounded-full bg-[var(--color-secondary)] px-4 py-2 text-xs font-semibold text-white transition hover:brightness-95 disabled:opacity-50"
                >
                    {isScheduling ? "Scheduling..." : "Confirm Schedule"}
                </button>
            </div>
        </div>
    );
}
