"use client";

import { useState, useEffect, useRef } from "react";
import { User, Briefcase, PlusCircle, CheckCircle2, ArrowRight, ShieldCheck, EyeOff, Settings2 } from "lucide-react";
import { RadioTile, GoalTile, Chip, Icon } from "./components";
import type { OnboardingData } from "./OnboardingClient";
import { CADENCE_DEFAULTS } from "./OnboardingClient";
import { DayOfWeek } from "./types";

const API = process.env.NEXT_PUBLIC_API_BASE_URL;

// ── Data constants (exact from design) ──

export const PERSONA_OPTIONS = [
  { key: "creator", icon: "user",     title: "I'm a solo creator",  sub: "Building my own LinkedIn presence." },
  { key: "writer",  icon: "pen-line", title: "I'm a pro writer",    sub: "I ghostwrite or manage posts for multiple clients." },
] as const;

export const EXPERIENCE_OPTIONS = [
  { key: "new",      icon: "sparkles",    title: "Just getting started", sub: "Under 500 followers — finding my voice." },
  { key: "building", icon: "trending-up", title: "Building momentum",    sub: "500 – 5,000 followers — posting semi-regularly." },
  { key: "seasoned", icon: "badge-check", title: "Seasoned creator",     sub: "5,000+ followers — I want to stay consistent." },
] as const;

const CLIENT_COUNT_OPTIONS = [
  { key: "1-2",  title: "1–2 clients",  sub: "Just starting out or writing for friends." },
  { key: "3-5",  title: "3–5 clients",  sub: "Building a steady book of business." },
  { key: "6-10", title: "6–10 clients", sub: "Full roster — cadence is critical." },
  { key: "10+",  title: "10+ clients",  sub: "Agency scale. Let's talk about team seats." },
];

export const GOALS_CREATOR = [
  { key: "followers",   icon: "users",          title: "Grow my audience",       sub: "Reach more people in my space." },
  { key: "leadership",  icon: "lightbulb",      title: "Thought leadership",     sub: "Be known for a point of view." },
  { key: "leads",       icon: "target",         title: "Generate leads",         sub: "Turn attention into pipeline." },
  { key: "brand",       icon: "sparkles",       title: "Build personal brand",   sub: "Show up as myself, consistently." },
  { key: "hiring",      icon: "briefcase",      title: "Hiring & opportunities", sub: "Attract talent or roles." },
  { key: "community",   icon: "message-circle", title: "Build community",        sub: "Conversation, not broadcast." },
];

export const GOALS_WRITER = [
  { key: "volume",      icon: "layers",         title: "Scale output",     sub: "Serve more clients without burning out." },
  { key: "quality",     icon: "sparkles",       title: "Sharper drafts",   sub: "Client-ready first drafts, faster." },
  { key: "consistency", icon: "calendar-check", title: "Hit schedules",    sub: "Never miss a client's posting day." },
  { key: "handoff",     icon: "send",           title: "Cleaner handoff",  sub: "Drafts clients actually approve." },
  { key: "voice",       icon: "mic",            title: "Match each voice", sub: "Adapt tone per client." },
  { key: "reporting",   icon: "bar-chart-3",    title: "Client reporting", sub: "Show results per account." },
];

export const GOALS_BY_PERSONA: Record<string, typeof GOALS_CREATOR | typeof GOALS_WRITER> = {
  creator: GOALS_CREATOR,
  writer: GOALS_WRITER,
};

export const CADENCE_OPTIONS = [
  { key: "2", days: 2, title: "2× a week",  sub: "Easy to sustain — a good starting rhythm." },
  { key: "3", days: 3, title: "3× a week",  sub: "Enough to compound without burnout." },
  { key: "5", days: 5, title: "5× a week",  sub: "Weekday rhythm — recommended for growth." },
  { key: "7", days: 7, title: "Every day",  sub: "Maximum momentum. We'll help with drafts." },
];

