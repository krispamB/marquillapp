"use client";

import type { ReactNode } from "react";

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
  dropdownPosition?: "top" | "bottom";
  dropdownHeader?: string;
}

/** A plain native select shared across the app. */
export default function MarquillSelect({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  className = "",
  disabled = false,
  ariaLabel,
  id,
}: MarquillSelectProps) {
  return (
    <select
      id={id}
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      {!value ? <option value="" disabled>{placeholder}</option> : null}
      {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  );
}
