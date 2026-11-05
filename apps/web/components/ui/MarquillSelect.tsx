"use client";

import { Check, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type MarquillSelectOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

interface MarquillSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: MarquillSelectOption[];
  placeholder?: string;
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  /** Submits the value with a surrounding form. */
  name?: string;
  dropdownPosition?: "top" | "bottom";
  /** Title of the menu; shown above the options on mobile. */
  dropdownHeader?: string;
}

/** Below this width the menu opens as a bottom sheet. Matches the app's mobile breakpoint. */
export const SHEET_MEDIA_QUERY = "(max-width: 700px)";
const GAP = 6;
const EDGE = 8;
const MAX_MENU_HEIGHT = 320;
const MIN_MENU_WIDTH = 180;

type Placement = { style: CSSProperties; side: "top" | "bottom" };

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

function firstEnabled(options: MarquillSelectOption[], from: number, step: 1 | -1) {
  for (let index = from, seen = 0; seen < options.length; index += step, seen += 1) {
    const wrapped = (index + options.length) % options.length;
    if (!options[wrapped].disabled) return wrapped;
  }
  return -1;
}

/** The app's dropdown: a popover on desktop, a bottom sheet on mobile. Never the OS picker. */
export default function MarquillSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  icon,
  className = "",
  disabled = false,
  ariaLabel,
  id,
  name,
  dropdownPosition = "bottom",
  dropdownHeader,
}: MarquillSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const isSheet = useMediaQuery(SHEET_MEDIA_QUERY);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", timer: 0 });
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const title = dropdownHeader ?? ariaLabel ?? placeholder;

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setPlacement(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback((preferLast = false) => {
    if (disabled || options.length === 0) return;
    const start = selectedIndex >= 0 && !options[selectedIndex].disabled
      ? selectedIndex
      : firstEnabled(options, preferLast ? options.length - 1 : 0, preferLast ? -1 : 1);
    setActiveIndex(start);
    // Render inside the workspace shell so the menu inherits its theme tokens.
    setPortalTarget((triggerRef.current?.closest(".mq-shell") as HTMLElement | null) ?? document.body);
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const commit = useCallback((index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (option.value !== value) onChange(option.value);
    close();
  }, [close, onChange, options, value]);

  // Anchor the popover to the trigger, flipping above it when there is no room below.
  const position = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || isSheet) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(rect.width, MIN_MENU_WIDTH), viewportWidth - EDGE * 2);
    const left = Math.min(Math.max(rect.left, EDGE), viewportWidth - width - EDGE);
    const below = viewportHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const wanted = Math.min(MAX_MENU_HEIGHT, options.length * 38 + 12);
    let side: "top" | "bottom" = dropdownPosition;
    if (side === "bottom" && below < wanted && above > below) side = "top";
    if (side === "top" && above < wanted && below > above) side = "bottom";
    const maxHeight = Math.max(120, Math.min(MAX_MENU_HEIGHT, side === "bottom" ? below : above));
    setPlacement({
      side,
      style: side === "bottom"
        ? { top: rect.bottom + GAP, left, width, maxHeight }
        : { bottom: viewportHeight - rect.top + GAP, left, width, maxHeight },
    });
  }, [dropdownPosition, isSheet, options.length]);

  useLayoutEffect(() => {
    if (open) position();
  }, [open, position]);

  const menuReady = Boolean(open && portalTarget && (isSheet || placement));

  // The list mounts once the menu is placed; move focus into it so the keyboard drives it.
  useEffect(() => {
    if (menuReady) listRef.current?.focus({ preventScroll: true });
  }, [menuReady]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onReflow = () => position();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [close, open, position]);

  // The sheet covers the page, so keep the page from scrolling behind it.
  useEffect(() => {
    if (!open || !isSheet) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [isSheet, open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
    // optionId is derived from a stable useId value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, open]);

  useEffect(() => () => window.clearTimeout(typeahead.current.timer), []);

  const matchTypeahead = (key: string) => {
    const state = typeahead.current;
    window.clearTimeout(state.timer);
    state.text += key.toLowerCase();
    state.timer = window.setTimeout(() => { state.text = ""; }, 500);
    const start = state.text.length === 1 ? activeIndex + 1 : Math.max(activeIndex, 0);
    for (let seen = 0; seen < options.length; seen += 1) {
      const index = (start + seen) % options.length;
      const option = options[index];
      if (!option.disabled && option.label.toLowerCase().startsWith(state.text)) return index;
    }
    return -1;
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openMenu(event.key === "ArrowUp");
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const move = (index: number) => { if (index >= 0) setActiveIndex(index); };
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(firstEnabled(options, activeIndex + 1, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        move(firstEnabled(options, activeIndex - 1 < 0 ? options.length - 1 : activeIndex - 1, -1));
        break;
      case "Home":
        event.preventDefault();
        move(firstEnabled(options, 0, 1));
        break;
      case "End":
        event.preventDefault();
        move(firstEnabled(options, options.length - 1, -1));
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        close(false);
        break;
      default:
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          move(matchTypeahead(event.key));
        }
    }
  };

  const display = selected?.label ?? placeholder;

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        className={`mq-select${open ? " is-open" : ""}${selected ? "" : " is-placeholder"} ${className}`.trim()}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel ? `${ariaLabel}: ${display}` : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {icon ? <span className="mq-select-lead" aria-hidden="true">{icon}</span> : null}
        {selected?.icon ? <span className="mq-select-lead" aria-hidden="true">{selected.icon}</span> : null}
        <span className="mq-select-value">{display}</span>
        <ChevronDown className="mq-select-chevron" size={14} aria-hidden="true" />
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {menuReady && portalTarget ? createPortal(
        <div className={`mq-select-layer${isSheet ? " is-sheet" : ""}`}>
          {isSheet ? <div className="mq-select-backdrop" aria-hidden="true" onClick={() => close()} /> : null}
          <div
            className={`mq-select-menu${isSheet ? " is-sheet" : ` is-${placement?.side}`}`}
            style={isSheet ? undefined : placement?.style}
          >
            {isSheet ? (
              <div className="mq-select-sheet-head">
                <span className="mq-select-grabber" aria-hidden="true" />
                <strong>{title}</strong>
              </div>
            ) : dropdownHeader ? (
              <div className="mq-select-menu-head">{dropdownHeader}</div>
            ) : null}
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={title}
              aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
              className="mq-select-list"
              onKeyDown={onListKeyDown}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    className={`mq-select-option${index === activeIndex ? " is-active" : ""}${isSelected ? " is-selected" : ""}`}
                    onPointerMove={() => { if (!option.disabled && index !== activeIndex) setActiveIndex(index); }}
                    onClick={() => commit(index)}
                  >
                    {option.icon ? <span className="mq-select-option-icon" aria-hidden="true">{option.icon}</span> : null}
                    <span className="mq-select-option-label">{option.label}</span>
                    {isSelected ? <Check className="mq-select-check" size={15} aria-hidden="true" /> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>,
        portalTarget,
      ) : null}
    </>
  );
}
