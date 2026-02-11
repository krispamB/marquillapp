import type { ReactNode } from "react";

export function Icon({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`grid h-9 w-9 place-items-center rounded-full bg-white/80 text-[var(--color-secondary)] shadow-[0_12px_24px_-18px_rgba(15,23,42,0.5)] ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-3xl border border-[var(--color-border)] bg-white/75 p-5 shadow-[0_30px_70px_-60px_rgba(15,23,42,0.4)] backdrop-blur-md ${className}`}
    >
      {children}
    </div>
  );
}

export function PillButton({
  children,
  variant = "primary",
  icon,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
}) {
  const base =
    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition active:scale-[0.98]";
  const styles: Record<typeof variant, string> = {
    primary:
      "bg-[var(--color-secondary)] text-white shadow-[0_18px_40px_-26px_rgba(28,27,39,0.55)] hover:-translate-y-0.5",
    secondary:
      "border border-[var(--color-border)] bg-white/85 text-[var(--color-text-secondary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]",
    ghost:
      "border border-transparent bg-transparent text-[var(--color-text-secondary)] hover:bg-white/70",
  };

  return (
    <button className={`${base} ${styles[variant]}`}>
      {icon ? <span className="text-base">{icon}</span> : null}
      {children}
    </button>
  );
}

export function NavItem({
  label,
  active,
  icon,
  collapsed = false,
}: {
  label: string;
  active?: boolean;
  icon: ReactNode;
  collapsed?: boolean;
}) {
  return (
    <button
      className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
        active
          ? "bg-[var(--color-primary)] text-white shadow-[0_18px_35px_-26px_rgba(91,92,246,0.45)]"
          : "text-[var(--color-text-secondary)] hover:bg-white/70"
      }`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-white/80 text-[var(--color-secondary)]">
        {icon}
      </span>
      {collapsed ? null : <span>{label}</span>}
    </button>
  );
}

export function ListItem({
  title,
  subtitle,
  badge,
  icon,
}: {
  title: string;
  subtitle: string;
  badge: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-white/85 px-4 py-3 transition hover:-translate-y-0.5">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-2xl bg-[var(--color-gradient)] text-[var(--color-secondary)]">
          {icon}
        </span>
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            {title}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">
            {subtitle}
          </p>
        </div>
      </div>
      <span className="rounded-full bg-[var(--color-accent)]/20 px-3 py-1 text-xs font-semibold text-[var(--color-primary)]">
        {badge}
      </span>
    </div>
  );
}
