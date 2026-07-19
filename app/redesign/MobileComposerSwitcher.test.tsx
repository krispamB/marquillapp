import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import MobileComposerSwitcher, { type MobileComposerView } from "./MobileComposerSwitcher";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function SwitcherHarness() {
  const [view, setView] = useState<MobileComposerView>("compose");
  return <MobileComposerSwitcher value={view} onChange={setView} />;
}

describe("MobileComposerSwitcher", () => {
  test("switches between artifact and media inputs and the LinkedIn preview", () => {
    const view = render(<SwitcherHarness />);
    const composeTab = view.getByRole("tab", { name: "Artifact & media" });
    const previewTab = view.getByRole("tab", { name: "LinkedIn preview" });

    expect(composeTab.getAttribute("aria-selected")).toBe("true");
    expect(previewTab.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(previewTab);

    expect(composeTab.getAttribute("aria-selected")).toBe("false");
    expect(previewTab.getAttribute("aria-selected")).toBe("true");
  });
});
