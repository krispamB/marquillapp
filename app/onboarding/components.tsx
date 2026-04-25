"use client";

import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Briefcase,
  Building2,
  CalendarCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  EyeOff,
  Heart,
  Layers,
  Lightbulb,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Mic,
  PenLine,
  PlusCircle,
  Rocket,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react";

// ── Icon map from design name → lucide component ──
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number; color?: string; className?: string }>> = {
  user: User,
  "pen-line": PenLine,
  sparkles: Sparkles,
  "trending-up": TrendingUp,
  "badge-check": BadgeCheck,
  megaphone: Megaphone,
  "message-square": MessageSquare,
  rocket: Rocket,
  briefcase: Briefcase,
  users: Users,
  lightbulb: Lightbulb,
  target: Target,
  "message-circle": MessageCircle,
  layers: Layers,
  "calendar-check": CalendarCheck,
  send: Send,
  mic: Mic,
  "bar-chart-3": BarChart3,
  "calendar-clock": CalendarClock,
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
  check: Check,
  "check-circle-2": CheckCircle2,
  "shield-check": ShieldCheck,
  "eye-off": EyeOff,
  "settings-2": Settings2,
  "plus-circle": PlusCircle,
  "building-2": Building2,
  "heart-handshake": Heart,
  x: X,
};

interface IconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  color?: string;
}

export function Icon({ name, size = 16, strokeWidth = 2, color }: IconProps) {
  const Component = ICON_MAP[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={strokeWidth} color={color} />;
}

// ── Orbs background ──
export function LocalOrbs() {
  return (
    <div className="ob-orbs" aria-hidden="true">
      <div className="orb o1" />
      <div className="orb o2" />
      <div className="orb o3" />
    </div>
  );
}

// ── Brand row ──
const BRAND_WORDMARK =
  "https://res.cloudinary.com/dnpvndlmy/image/upload/q_auto/f_auto/v1775561659/marquill/logo_nwvdon.svg";

interface BrandRowProps {
  right?: React.ReactNode;
}
export function BrandRow({ right }: BrandRowProps) {
  return (
    <div className="ob-brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="word" src={BRAND_WORDMARK} alt="Marquill" />
      {right && <div className="ob-brand-right">{right}</div>}
    </div>
  );
}

// ── Progress indicator ──
interface ProgressProps {
  step: number;
  total: number;
  style?: "bar" | "dots" | "steps";
}
export function Progress({ step, total, style = "steps" }: ProgressProps) {
  if (style === "dots") {
    return (
      <div className="progress">
        <span className="label">Step {step} / {total}</span>
        <div className="progress-dots">
          {Array.from({ length: total }).map((_, i) => {
            const cls = i + 1 < step ? "done" : i + 1 === step ? "current" : "";
            return <i key={i} className={cls} />;
          })}
        </div>
      </div>
    );
  }
  if (style === "steps") {
    return (
      <div className="progress">
        <span className="progress-steps">Step {step} of {total}</span>
        <div className="progress-bar" style={{ opacity: 0.35 }}>
          <i style={{ width: `${(step / total) * 100}%` }} />
        </div>
      </div>
    );
  }
  // bar
  return (
    <div className="progress">
      <span className="label">Step {step} / {total}</span>
      <div className="progress-bar">
        <i style={{ width: `${(step / total) * 100}%` }} />
      </div>
    </div>
  );
}

// ── Radio tile (single-select) ──
interface RadioTileProps {
  icon: string;
  title: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}
export function RadioTile({ icon, title, sub, selected, onClick }: RadioTileProps) {
  return (
    <button
      type="button"
      className={`tile${selected ? " selected" : ""}`}
      onClick={onClick}
    >
      <span className="t-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="t-body">
        <span className="t-title">{title}</span>
        <span className="t-sub">{sub}</span>
      </span>
      <span className="t-radio" />
    </button>
  );
}

// ── Goal tile (multi-select grid) ──
interface GoalTileProps {
  icon: string;
  title: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}
export function GoalTile({ icon, title, sub, selected, onClick }: GoalTileProps) {
  return (
    <button
      type="button"
      className={`goal-tile${selected ? " selected" : ""}`}
      onClick={onClick}
    >
      <span className="g-check">
        <Icon name="check" size={14} strokeWidth={3} />
      </span>
      <span className="g-icon">
        <Icon name={icon} size={16} />
      </span>
      <span className="g-title">{title}</span>
      <span className="g-sub">{sub}</span>
    </button>
  );
}

// ── Topic chip (multi-select) ──
interface ChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}
export function Chip({ label, selected, onClick }: ChipProps) {
  return (
    <button
      type="button"
      className={`chip${selected ? " selected" : ""}`}
      onClick={onClick}
    >
      {label}
      {selected && (
        <span className="x">
          <X size={12} strokeWidth={2.5} />
        </span>
      )}
    </button>
  );
}

// ── Success toast ──
interface SuccessToastProps {
  name: string;
}
export function SuccessToast({ name }: SuccessToastProps) {
  return (
    <div className="ob-toast" role="status">
      <span className="check">
        <Check size={14} strokeWidth={3} />
      </span>
      <span>You&apos;re all set, {name || "friend"} — welcome to Marquill.</span>
      <span className="spark">✦</span>
    </div>
  );
}
