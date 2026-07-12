"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import "./onboarding.css";
import { revalidateUserCache } from "../lib/actions";
import { Progress, SuccessToast } from "./components";
import MarquillLockup from "../../components/brand/MarquillLockup";
import ThemeToggle from "../redesign/ThemeToggle";
import {
  StepPersona,
  StepProfile,
  StepGoals,
  StepCadence,
  StepTopics,
  StepConnect,
} from "./steps";
import {
  UserType,
  CreatorLevel,
  Goal,
  PostingFrequency,
  DayOfWeek,
} from "./types";

const TOTAL_STEPS = 6;
const API = process.env.NEXT_PUBLIC_API_BASE_URL;

// ── Value maps: UI keys → server enum values ──

const EXPERIENCE_MAP: Record<string, CreatorLevel> = {
  new: CreatorLevel.GETTING_STARTED,
  building: CreatorLevel.BUILDING_MOMENTUM,
  seasoned: CreatorLevel.SEASONED,
};

const CADENCE_MAP: Record<string, PostingFrequency> = {
  "2": PostingFrequency.TWO_PER_WEEK,
  "3": PostingFrequency.THREE_PER_WEEK,
  "5": PostingFrequency.FIVE_PER_WEEK,
  "7": PostingFrequency.EVERY_DAY,
};

const GOAL_MAP: Record<string, Goal> = {
  // Creator goals
  followers: Goal.GROW_AUDIENCE,
  leadership: Goal.THOUGHT_LEADERSHIP,
  leads: Goal.GENERATE_LEADS,
  brand: Goal.PERSONAL_BRAND,
  hiring: Goal.HIRING,
  community: Goal.BUILD_COMMUNITY,
  // Writer goals
  volume: Goal.SCALE_OUTPUT,
  quality: Goal.SHARPER_DRAFTS,
  consistency: Goal.HIT_SCHEDULES,
  handoff: Goal.CLEANER_HANDOFF,
  voice: Goal.MATCH_EACH_VOICE,
  reporting: Goal.CLIENT_REPORTING,
};

export const CADENCE_DEFAULTS: Record<string, DayOfWeek[]> = {
  "2": [DayOfWeek.MON, DayOfWeek.THU],
  "3": [DayOfWeek.MON, DayOfWeek.WED, DayOfWeek.FRI],
  "5": [DayOfWeek.MON, DayOfWeek.TUE, DayOfWeek.WED, DayOfWeek.THU, DayOfWeek.FRI],
  "7": [DayOfWeek.MON, DayOfWeek.TUE, DayOfWeek.WED, DayOfWeek.THU, DayOfWeek.FRI, DayOfWeek.SAT, DayOfWeek.SUN],
};

// ── Data shape ──

export interface OnboardingData {
  persona: "creator" | "writer" | "";
  firstName: string;
  experience: "new" | "building" | "seasoned" | "";
  clientCount: "1-2" | "3-5" | "6-10" | "10+" | "";
  agencyName: string;
  goals: string[];
  cadence: "2" | "3" | "5" | "7";
  postingDays: DayOfWeek[];
  topics: string[];
  connected: boolean;
}

const INITIAL_DATA: OnboardingData = {
  persona: "",
  firstName: "",
  experience: "",
  clientCount: "",
  agencyName: "",
  goals: [],
  cadence: "5",
  postingDays: CADENCE_DEFAULTS["5"],
  topics: [],
  connected: false,
};

// ── Validation ──

function canAdvance(step: number, data: OnboardingData): boolean {
  if (step === 1) return true;
  if (step === 2) return !!data.persona;
  if (step === 3) {
    if (!data.firstName.trim()) return false;
    if (data.persona === "creator") return !!data.experience;
    if (data.persona === "writer") return data.clientCount !== "";
    return false;
  }
  if (step === 4) return data.goals.length > 0;
  if (step === 5) return !!data.cadence && data.postingDays.length > 0;
  if (step === 6) return data.topics.length >= 2;
  return false;
}

// ── API calls ──

async function callStepApi(step: number, data: OnboardingData): Promise<void> {
  if (step === 1) return; // LinkedIn connection is handled by its own OAuth flow
  const apiStep = step - 1;

  const isPost = apiStep === 1;
  const method = isPost ? "POST" : "PATCH";

  let body: Record<string, unknown>;

  if (apiStep === 1) {
    body = {
      userType: data.persona === "creator" ? UserType.CREATOR : UserType.PRO_WRITER,
    };
  } else if (apiStep === 2 && data.persona === "creator") {
    body = {
      step: 2,
      name: data.firstName,
      creatorLevel: EXPERIENCE_MAP[data.experience],
    };
  } else if (apiStep === 2 && data.persona === "writer") {
    body = {
      step: 2,
      name: data.firstName,
      ...(data.agencyName.trim() && { agencyName: data.agencyName.trim() }),
      numberOfClients: data.clientCount,
    };
  } else if (apiStep === 3) {
    body = {
      step: 3,
      goals: data.goals.map(k => GOAL_MAP[k]).filter(Boolean),
    };
  } else if (apiStep === 4) {
    body = {
      step: 4,
      postingFrequency: CADENCE_MAP[data.cadence],
      postingDays: data.postingDays,
    };
  } else if (apiStep === 5) {
    body = {
      step: 5,
      topics: data.topics,
    };
  } else {
    return;
  }

  const res = await apiFetch(`${API}/onboarding`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(await res.text());
}

// ── Restore server session into local state ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function restoreData(serverData: Record<string, any>): Partial<OnboardingData> {
  if (!serverData) return {};
  const cadence = (Object.entries(CADENCE_MAP).find(([, v]) => v === serverData.postingFrequency)?.[0] ?? "5") as OnboardingData["cadence"];
  const experience = (Object.entries(EXPERIENCE_MAP).find(([, v]) => v === serverData.creatorLevel)?.[0] ?? "") as OnboardingData["experience"];
  const goalReverseMap = Object.fromEntries(Object.entries(GOAL_MAP).map(([k, v]) => [v, k]));

  return {
    persona: serverData.userType === UserType.PRO_WRITER ? "writer" : serverData.userType === UserType.CREATOR ? "creator" : "",
    firstName: serverData.name ?? "",
    experience,
    clientCount: (serverData.numberOfClients ?? "") as OnboardingData["clientCount"],
    agencyName: serverData.agencyName ?? "",
    goals: (serverData.goals ?? serverData.clientGoal ?? []).map((g: string) => goalReverseMap[g]).filter(Boolean),
    cadence,
    postingDays: serverData.postingDays ?? CADENCE_DEFAULTS[cadence],
    topics: serverData.topics ?? [],
  };
}

