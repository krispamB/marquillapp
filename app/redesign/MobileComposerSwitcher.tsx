"use client";

export type MobileComposerView = "compose" | "preview";

export default function MobileComposerSwitcher({
  value,
  onChange,
}: {
  value: MobileComposerView;
  onChange: (value: MobileComposerView) => void;
}) {
  return (
    <div className="mq-mobile-composer-switcher mq-segmented" role="tablist" aria-label="Post composer view">
      <button
        type="button"
        id="mq-mobile-compose-tab"
        role="tab"
        aria-controls="mq-mobile-compose-panel"
        aria-selected={value === "compose"}
        className={value === "compose" ? "is-active" : ""}
        onClick={() => onChange("compose")}
      >
        Artifact &amp; media
      </button>
      <button
        type="button"
        id="mq-mobile-preview-tab"
        role="tab"
        aria-controls="mq-mobile-preview-panel"
        aria-selected={value === "preview"}
        className={value === "preview" ? "is-active" : ""}
        onClick={() => onChange("preview")}
      >
        LinkedIn preview
      </button>
    </div>
  );
}
