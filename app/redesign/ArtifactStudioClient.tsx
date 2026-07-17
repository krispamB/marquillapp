"use client";

import { useState } from "react";
import {
  ArrowUp,
  BarChart3,
  FileText,
  GalleryHorizontal,
  Palette,
  Search,
  Sparkles,
} from "lucide-react";
import MarquillLockup from "../../components/brand/MarquillLockup";
import MarquillSelect from "../../components/ui/MarquillSelect";
import { StylePreset } from "../lib/types";
import type {
  ConnectedAccount,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";
import type { ArtifactType } from "./artifactTypes";
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
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
  initialType?: ArtifactType;
}) {
  const [type, setType] = useState<ArtifactType | undefined>(initialType);
  const [prompt, setPrompt] = useState("");
  const [withResearch, setWithResearch] = useState(false);
  const [stylePreset, setStylePreset] = useState<StylePreset>(StylePreset.PROFESSIONAL);
  const [theme, setTheme] = useState<CarouselTheme>("minimal");
  const isReady = Boolean(type && prompt.trim());

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

          <form className="mq-artifact-studio-form" onSubmit={(event) => event.preventDefault()}>
            <div className="mq-artifact-prompt-card">
              <label htmlFor="artifact-prompt" className="sr-only">Describe the artifact you want to create</label>
              <textarea
                id="artifact-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
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

                  <label className="mq-artifact-studio-select">
                    <Sparkles size={14} />
                    <span className="sr-only">Writing style</span>
                    <MarquillSelect
                      value={stylePreset}
                      onChange={(value) => setStylePreset(value as StylePreset)}
                      options={styleOptions}
                      ariaLabel="Writing style"
                    />
                  </label>

                  <button
                    type="submit"
                    className={`mq-artifact-submit${isReady ? " is-ready" : ""}`}
                    disabled
                    aria-label="Create artifact"
                    title="Artifact generation is coming next"
                  >
                    <ArrowUp size={18} />
                  </button>
                </div>
              </div>
            </div>

            <fieldset className="mq-artifact-type-options">
              <legend className="sr-only">Choose one artifact type</legend>
              {artifactOptions.map(({ type: optionType, label, description, Icon }) => {
                const isSelected = type === optionType;
                return (
                  <button
                    key={optionType}
                    type="button"
                    aria-pressed={isSelected}
                    className={isSelected ? "is-selected" : ""}
                    onClick={() => setType(optionType)}
                  >
                    <Icon size={16} />
                    <span><strong>{label}</strong><small>{description}</small></span>
                  </button>
                );
              })}
            </fieldset>
          </form>

          <p className="mq-artifact-studio-note">
            Choose one format, describe the idea, and Mark will shape the first draft.
          </p>
        </div>
      </section>
    </RedesignShell>
  );
}