export const TOPIC_OPTIONS = [
  "Product", "Design", "Engineering", "Leadership", "AI & ML",
  "Startups", "Marketing", "Sales", "SaaS", "Career growth",
  "Hiring", "Remote work", "Productivity", "Finance", "Data",
  "No-code", "Creator economy", "Climate", "Healthcare", "Web3",
];

// ── Shared update type ──
type UpdateFn = (patch: Partial<OnboardingData>) => void;

// ── Step 1: Persona ──
interface StepPersonaProps { data: OnboardingData; update: UpdateFn; }
export function StepPersona({ data, update }: StepPersonaProps) {
  return (
    <>
      <div className="ob-step-head">
        <div className="ob-eyebrow">Welcome to Marquill</div>
        <h1 className="ob-title">Who are we setting up?</h1>
        <p className="ob-sub">Marquill works for solo creators and agency writers. We&apos;ll tailor the rest.</p>
      </div>
      <div className="tile-list">
        {PERSONA_OPTIONS.map(o => (
          <RadioTile
            key={o.key}
            icon={o.icon}
            title={o.title}
            sub={o.sub}
            selected={data.persona === o.key}
            onClick={() => update({ persona: o.key, goals: [] })}
          />
        ))}
      </div>
    </>
  );
}

// ── Step 2: Profile (branches by persona) ──
interface StepProfileProps { data: OnboardingData; update: UpdateFn; }
export function StepProfile({ data, update }: StepProfileProps) {
  if (data.persona === "writer") {
    return (
      <>
        <div className="ob-step-head">
          <div className="ob-eyebrow">Your practice</div>
          <h1 className="ob-title">Tell us about your roster</h1>
          <p className="ob-sub">We&apos;ll set you up with per-client workspaces so voices don&apos;t bleed together.</p>
        </div>
        <label className="ob-field-label" htmlFor="firstName">Your name</label>
        <div className="ob-input">
          <span className="ic"><User size={16} /></span>
          <input
            id="firstName"
            placeholder="First name"
            value={data.firstName}
            onChange={e => update({ firstName: e.target.value })}
          />
        </div>
        <div style={{ height: 14 }} />
        <label className="ob-field-label" htmlFor="agency">
          Agency or brand name <span>(optional)</span>
        </label>
        <div className="ob-input">
          <span className="ic"><Briefcase size={16} /></span>
          <input
            id="agency"
            placeholder="e.g. Blackletter Studio"
            value={data.agencyName}
            onChange={e => update({ agencyName: e.target.value })}
          />
        </div>
        <div style={{ height: 18 }} />
        <label className="ob-field-label">How many clients are you writing for?</label>
        <div className="tile-list">
          {CLIENT_COUNT_OPTIONS.map(o => (
            <RadioTile
              key={o.key}
              icon="users"
              title={o.title}
              sub={o.sub}
              selected={data.clientCount === o.key}
              onClick={() => update({ clientCount: o.key as OnboardingData["clientCount"] })}
            />
          ))}
        </div>
      </>
    );
  }

  // Default: creator
  return (
    <>
      <div className="ob-step-head">
        <div className="ob-eyebrow">Your profile</div>
        <h1 className="ob-title">Let&apos;s set up your creator profile</h1>
        <p className="ob-sub">A few quick questions so your drafts sound like you — not a generic AI.</p>
      </div>
      <label className="ob-field-label" htmlFor="firstName">What should we call you?</label>
      <div className="ob-input">
        <span className="ic"><User size={16} /></span>
        <input
          id="firstName"
          placeholder="First name"
          value={data.firstName}
          onChange={e => update({ firstName: e.target.value })}
        />
      </div>
      <div style={{ height: 18 }} />
      <label className="ob-field-label">How would you describe yourself on LinkedIn today?</label>
      <div className="tile-list">
        {EXPERIENCE_OPTIONS.map(o => (
          <RadioTile
            key={o.key}
            icon={o.icon}
            title={o.title}
            sub={o.sub}
            selected={data.experience === o.key}
            onClick={() => update({ experience: o.key })}
          />
        ))}
      </div>
    </>
  );
}

