"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import MarquillMark from "../../components/brand/MarquillMark";
import NaturalScheduleField from "../posts/NaturalScheduleField";
import { ReschedulePopover } from "../posts/ReschedulePopover";
import { formatPreviewText } from "../posts/naturalDate";

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

function datePart(date: Date | null) {
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timePart(date: Date | null) {
  if (!date) return "";
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
  const selected = useMemo(() => parseLocalValue(value), [value]);
  const [draftText, setDraftText] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const calendarButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputId = useId();
  const text = draftText ?? "";

  const updateText = useCallback((nextText: string, parsedDate: Date | null) => {
    setDraftText(nextText);
    onChange(parsedDate ? localDateTimeValue(parsedDate) : "");
  }, [onChange]);

  return (
    <div className="mq-schedule-picker mq-schedule-natural">
      <label className="mq-schedule-natural-label" htmlFor={inputId}>{label}</label>
      <div className="mq-schedule-natural-field">
        <div className="mq-schedule-natural-input-wrap">
          <NaturalScheduleField
            id={inputId}
            text={text}
            disabled={disabled}
            variant="inline"
            ariaLabel={`${label} in natural language`}
            onChange={updateText}
            onFocusChange={(focused) => {
              setDraftText(focused ? text : null);
            }}
          />
        </div>
        <button
          ref={calendarButtonRef}
          type="button"
          className="mq-schedule-calendar-button"
          onClick={() => setIsCalendarOpen((open) => !open)}
          disabled={disabled}
          aria-label="Pick from calendar"
          aria-expanded={isCalendarOpen}
          aria-haspopup="dialog"
          data-schedule-trigger="true"
        >
          <CalendarDays size={17} />
        </button>
      </div>
      <div className="mq-schedule-natural-status">
        {selected ? <><MarquillMark size={15} theme="auto" className="mq-schedule-mark mq-schedule-mark-small" title="" /><span>{formatPreviewText(selected)}</span></> : <span>Try “next Friday at noon” or use the calendar.</span>}
      </div>
      <ReschedulePopover
        isOpen={isCalendarOpen}
        initialDate={datePart(selected)}
        initialTime={timePart(selected)}
        onClose={() => setIsCalendarOpen(false)}
        onConfirm={(scheduledTime) => {
          const next = new Date(scheduledTime);
          if (!Number.isNaN(next.getTime())) {
            onChange(localDateTimeValue(next));
            setDraftText(null);
          }
          setIsCalendarOpen(false);
        }}
        isScheduling={disabled}
        showNaturalInput={false}
        anchorRef={calendarButtonRef}
      />
    </div>
  );
}
