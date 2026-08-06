"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    EMPTY_INPUT_PRESETS,
    getGhostCompletion,
    parseNaturalDate,
} from "./naturalDate";

export default function NaturalScheduleField({
    text,
    disabled = false,
    autoFocus = false,
    variant = "popover",
    id,
    ariaLabel = "Schedule time in natural language",
    onChange,
    onEnter,
    onFocusChange,
}: {
    text: string;
    disabled?: boolean;
    autoFocus?: boolean;
    variant?: "inline" | "popover";
    id?: string;
    ariaLabel?: string;
    onChange: (text: string, date: Date | null) => void;
    onEnter?: () => void;
    onFocusChange?: (focused: boolean) => void;
}) {
    const [isFocused, setIsFocused] = useState(false);
    const [presetIndex, setPresetIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isFocused || text.trim()) return;
        const presetRotationTimer = window.setInterval(
            () => setPresetIndex((index) => (index + 1) % EMPTY_INPUT_PRESETS.length),
            3000,
        );
        return () => window.clearInterval(presetRotationTimer);
    }, [isFocused, text]);

    const ghost = useMemo(() => {
        if (!isFocused || disabled) return null;
        if (!text.trim()) return EMPTY_INPUT_PRESETS[presetIndex];
        return getGhostCompletion(text);
    }, [disabled, isFocused, presetIndex, text]);

    const updateText = useCallback((nextText: string) => {
        onChange(nextText, parseNaturalDate(nextText)?.date ?? null);
    }, [onChange]);

    const acceptGhost = useCallback(() => {
        if (!ghost) return;
        updateText(text + ghost);
        inputRef.current?.focus();
    }, [ghost, text, updateText]);

    const setFocused = (focused: boolean) => {
        setIsFocused(focused);
        onFocusChange?.(focused);
    };

    return (
        <div className={`mq-natural-date-field mq-natural-date-field-${variant}`}>
            <input
                id={id}
                ref={inputRef}
                type="text"
                autoFocus={autoFocus}
                value={text}
                disabled={disabled}
                onChange={(event) => updateText(event.target.value)}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onKeyDown={(event) => {
                    if (ghost && (event.key === "Tab" || (event.key === "ArrowRight" && event.currentTarget.selectionStart === text.length))) {
                        event.preventDefault();
                        acceptGhost();
                        return;
                    }
                    if (event.key === "Enter" && onEnter) {
                        event.preventDefault();
                        onEnter();
                    }
                }}
                placeholder={ghost ? "" : "Try “tomorrow at 9am” or “in 2 hours”…"}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label={ariaLabel}
            />
            {ghost ? (
                <div className="mq-natural-date-ghost" aria-hidden="true">
                    <span>{text}</span>
                    <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            acceptGhost();
                        }}
                    >
                        {ghost}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