// ── Step 3: Goals (persona-aware, multi-select) ──
interface StepGoalsProps { data: OnboardingData; update: UpdateFn; }
export function StepGoals({ data, update }: StepGoalsProps) {
  const opts = GOALS_BY_PERSONA[data.persona] ?? GOALS_CREATOR;
  const toggle = (key: string) => {
    const set = new Set(data.goals);
    if (set.has(key)) set.delete(key); else set.add(key);
    update({ goals: [...set] });
  };
  const titleCopy: Record<string, string> = {
    creator: "What do you want LinkedIn to do for you?",
    writer:  "What are your clients hiring you for?",
  };
  const subCopy: Record<string, string> = {
    creator: "Pick up to three. We'll shape your drafts around these outcomes.",
    writer:  "Pick the outcomes you're delivering. We'll prioritize these across client workspaces.",
  };
  return (
    <>
      <div className="ob-step-head">
        <div className="ob-eyebrow">Your goals</div>
        <h1 className="ob-title">{titleCopy[data.persona] ?? titleCopy.creator}</h1>
        <p className="ob-sub">{subCopy[data.persona] ?? subCopy.creator}</p>
      </div>
      <div className="goal-grid">
        {opts.map(o => (
          <GoalTile
            key={o.key}
            icon={o.icon}
            title={o.title}
            sub={o.sub}
            selected={data.goals.includes(o.key)}
            onClick={() => toggle(o.key)}
          />
        ))}
      </div>
      <p className="ob-sub" style={{ marginTop: 14, fontSize: 12 }}>
        {data.goals.length === 0
          ? "Pick at least one to continue."
          : `${data.goals.length} selected${data.goals.length > 3 ? " — we'll focus on your top three" : ""}.`}
      </p>
    </>
  );
}

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const DAY_KEYS = [DayOfWeek.MON, DayOfWeek.TUE, DayOfWeek.WED, DayOfWeek.THU, DayOfWeek.FRI, DayOfWeek.SAT, DayOfWeek.SUN] as const;

// ── Step 4: Cadence ──
interface StepCadenceProps { data: OnboardingData; update: UpdateFn; }
export function StepCadence({ data, update }: StepCadenceProps) {
  const titleCopy: Record<string, string> = {
    creator: "How often do you want to post?",
    writer:  "What's your typical posting cadence per client?",
  };

  const toggleDay = (day: DayOfWeek) => {
    const set = new Set(data.postingDays);
    if (set.has(day)) set.delete(day); else set.add(day);
    update({ postingDays: [...set] as DayOfWeek[] });
  };

  const n = data.postingDays.length;

  return (
    <>
      <div className="ob-step-head">
        <div className="ob-eyebrow">Posting cadence</div>
        <h1 className="ob-title">{titleCopy[data.persona] ?? titleCopy.creator}</h1>
        <p className="ob-sub">Consistency beats volume. Start somewhere you can keep up — you can adjust later.</p>
      </div>
      <div className="tile-list">
        {CADENCE_OPTIONS.map(o => (
          <RadioTile
            key={o.key}
            icon="calendar-clock"
            title={o.title}
            sub={o.sub}
            selected={data.cadence === o.key}
            onClick={() => update({ cadence: o.key as OnboardingData["cadence"], postingDays: CADENCE_DEFAULTS[o.key] })}
          />
        ))}
      </div>
      <div className="cadence-visual" role="group" aria-label="Select posting days">
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            type="button"
            className={`day${data.postingDays.includes(DAY_KEYS[i]) ? " on" : ""}`}
            onClick={() => toggleDay(DAY_KEYS[i])}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="ob-sub" style={{ marginTop: 8, fontSize: 12 }}>
        {n === 0 ? "Pick at least one day to continue." : `${n} day${n === 1 ? "" : "s"} selected.`}
      </p>
    </>
  );
}

