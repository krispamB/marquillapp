"use client";

export type ComposerView = "compose" | "preview";

export default function ComposerViewSwitcher({
  value,
  onChange,
}: {
  value: ComposerView;
  onChange: (value: ComposerView) => void;
}) {
  return (
    <div className="mq-composer-switcher mq-segmented" role="tablist" aria-label="Post composer view">
      <button
        type="button"
        id="mq-composer-compose-tab"
        role="tab"
        aria-controls="mq-composer-compose-panel"
        aria-selected={value === "compose"}
        className={value === "compose" ? "is-active" : ""}
        onClick={() => onChange("compose")}
      >
        Artifact &amp; media
      </button>
      <button
        type="button"
        id="mq-composer-preview-tab"
        role="tab"
        aria-controls="mq-composer-preview-panel"
        aria-selected={value === "preview"}
        className={value === "preview" ? "is-active" : ""}
        onClick={() => onChange("preview")}
      >
        LinkedIn preview
      </button>
    </div>
  );
}
