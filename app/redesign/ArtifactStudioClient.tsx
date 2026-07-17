"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  BarChart3,
  FileText,
  GalleryHorizontal,
  LoaderCircle,
  Palette,
  PenLine,
  Search,
  X,
} from "lucide-react";
import MarquillLockup from "../../components/brand/MarquillLockup";
import MarquillSelect from "../../components/ui/MarquillSelect";
import { StylePreset } from "../lib/types";
import { FeatureLimitExceededError } from "../lib/types";
import type {
  ConnectedAccount,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";
import type { ArtifactType, CreateArtifactResponse } from "./artifactTypes";
import { readArtifactPrompt, storeArtifactPrompt } from "./artifactStudioStorage";
import { API_BASE, jsonRequest, readApi } from "./api";
import RedesignShell from "./Shell";

type CarouselTheme = "bold" | "minimal" | "editorial" | "gradient";

const artifactOptions: Array<{
  type: ArtifactType;
  label: string;
  description: string;
  Icon: typeof FileText;
}> = [
  { type: "POST", label: "Post", description: "Write a LinkedIn post", Icon: FileText },
  { type: "POLL", label: "Poll", description: "Start a conversation", Icon: BarChart3 },
  { type: "DOCUMENT", label: "Carousel", description: "Build a swipeable story", Icon: GalleryHorizontal },
];

const styleOptions = [
  { value: StylePreset.PROFESSIONAL, label: "Professional" },
  { value: StylePreset.STORYTELLING, label: "Storytelling" },
  { value: StylePreset.EDUCATIONAL, label: "Educational" },
  { value: StylePreset.BOLD, label: "Bold" },
  { value: StylePreset.CONTRARIAN, label: "Contrarian" },
  { value: StylePreset.FOUNDER, label: "Founder" },
];

const themeOptions: Array<{ value: CarouselTheme; label: string }> = [
  { value: "bold", label: "Bold" },
  { value: "minimal", label: "Minimal" },
  { value: "editorial", label: "Editorial" },
  { value: "gradient", label: "Gradient" },
];

export default function ArtifactStudioClient({
  user,
  connectedAccounts,
  primaryAccountId,
  subscription,
  initialType,
  restoreKey,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
  initialType?: ArtifactType;
  restoreKey?: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<ArtifactType | undefined>(initialType);
  const [prompt, setPrompt] = useState("");
  const [withResearch, setWithResearch] = useState(false);
  const [stylePreset, setStylePreset] = useState<StylePreset>(StylePreset.PROFESSIONAL);
  const [theme, setTheme] = useState<CarouselTheme>("minimal");
  const [isCreating, setIsCreating] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const isReady = Boolean(type && prompt.trim());
  const selectedArtifact = artifactOptions.find((option) => option.type === type);

  useEffect(() => {
    if (!restoreKey) return;
    const restoredPrompt = readArtifactPrompt(restoreKey);
    if (restoredPrompt) setPrompt(restoredPrompt.slice(0, 2000));
  }, [restoreKey]);

  async function createArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!type || !trimmedPrompt || isCreating) return;

    setCreationError(null);
    setIsCreating(true);
    try {
      const response = await readApi<CreateArtifactResponse>(
        `${API_BASE}/artifacts`,
        jsonRequest({
          type,
          prompt: trimmedPrompt,
          withResearch,
          ...(type === "POST" ? { stylePreset } : {}),
          ...(type === "DOCUMENT" ? { theme } : {}),
        }, { method: "POST" }),
      );
      if (!response?.artifactId || !response.runId) {
        throw new Error("The artifact run could not be started.");
      }
      storeArtifactPrompt(response.artifactId, trimmedPrompt);
      router.push(`/artifacts/${encodeURIComponent(response.artifactId)}?run=${encodeURIComponent(response.runId)}`);
    } catch (reason) {
      setCreationError(
        reason instanceof FeatureLimitExceededError
          ? reason.upgradeHint
          : reason instanceof Error
            ? reason.message
            : "The artifact run could not be started.",
      );
      setIsCreating(false);
    }
  }

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={primaryAccountId}
      subscription={subscription}
      active="artifacts"
      title="Artifact Studio"
      showAccountSelector={false}
    >
      <section className="mq-artifact-studio" aria-labelledby="mq-artifact-studio-title">
        <div className="mq-artifact-studio-hero">
          <MarquillLockup size={52} theme="auto" className="mq-artifact-studio-logo" />
          <div className="mq-artifact-studio-heading">
            <span className="mq-eyebrow">The Artifact Studio</span>
            <h1 id="mq-artifact-studio-title">What will we make today?</h1>
          </div>

          <form className="mq-artifact-studio-form" onSubmit={createArtifact}>
            <div className="mq-artifact-prompt-card">
              <label htmlFor="artifact-prompt" className="sr-only">Describe the artifact you want to create</label>
              <textarea
                id="artifact-prompt"
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  if (creationError) setCreationError(null);
                }}
                placeholder="Ask Mark to create something worth sharing..."
                maxLength={2000}
                rows={4}
              />

              <div className="mq-artifact-prompt-footer">
                <button
                  type="button"
                  role="switch"
                  aria-checked={withResearch}
                  className={`mq-artifact-research-toggle${withResearch ? " is-active" : ""}`}
                  onClick={() => setWithResearch((current) => !current)}
                >
                  <span className="mq-artifact-switch" aria-hidden="true"><i /></span>
                  <Search size={14} />
                  Research
                </button>

                <div className="mq-artifact-prompt-controls">
                  {type === "DOCUMENT" ? (
                    <label className="mq-artifact-studio-select">
                      <Palette size={14} />
                      <span className="sr-only">Carousel theme</span>
                      <MarquillSelect
                        value={theme}
                        onChange={(value) => setTheme(value as CarouselTheme)}
                        options={themeOptions}
                        ariaLabel="Carousel theme"
                      />
                    </label>
                  ) : null}

                  {type === "POST" ? (
                    <label className="mq-artifact-studio-select">
                      <PenLine size={14} />
                      <span className="sr-only">Writing style</span>
                      <MarquillSelect
                        value={stylePreset}
                        onChange={(value) => setStylePreset(value as StylePreset)}
                        options={styleOptions}
                        ariaLabel="Writing style"
                      />
                    </label>
                  ) : null}

                  <button
                    type="submit"
                    className={`mq-artifact-submit${isReady ? " is-ready" : ""}${isCreating ? " is-loading" : ""}`}
                    disabled={!isReady || isCreating}
                    aria-label="Create artifact"
                    title={isReady ? "Create artifact" : "Choose a format and describe your idea"}
                  >
                    {isCreating ? <LoaderCircle size={18} /> : <ArrowUp size={18} />}
                  </button>
                </div>
              </div>
            </div>

            <fieldset className={`mq-artifact-type-options${selectedArtifact ? " is-collapsed" : ""}`}>
              <legend className="sr-only">Choose one artifact type</legend>
              {selectedArtifact ? (
                <button
                  type="button"
                  className="mq-artifact-type-selection"
                  onClick={() => setType(undefined)}
                  aria-label={`Cancel ${selectedArtifact.label} selection`}
                  title={`Cancel ${selectedArtifact.label} selection`}
                >
                  <span className="mq-artifact-selection-icon" aria-hidden="true">
                    <selectedArtifact.Icon className="mq-artifact-selection-type-icon" size={16} />
                    <X className="mq-artifact-selection-cancel-icon" size={14} />
                  </span>
                  <strong>{selectedArtifact.label}</strong>
                </button>
              ) : (
                artifactOptions.map(({ type: optionType, label, description, Icon }) => (
                  <button
                    key={optionType}
                    type="button"
                    aria-pressed="false"
                    onClick={() => setType(optionType)}
                  >
                    <Icon size={16} />
                    <span><strong>{label}</strong><small>{description}</small></span>
                  </button>
                ))
              )}
            </fieldset>

            {creationError ? (
              <div className="mq-artifact-create-error" role="alert">{creationError}</div>
            ) : null}
          </form>

          <p className="mq-artifact-studio-note">
            Choose one format, describe the idea, and Mark will shape the first draft.
          </p>
        </div>
      </section>
    </RedesignShell>
  );
}