// ── Step 5: Topics ──
interface StepTopicsProps { data: OnboardingData; update: UpdateFn; }
export function StepTopics({ data, update }: StepTopicsProps) {
  const toggle = (t: string) => {
    const set = new Set(data.topics);
    if (set.has(t)) set.delete(t); else set.add(t);
    update({ topics: [...set] });
  };
  const titleCopy: Record<string, string> = {
    creator: "What do you want to post about?",
    writer:  "What topics do your clients cover?",
  };
  const subCopy: Record<string, string> = {
    creator: "Pick the topics you know best. We'll surface research and draft ideas in these areas.",
    writer:  "Pick all that apply across your clients — you can refine per workspace later.",
  };
  return (
    <>
      <div className="ob-step-head">
        <div className="ob-eyebrow">Your topics</div>
        <h1 className="ob-title">{titleCopy[data.persona] ?? titleCopy.creator}</h1>
        <p className="ob-sub">{subCopy[data.persona] ?? subCopy.creator}</p>
      </div>
      <div className="chip-grid">
        {TOPIC_OPTIONS.map(t => (
          <Chip key={t} label={t} selected={data.topics.includes(t)} onClick={() => toggle(t)} />
        ))}
      </div>
      <p className="ob-sub" style={{ marginTop: 14, fontSize: 12 }}>
        {data.topics.length === 0
          ? "Pick at least two topics to continue."
          : `${data.topics.length} topic${data.topics.length === 1 ? "" : "s"} selected.`}
      </p>
    </>
  );
}

