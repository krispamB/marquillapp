import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { documentArtifactFixture } from "./artifactTestFixtures";

GlobalRegistrator.register();

// The real preview loads its pages through next/dynamic and pdf.js, which a test
// cannot drive reliably; PdfPreviewRenderer.test covers clicking and keyboard
// on the pages. This stand-in keeps the preview's label and its expand surface.
mock.module("../../components/pdf/PdfPreview", () => ({
  default: ({ title, ariaLabel, onExpand }: { title?: string; ariaLabel?: string; onExpand?: () => void }) => (
    <div aria-label={ariaLabel ?? (title ? `${title} PDF preview` : "PDF preview")}>
      {onExpand ? <button type="button" onClick={onExpand}>Expand document, page 1 of 2</button> : null}
    </div>
  ),
}));

const { default: ArtifactResponse, isAttachableArtifact } = await import("./ArtifactResponse");

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

describe("ArtifactResponse expanded document", () => {
  const expandedView = (view: ReturnType<typeof render>) =>
    view.queryByRole("dialog", { name: "Marketing playbook full-screen preview" });

  test("clicking the document opens the full-screen preview", () => {
    const view = render(<ArtifactResponse artifact={documentArtifactFixture({ pdfUrl: "https://files.example/document.pdf" })} />);

    expect(expandedView(view)).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Expand document, page 1 of 2" }));

    expect(expandedView(view)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Close full-screen preview" }));
    expect(expandedView(view)).toBeNull();
  });

  test("the expand button still opens the full-screen preview", () => {
    const view = render(<ArtifactResponse artifact={documentArtifactFixture({ pdfUrl: "https://files.example/document.pdf" })} />);

    fireEvent.click(view.getByRole("button", { name: "Expand carousel preview" }));

    expect(expandedView(view)).toBeTruthy();
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
