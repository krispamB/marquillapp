import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import ArtifactResponse, { isAttachableArtifact } from "./ArtifactResponse";
import { documentArtifactFixture } from "./artifactTestFixtures";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

describe("ArtifactResponse document preview", () => {
  test("renders the shared PDF preview beneath the document metadata", () => {
    const artifact = documentArtifactFixture({
      commentary: "A practical guide for growing a SaaS product.",
      pdfUrl: "https://files.example/document.pdf",
    });
    const view = render(<ArtifactResponse artifact={artifact} />);

    expect(view.getByText("A practical guide for growing a SaaS product.")).toBeTruthy();
    expect(view.getByLabelText("Marketing playbook PDF preview")).toBeTruthy();
  });

  test("shows the unavailable state without mounting the PDF preview", () => {
    const view = render(<ArtifactResponse artifact={documentArtifactFixture()} />);

    expect(view.getByText("PDF link unavailable")).toBeTruthy();
    expect(view.queryByLabelText("Marketing playbook PDF preview")).toBeNull();
  });
});

describe("ArtifactResponse attach action", () => {
  test("renders the full-width action and invokes its callback", () => {
    let attachCount = 0;
    const artifact = documentArtifactFixture();
    const view = render(
      <ArtifactResponse
        artifact={artifact}
        canAttach
        onAttach={() => { attachCount += 1; }}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Attach to post" }));

    expect(attachCount).toBe(1);
  });

  test("only considers the current READY version attachable", () => {
    const current = documentArtifactFixture();
    expect(isAttachableArtifact(current)).toBe(true);
    expect(isAttachableArtifact({ ...current, version: 1, currentVersion: 2 })).toBe(false);
    expect(isAttachableArtifact({ ...current, status: "FAILED" })).toBe(false);
  });
});
