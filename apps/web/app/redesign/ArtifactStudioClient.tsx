"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  BarChart3,
  FileText,
  GalleryHorizontal,
  LoaderCircle,
  LockKeyhole,
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
import type { ArtifactType } from "./artifactTypes";
import {
  readArtifactDesignSystem,
  readArtifactPrompt,
  storeArtifactDesignSystem,
  storeArtifactPrompt,
} from "./artifactStudioStorage";
import { createArtifactBody, createArtifactRequest } from "./artifactRequests";
import DesignSystemMenu from "./DesignSystemMenu";
import { resolveDesignSystemId } from "./designSystems";
import useDesignSystems from "./useDesignSystems";
import RedesignShell from "./Shell";
import { canUseResearch } from "./tier-access";

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
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // Grow the prompt with its text; CSS sets the floor (one line on phones) and the cap.
  useLayoutEffect(() => {
    const field = promptRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [prompt]);
  const [withResearch, setWithResearch] = useState(false);
  const [stylePreset, setStylePreset] = useState<StylePreset>(StylePreset.PROFESSIONAL);
  const [pickedDesignSystemId, setPickedDesignSystemId] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  const researchAvailable = canUseResearch(subscription ?? user.tier);
  const isReady = Boolean(type && prompt.trim());
  const selectedArtifact = artifactOptions.find((option) => option.type === type);
  const designSystems = useDesignSystems(type === "DOCUMENT");
  // A failed or empty list leaves no choice to make: no id is sent and the API uses `margin`.
  const designSystemId = resolveDesignSystemId(designSystems.systems, pickedDesignSystemId);
  const selectedDesignSystem = designSystems.systems.find((system) => system.id === designSystemId);

  useEffect(() => {
    if (!restoreKey) return;
    const restoredPrompt = readArtifactPrompt(restoreKey);
    if (restoredPrompt) setPrompt(restoredPrompt.slice(0, 2000));
    // An id the list no longer offers falls back to the default in resolveDesignSystemId.
    setPickedDesignSystemId(readArtifactDesignSystem(restoreKey));
  }, [restoreKey]);

  async function createArtifact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPrompt = prompt.trim();
    if (!type || !trimmedPrompt || isCreating) return;

    setCreationError(null);
    setIsCreating(true);
    try {
      const response = await createArtifactRequest(createArtifactBody({
        type,
        prompt: trimmedPrompt,
        withResearch: researchAvailable && withResearch,
        stylePreset,
        designSystemId,
      }));
      if (!response?.artifactId || !response.runId) {
        throw new Error("The artifact run could not be started.");
      }
      storeArtifactPrompt(response.artifactId, trimmedPrompt);
      storeArtifactDesignSystem(response.artifactId, type === "DOCUMENT" ? designSystemId : undefined);
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
      topbar={{ credits: {} }}
      showAccountSelector={false}
    >
      <section className="mq-artifact-studio" aria-labelledby="mq-artifact-studio-title">
        <div className="mq-artifact-studio-hero">
          <MarquillLockup size={28} theme="auto" className="mq-artifact-studio-logo" />
          <div className="mq-artifact-studio-heading">
            <span className="mq-eyebrow">The Artifact Studio</span>
            <h1 id="mq-artifact-studio-title">What will we make today?</h1>
          </div>

          <form className="mq-artifact-studio-form" onSubmit={createArtifact}>
            <div className="mq-artifact-prompt-card">
              <label htmlFor="artifact-prompt" className="sr-only">Describe the artifact you want to create</label>
              <textarea
                id="artifact-prompt"
                ref={promptRef}
                value={prompt}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  if (creationError) setCreationError(null);
                }}
                placeholder="Ask Mark to create something worth sharing..."
                maxLength={2000}
                rows={1}
              />

              <div className="mq-artifact-prompt-footer">
                <div className="mq-artifact-prompt-modes">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={withResearch}
                    className={`mq-artifact-research-toggle${withResearch ? " is-active" : ""}${!researchAvailable ? " is-locked" : ""}`}
                    onClick={() => setWithResearch((current) => !current)}
                    disabled={!researchAvailable}
                    title={researchAvailable ? "Add web research" : "Research is available on paid plans"}
                  >
                    <span className="mq-artifact-switch" aria-hidden="true"><i /></span>
                    <Search size={14} />
                    <span className="mq-artifact-research-label">Research</span>
                    {!researchAvailable ? <LockKeyhole size={12} aria-hidden="true" /> : null}
                  </button>

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
                  ) : null}
                </div>

                <div className="mq-artifact-prompt-controls">
                  {type === "DOCUMENT" && designSystems.state.status === "loading" ? (
                    <span className="mq-design-status" role="status">Loading designs…</span>
                  ) : null}
                  {type === "DOCUMENT" && selectedDesignSystem ? (
                    <DesignSystemMenu
                      systems={designSystems.systems}
                      value={selectedDesignSystem.id}
                      onChange={setPickedDesignSystemId}
                      triggerLabel={selectedDesignSystem.name}
                      triggerAriaLabel={`Design: ${selectedDesignSystem.name}`}
                      createOwn
                      align="end"
                      disabled={isCreating}
                    />
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

            {!selectedArtifact ? (
              <fieldset className="mq-artifact-type-options">
                <legend className="sr-only">Choose one artifact type</legend>
                {artifactOptions.map(({ type: optionType, label, description, Icon }) => (
                  <button
                    key={optionType}
                    type="button"
                    aria-pressed="false"
                    onClick={() => setType(optionType)}
                  >
                    <Icon size={16} />
                    <span><strong>{label}</strong><small>{description}</small></span>
                  </button>
                ))}
              </fieldset>
            ) : null}

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
