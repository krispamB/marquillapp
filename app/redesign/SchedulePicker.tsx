"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Clock3 } from "lucide-react";
import { createPortal } from "react-dom";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export function localDateTimeValue(date = getDefaultScheduleDate()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function getDefaultScheduleDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return date;
}

function parseLocalValue(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthLabel(date: Date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function calendarCells(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function formatValue(date: Date | null) {
  if (!date) return "Pick a date and time";
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function timeValue(date: Date | null) {
  if (!date) return "09:00";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function SchedulePicker({
  value,
  onChange,
  disabled = false,
  label = "Schedule time",
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const selected = parseLocalValue(value);
    const date = selected ?? getDefaultScheduleDate();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const selected = useMemo(() => parseLocalValue(value), [value]);
  const cells = useMemo(() => calendarCells(cursor), [cursor]);

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(360, window.innerWidth - 32);
      const height = Math.min(470, window.innerHeight - 32);
      setPopoverPosition({
        top: Math.max(16, Math.min(rect.bottom + 8, window.innerHeight - height - 16)),
        left: Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16)),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || triggerRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-schedule-picker]")) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function openPicker() {
    if (disabled) return;
    const next = selected ?? getDefaultScheduleDate();
    setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
    setIsOpen((open) => !open);
  }

  function updateDate(day: Date) {
    const next = selected ? new Date(selected) : getDefaultScheduleDate();
    next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    onChange(localDateTimeValue(next));
  }

  function updateTime(nextTime: string) {
    const [hours, minutes] = nextTime.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;
    const next = selected ? new Date(selected) : getDefaultScheduleDate();
    next.setHours(hours, minutes, 0, 0);
    onChange(localDateTimeValue(next));
  }

  const popover = (
    <div
      className="mq-schedule-popover"
      data-schedule-picker
      role="dialog"
      aria-label="Pick a schedule date and time"
      style={{ top: popoverPosition.top, left: popoverPosition.left }}
    >
      <div className="mq-schedule-popover-heading">
        <div>
          <span className="mq-eyebrow">Schedule</span>
          <strong>{formatValue(selected)}</strong>
        </div>
        <button type="button" className="mq-icon-button" onClick={() => setIsOpen(false)} aria-label="Close date picker">
          <Check size={15} />
        </button>
      </div>

      <div className="mq-schedule-month-nav">
        <button
          type="button"
          className="mq-icon-button"
          onClick={() => setCursor((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1))}
          aria-label="Previous month"
        >
          <ChevronLeft size={15} />
        </button>
        <strong>{monthLabel(cursor)}</strong>
        <button
          type="button"
          className="mq-icon-button"
          onClick={() => setCursor((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1))}
          aria-label="Next month"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="mq-schedule-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mq-schedule-grid">
        {cells.map((day) => {
          const isSelected = selected ? dateKey(selected) === dateKey(day) : false;
          const isToday = dateKey(new Date()) === dateKey(day);
          const isPast = day < new Date(new Date().setHours(0, 0, 0, 0));
          const isCurrentMonth = day.getMonth() === cursor.getMonth();
          return (
            <button
              type="button"
              key={dateKey(day)}
              className={`mq-schedule-day ${isSelected ? "is-selected" : ""} ${isToday ? "is-today" : ""} ${!isCurrentMonth ? "is-outside" : ""}`}
              disabled={isPast}
              onClick={() => updateDate(day)}
              aria-label={day.toLocaleDateString(undefined, { dateStyle: "full" })}
              aria-pressed={isSelected}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <label className="mq-schedule-time">
        <span><Clock3 size={14} /> Time</span>
        <input type="time" value={timeValue(selected)} onChange={(event) => updateTime(event.target.value)} />
      </label>
      <p className="mq-schedule-helper">Times use your browser timezone. Choose at least five minutes from now.</p>
    </div>
  );

  return (
    <div className="mq-schedule-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`mq-schedule-trigger ${isOpen ? "is-open" : ""}`}
        onClick={openPicker}
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <CalendarClock size={15} />
        <span><small>{label}</small><strong>{formatValue(selected)}</strong></span>
      </button>
      {isOpen && typeof document !== "undefined" ? createPortal(popover, document.body) : null}
    </div>
  );
}
