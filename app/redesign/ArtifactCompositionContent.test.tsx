import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { ArtifactContentView } from "./ArtifactCompositionContent";
import type { ArtifactDetailData } from "./artifactTypes";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const commentary = "a".repeat(141);

function postArtifact(id = "artifact-1", version = 1): ArtifactDetailData {
  return {
    id,
    type: "POST",
    currentVersion: version,
    version,
    status: "READY",
    content: { commentary },
  };
}

describe("ArtifactContentView", () => {
  test("expands post commentary until the artifact identity or version changes", () => {
    const view = render(<ArtifactContentView artifact={postArtifact()} />);
    const moreButtons = () => view.queryAllByRole("button", { name: "more..." });

    expect(moreButtons()).toHaveLength(1);
    fireEvent.click(moreButtons()[0]);
    expect(moreButtons()).toHaveLength(0);

    view.rerender(<ArtifactContentView artifact={postArtifact()} />);
    expect(moreButtons()).toHaveLength(0);

    view.rerender(<ArtifactContentView artifact={postArtifact("artifact-1", 2)} />);
    expect(moreButtons()).toHaveLength(1);

    fireEvent.click(moreButtons()[0]);
    view.rerender(<ArtifactContentView artifact={postArtifact("artifact-2", 2)} />);
    expect(moreButtons()).toHaveLength(1);
  });
});
