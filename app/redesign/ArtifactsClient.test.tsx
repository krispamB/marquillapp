import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { ArtifactSummary } from "./artifactTypes";
import { ArtifactCard } from "./ArtifactsClient";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const readyArtifact: ArtifactSummary = {
  id: "artifact-1",
  type: "POST",
  title: "A ready post",
  status: "READY",
};

describe("ArtifactCard attach action", () => {
  test("shows the action for a READY artifact and forwards the artifact", () => {
    let selectedId = "";
    const view = render(
      <ArtifactCard
        artifact={readyArtifact}
        isAttaching={false}
        onAttach={(artifact) => { selectedId = artifact.id; }}
        onDelete={() => {}}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Attach to post" }));

    expect(selectedId).toBe("artifact-1");
  });

  test("does not show the action for a non-READY artifact", () => {
    const view = render(
      <ArtifactCard
        artifact={{ ...readyArtifact, status: "GENERATING" }}
        isAttaching={false}
        onAttach={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(view.queryByRole("button", { name: "Attach to post" })).toBeNull();
  });
});
