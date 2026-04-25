"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import "./onboarding.css";
import { BrandRow, LocalOrbs, Progress, SuccessToast } from "./components";
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
  new:      CreatorLevel.GETTING_STARTED,
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
  followers:  Goal.GROW_AUDIENCE,
  leadership: Goal.THOUGHT_LEADERSHIP,
  leads:      Goal.GENERATE_LEADS,
  brand:      Goal.PERSONAL_BRAND,
  hiring:     Goal.HIRING,
  community:  Goal.BUILD_COMMUNITY,
  // Writer goals
  volume:      Goal.SCALE_OUTPUT,
  quality:     Goal.SHARPER_DRAFTS,
  consistency: Goal.HIT_SCHEDULES,
  handoff:     Goal.CLEANER_HANDOFF,
  voice:       Goal.MATCH_EACH_VOICE,
  reporting:   Goal.CLIENT_REPORTING,
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
  if (step === 1) return !!data.persona;
  if (step === 2) {
    if (!data.firstName.trim()) return false;
    if (data.persona === "creator") return !!data.experience;
    if (data.persona === "writer")  return data.clientCount !== "";
    return false;
  }
  if (step === 3) return data.goals.length > 0;
  if (step === 4) return !!data.cadence && data.postingDays.length > 0;
  if (step === 5) return data.topics.length >= 2;
  if (step === 6) return true;
  return false;
}

// ── API calls ──

async function callStepApi(step: number, data: OnboardingData): Promise<void> {
  if (step === 6) return; // no API for LinkedIn connect

  const isPost = step === 1;
  const method = isPost ? "POST" : "PATCH";

  let body: Record<string, unknown>;

  if (step === 1) {
    body = {
      userType: data.persona === "creator" ? UserType.CREATOR : UserType.PRO_WRITER,
    };
  } else if (step === 2 && data.persona === "creator") {
    body = {
      step: 2,
      name: data.firstName,
      creatorLevel: EXPERIENCE_MAP[data.experience],
    };
  } else if (step === 2 && data.persona === "writer") {
    body = {
      step: 2,
      name: data.firstName,
      ...(data.agencyName.trim() && { agencyName: data.agencyName.trim() }),
      numberOfClients: data.clientCount,
    };
  } else if (step === 3) {
    body = {
      step: 3,
      goals: data.goals.map(k => GOAL_MAP[k]).filter(Boolean),
    };
  } else if (step === 4) {
    body = {
      step: 4,
      postingFrequency: CADENCE_MAP[data.cadence],
      postingDays: data.postingDays,
    };
  } else if (step === 5) {
    body = {
      step: 5,
      topics: data.topics,
    };
  } else {
    return;
  }

  const res = await fetch(`${API}/onboarding`, {
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
    goals: (serverData.goals ?? []).map((g: string) => goalReverseMap[g]).filter(Boolean),
    cadence,
    postingDays: serverData.postingDays ?? CADENCE_DEFAULTS[cadence],
    topics: serverData.topics ?? [],
  };
}

// ── Component ──

export default function OnboardingClient() {
  const router = useRouter();
  const [data, setData] = useState<OnboardingData>(INITIAL_DATA);
  const [step, setStep] = useState(1);
  const [toast, setToast] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const update = (patch: Partial<OnboardingData>) =>
    setData(d => ({ ...d, ...patch }));

  // GET on mount — resume partial session
  useEffect(() => {
    fetch(`${API}/onboarding`, { credentials: "include" })
      .then(res => (res.ok ? res.json() : null))
      .then(session => {
        if (!session) return;
        if (session.isComplete) { router.replace("/dashboard"); return; }
        setData(d => ({ ...d, ...restoreData(session.data ?? {}) }));
        if (session.currentStep) setStep(Math.max(session.currentStep, 2));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    finish();
  };

  const finish = () => {
    localStorage.setItem("marquill_onboarding_complete", "1");
    setToast(true);
    setTimeout(() => {
      router.push("/dashboard");
    }, 4000);
  };

  const primaryLabel = () => {
    if (step < TOTAL_STEPS) return isLoading ? "Saving…" : "Continue";
    if (data.connected) return "Enter Marquill";
    return isLoading ? "Saving…" : "Connect & finish";
  };

  return (
    <>
      <div className="ob-page">
        <LocalOrbs />
        <div className="ob-wrap">
          {/* <BrandRow right={<span>Setup</span>} /> */}
          <Progress step={step} total={TOTAL_STEPS} style="steps" />

          <div className="ob-card">
            {step === 1 && <StepPersona data={data} update={update} />}
            {step === 2 && <StepProfile data={data} update={update} />}
            {step === 3 && <StepGoals   data={data} update={update} />}
            {step === 4 && <StepCadence data={data} update={update} />}
            {step === 5 && <StepTopics  data={data} update={update} />}
            {step === 6 && <StepConnect data={data} update={update} />}
          </div>

          <div className="ob-actions">
            <div>
              {step > 1 && (
                <button className="btn ghost" onClick={back} disabled={isLoading}>
                  <ArrowLeft size={14} /> Back
                </button>
              )}
            </div>
            <div className="ob-actions-right">
              {step === TOTAL_STEPS && !data.connected && (
                <button className="btn ghost" onClick={skip} disabled={isLoading}>
                  Skip for now
                </button>
              )}
              <button
                className="btn primary"
                disabled={!canAdvance(step, data) || isLoading}
                onClick={advance}
              >
                {primaryLabel()}
                {!isLoading && <ArrowRight size={15} strokeWidth={2.5} />}
              </button>
            </div>
          </div>

          {apiError && (
            <p style={{ textAlign: "center", color: "var(--color-danger)", fontSize: 13, margin: 0 }}>
              {apiError}
            </p>
          )}
        </div>
      </div>

      {toast && <SuccessToast name={data.firstName} />}
    </>
  );
}
