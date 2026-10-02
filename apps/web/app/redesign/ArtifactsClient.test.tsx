import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { ArtifactSummary } from "./artifactTypes";
import { ArtifactCard, versionNote } from "./ArtifactsClient";

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
        isAttachDisabled={false}
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
        isAttachDisabled={false}
        isAttaching={false}
        onAttach={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(view.queryByRole("button", { name: "Attach to post" })).toBeNull();
  });

  test("disables attachment while deletion is active", () => {
    const view = render(
      <ArtifactCard
        artifact={readyArtifact}
        isAttachDisabled
        isAttaching={false}
        onAttach={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(view.getByRole("button", { name: "Attach to post" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("versionNote", () => {
  test("names the Current Version when no Attempt is newer", () => {
    expect(versionNote({ ...readyArtifact, currentVersion: 2 })).toBe("Current v2");
  });

  test("keeps the Current Version beside an in-flight refinement", () => {
    expect(versionNote({
      ...readyArtifact,
      status: "GENERATING",
      currentVersion: 1,
      latestAttempt: { version: 2, status: "GENERATING", runId: "run-2" },
    })).toBe("Current v1 · refining v2");
  });

  test("keeps the Current Version beside a failed refinement", () => {
    expect(versionNote({
      ...readyArtifact,
      currentVersion: 1,
      latestAttempt: { version: 2, status: "FAILED", failureCode: "internal" },
    })).toBe("Current v1 · refinement v2 failed");
  });

  test("falls back to the derived status when there is no Current Version", () => {
    expect(versionNote({
      ...readyArtifact,
      status: "FAILED",
      latestAttempt: { version: 1, status: "FAILED" },
    })).toBe("Needs attention");
  });
});

describe("ArtifactCard version note", () => {
  test("shows a failed refinement while the artifact stays READY and attachable", () => {
    const view = render(
      <ArtifactCard
        artifact={{
          ...readyArtifact,
          currentVersion: 1,
          latestAttempt: { version: 2, status: "FAILED" },
        }}
        isAttachDisabled={false}
        isAttaching={false}
        onAttach={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(view.getByText("Current v1 · refinement v2 failed")).toBeTruthy();
    expect(view.getByRole("button", { name: "Attach to post" })).toBeTruthy();
  });
});