// ── Component ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OnboardingSession = { userType?: string; currentStep?: number; isComplete?: boolean; data?: Record<string, any> };

export default function OnboardingClient({ initialSession }: { initialSession: OnboardingSession | null }) {
  const router = useRouter();
  const [data, setData] = useState<OnboardingData>(() => {
    if (!initialSession) return INITIAL_DATA;
    const serverPayload = { userType: initialSession.userType, ...(initialSession.data ?? {}) };
    return { ...INITIAL_DATA, ...restoreData(serverPayload) };
  });
  const [step, setStep] = useState(() => {
    if (!initialSession?.userType) return 1;
    return Math.min((initialSession.currentStep ?? 1) + 1, TOTAL_STEPS);
  });
  const [toast, setToast] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const update = (patch: Partial<OnboardingData>) =>
    setData(d => ({ ...d, ...patch }));

  const advance = async () => {
    setIsLoading(true);
    setApiError(null);
    try {
      await callStepApi(step, data);
      if (step < TOTAL_STEPS) setStep(s => s + 1);
      else finish();
    } catch {
      setApiError("Something went wrong — please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const back = () => {
    if (step > 1) setStep(s => s - 1);
  };

  const skip = () => {
    setStep(2);
  };

  const finish = () => {
    setToast(true);
    // Bust the cached (empty) profile so the dashboard sees the completed one
    // instead of redirecting back here.
    void revalidateUserCache();
    setTimeout(() => {
      router.push("/dashboard");
    }, 4000);
  };

  const primaryLabel = () => {
    if (step < TOTAL_STEPS) return isLoading ? "Saving…" : "Continue";
    return isLoading ? "Saving…" : "Enter Marquill";
  };

  return (
    <>
      <div className="ob-page">
        <ThemeToggle compact className="ob-theme-toggle" />
        <div className="ob-frame">
          <aside className="ob-rail">
            <MarquillLockup size={30} theme="auto" />
            <div className="ob-rail-intro">
              <h2>Let&apos;s get Mark<br />working for you.</h2>
              <p>A few quick steps and Mark starts drafting, designing, and scheduling in your voice.</p>
            </div>
            <div className="ob-rail-steps">
              <div className="is-done"><span><Check size={15} /></span><div><b>Sign up with Google</b><small>Your Marquill account is ready</small></div></div>
              <div className={step > 1 ? "is-done" : "is-current"}><span>{step > 1 ? <Check size={15} /> : "2"}</span><div><b>Connect LinkedIn</b><small>Personal profile or company page</small></div></div>
              <div className={step > 1 ? "is-current" : ""}><span>3</span><div><b>Tell Mark your voice</b><small>Workspace, goals, cadence & topics</small></div></div>
            </div>
            <span className="ob-rail-count">step {step === 1 ? 2 : 3} of 3</span>
          </aside>

          <section className="ob-workspace">
            <div className="ob-mobile-brand"><MarquillLockup size={27} theme="auto" /></div>
            <Progress step={step === 1 ? 2 : 3} total={3} style="steps" />
            <div className="ob-wrap">
              <div className="ob-card">
                {step === 1 && <StepConnect data={data} update={update} />}
                {step === 2 && <StepPersona data={data} update={update} />}
                {step === 3 && <StepProfile data={data} update={update} />}
                {step === 4 && <StepGoals data={data} update={update} />}
                {step === 5 && <StepCadence data={data} update={update} />}
                {step === 6 && <StepTopics data={data} update={update} />}
              </div>

              <div className="ob-actions">
                <div>{step > 1 && <button className="btn ghost" onClick={back} disabled={isLoading}><ArrowLeft size={14} /> Back</button>}</div>
                <div className="ob-actions-right">
                  {step === 1 && !data.connected && <button className="btn ghost" onClick={skip} disabled={isLoading}>Skip for now</button>}
                  <button className="btn primary" disabled={!canAdvance(step, data) || isLoading} onClick={advance}>
                    {primaryLabel()}{!isLoading && <ArrowRight size={15} strokeWidth={2.5} />}
                  </button>
                </div>
              </div>
              {apiError && <p className="ob-error">{apiError}</p>}
            </div>
          </section>
        </div>
      </div>

      {toast && <SuccessToast name={data.firstName} />}
    </>
  );
}
