"use client";

import { CalendarClock, Send } from "lucide-react";
import SchedulePicker from "./SchedulePicker";

export default function PostSchedulingControls({
  canSubmit,
  isBusy,
  isScheduling,
  scheduleMode,
  scheduleValue,
  onChange,
  onConfirm,
  onModeChange,
}: {
  canSubmit: boolean;
  isBusy: boolean;
  isScheduling: boolean;
  scheduleMode: boolean;
  scheduleValue: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onModeChange: (value: boolean) => void;
}) {
  return (
    <>
      <div className={`mq-card mq-create-schedule-card ${scheduleMode ? "is-open" : ""}`}>
        <h2>When should this publish?</h2>
        <div className="mq-segmented mq-segmented-small">
          <button type="button" className={!scheduleMode ? "is-active" : ""} onClick={() => onModeChange(false)}>Publish now</button>
          <button type="button" className={scheduleMode ? "is-active" : ""} onClick={() => onModeChange(true)}>Schedule</button>
        </div>
        {scheduleMode ? (
          <><SchedulePicker value={scheduleValue} onChange={onChange} disabled={isBusy} /><button type="button" className="mq-primary-button" disabled={!canSubmit} onClick={onConfirm}>{isScheduling ? "Scheduling…" : "Confirm schedule"}</button></>
        ) : <p><Send size={14} /> Ready when you are. Use Publish now above.</p>}
      </div>
      <div className="mq-mobile-schedule-bar"><span><CalendarClock size={16} /><span><small>Suggested</small><strong>{new Date(scheduleValue).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong></span></span><button type="button" disabled={isBusy} onClick={() => onModeChange(true)}>Schedule</button></div>
    </>
  );
}