// ── Step 6: Connect LinkedIn ──
interface StepConnectProps { data: OnboardingData; update: UpdateFn; }
export function StepConnect({ data, update }: StepConnectProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const popupWatcherRef = useRef<number | null>(null);
  const isWriter = data.persona === "writer";

  // Check if a personal LinkedIn account is already connected
  useEffect(() => {
    fetch(`${API}/auth/connected-accounts`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(payload => {
        const accounts: Array<{ provider: string; accountType: string }> = payload?.data ?? [];
        const hasPersonal = accounts.some(
          a => a.provider === "LINKEDIN" && a.accountType !== "ORGANIZATION"
        );
        if (hasPersonal) update({ connected: true });
      })
      .catch(() => {});

    return () => {
      if (popupWatcherRef.current !== null) window.clearInterval(popupWatcherRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCenteredPopup = () => {
    const w = 560, h = 700;
    const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - w) / 2));
    const top  = Math.max(0, Math.floor(window.screenY + (window.outerHeight - h) / 2));
    return window.open("", "marquill-linkedin-auth", `width=${w},height=${h},left=${left},top=${top},popup=yes,resizable=yes,scrollbars=yes`);
  };

  const handleConnect = async () => {
    if (isConnecting || data.connected) return;
    setConnectError(null);

    const popup = openCenteredPopup();
    if (!popup) {
      setConnectError("Popup was blocked. Please allow popups and try again.");
      return;
    }

    setIsConnecting(true);
    try {
      const res = await fetch(`${API}/auth/linkedin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message || "Unable to start connection.");
      const authUrl = payload?.data;
      if (!authUrl) throw new Error("Unable to start connection.");

      popup.location.href = authUrl;

      if (popupWatcherRef.current !== null) window.clearInterval(popupWatcherRef.current);

      popupWatcherRef.current = window.setInterval(async () => {
        if (popup.closed) {
          if (popupWatcherRef.current !== null) {
            window.clearInterval(popupWatcherRef.current);
            popupWatcherRef.current = null;
          }
          setIsConnecting(false);
          // Verify connection after popup closes
          try {
            const accountsRes = await fetch(`${API}/auth/connected-accounts`, { credentials: "include" });
            if (accountsRes.ok) {
              const accountsPayload = await accountsRes.json();
              const accounts: Array<{ provider: string; accountType: string }> = accountsPayload?.data ?? [];
              const hasPersonal = accounts.some(
                a => a.provider === "LINKEDIN" && a.accountType !== "ORGANIZATION"
              );
              if (hasPersonal) update({ connected: true });
              else setConnectError("Connection could not be verified. Please try again.");
            }
          } catch {
            setConnectError("Connection could not be verified. Please try again.");
          }
        }
      }, 500) as unknown as number;
    } catch (error) {
      if (!popup.closed) popup.close();
      setIsConnecting(false);
      setConnectError(error instanceof Error ? error.message : "Something went wrong.");
    }
  };

  const titleCopy: Record<string, string> = {
    creator: "Connect your LinkedIn",
    writer:  "Connect your first client account",
  };
  const subCopy: Record<string, string> = {
    creator: "We'll publish and schedule on your behalf. You can disconnect any time.",
    writer:  "Connect one now to get started — you can add the rest of your roster from the dashboard.",
  };
  const ctaCopy: Record<string, string> = {
    creator: data.connected ? "LinkedIn connected"     : isConnecting ? "Connecting…" : "Continue with LinkedIn",
    writer:  data.connected ? "First client connected" : isConnecting ? "Connecting…" : "Connect first client",
  };
  const subLine: Record<string, string> = {
    creator: data.connected ? "Personal profile connected" : "Secure OAuth — only the scopes needed to post.",
    writer:  data.connected ? "Client #1 · Personal profile" : "OAuth. You'll authorize one client at a time.",
  };

  return (
    <>
      <div className="ob-step-head">
        <div className="ob-eyebrow">One last thing</div>
        <h1 className="ob-title">{titleCopy[data.persona] ?? titleCopy.creator}</h1>
        <p className="ob-sub">{subCopy[data.persona] ?? subCopy.creator}</p>
      </div>

      <button
        type="button"
        className="connect-card"
        style={{
          borderColor: data.connected ? "var(--color-primary)" : "var(--color-border)",
          boxShadow: data.connected ? "0 0 0 4px rgba(91,92,246,0.10)" : "none",
          opacity: isConnecting ? 0.7 : 1,
          cursor: data.connected || isConnecting ? "default" : "pointer",
        }}
        onClick={handleConnect}
        disabled={data.connected || isConnecting}
      >
        <span className="ln-ic">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/LinkedIn_Icon_1.webp" alt="LinkedIn" />
        </span>
        <span className="c-body">
          <span className="c-title">{ctaCopy[data.persona] ?? ctaCopy.creator}</span>
          <span className="c-sub">{subLine[data.persona] ?? subLine.creator}</span>
        </span>
        {data.connected
          ? <CheckCircle2 size={22} color="#5B5CF6" />
          : <ArrowRight size={18} />}
      </button>

      {connectError && (
        <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "8px 0 0" }}>
          {connectError}
        </p>
      )}

      {isWriter && data.connected && (
        <div className="multi-hint">
          <PlusCircle size={16} color="#5B5CF6" />
          <span>Add more clients from the dashboard — each gets its own workspace, voice, and schedule.</span>
        </div>
      )}

      <div className="assurances">
        <div className="assurance">
          <span className="ic"><ShieldCheck size={13} /></span>
          <span>We never auto-post. Every draft waits for {isWriter ? "approval from the account owner" : "your approval"}.</span>
        </div>
        <div className="assurance">
          <span className="ic"><EyeOff size={13} /></span>
          <span>{isWriter ? "Each workspace is isolated — voices and data don't cross over." : "Your content and data are yours. We don't share or sell anything."}</span>
        </div>
        <div className="assurance">
          <span className="ic"><Settings2 size={13} /></span>
          <span>Disconnect any account any time from Settings — scheduled posts will pause.</span>
        </div>
      </div>
    </>
  );
}
