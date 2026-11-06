"use client";

import { CalendarClock, MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export type PostRowMenuStatus = "DRAFT" | "SCHEDULED" | "PUBLISHED";

const MENU_WIDTH = 188;

/**
 * The phone version of a post row's actions: one More button that opens the same
 * actions the desktop icons offer, with the same disabled conditions.
 */
export default function PostRowMenu({
  status,
  editHref,
  linkedinDisabled,
  linkedinDisabledReason,
  busy,
  onSchedule,
  onPublish,
  onDelete,
}: {
  status: PostRowMenuStatus;
  editHref: string;
  linkedinDisabled: boolean;
  linkedinDisabledReason: string;
  busy: boolean;
  onSchedule: () => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const menuId = useId();
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOpen = position !== null;

  function close(restoreFocus = false) {
    setPosition(null);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function toggle() {
    if (isOpen) return close();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Fixed so the post list's overflow clipping never cuts the menu off.
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
    setPosition({ top: rect.bottom + 4, left });
  }

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") return close(true);
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []);
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
      items[next].focus();
    }
    const dismiss = () => close();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [isOpen]);

  const showPublish = status !== "PUBLISHED";

  return (
    <div ref={rootRef} className="mq-post-row-menu">
      <button
        ref={triggerRef}
        type="button"
        className="mq-icon-button mq-more-button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={toggle}
      >
        <MoreHorizontal size={16} />
      </button>
      {position ? (
        <div id={menuId} ref={menuRef} role="menu" className="mq-post-row-menu-list" style={{ top: position.top, left: position.left }}>
          {status === "DRAFT" ? (
            <Link href={editHref} role="menuitem" onClick={() => close()}><Pencil size={14} /> Edit</Link>
          ) : null}
          {status === "SCHEDULED" ? (
            <button type="button" role="menuitem" disabled={linkedinDisabled} onClick={() => { close(); onSchedule(); }}><CalendarClock size={14} /> Reschedule</button>
          ) : null}
          {showPublish ? (
            <button type="button" role="menuitem" disabled={linkedinDisabled || busy} onClick={() => { close(); onPublish(); }}><Send size={14} /> Publish now</button>
          ) : null}
          <button type="button" role="menuitem" className="is-danger" disabled={busy} onClick={() => { close(); onDelete(); }}><Trash2 size={14} /> Delete</button>
          {linkedinDisabled && showPublish ? <p className="mq-post-row-menu-note">{linkedinDisabledReason}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
