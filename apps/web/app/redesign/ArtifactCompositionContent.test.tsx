import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { documentArtifactFixture } from "./artifactTestFixtures";
import type { ArtifactDetailData } from "./artifactTypes";

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

const {
  default: AttachedArtifactComposition,
  ArtifactContentView,
} = await import("./ArtifactCompositionContent");

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

  test("uses the reusable PDF preview when a document URL is available", () => {
    const view = render(<ArtifactContentView artifact={documentArtifactFixture({ pdfUrl: "https://files.example/document.pdf" })} />);

    expect(view.getByLabelText("Marketing playbook carousel preview")).toBeTruthy();
    expect(view.queryByText("PDF preview unavailable")).toBeNull();
  });

  test("keeps a useful document fallback when no PDF URL is available", () => {
    const view = render(<ArtifactContentView artifact={documentArtifactFixture()} />);

    expect(view.getByText("PDF preview unavailable")).toBeTruthy();
    expect(view.queryByLabelText("Marketing playbook carousel preview")).toBeNull();
  });

  test("clicking the document preview opens the full-screen preview", () => {
    const view = render(<ArtifactContentView artifact={documentArtifactFixture({ pdfUrl: "https://files.example/document.pdf" })} />);

    fireEvent.click(view.getByRole("button", { name: "Expand document, page 1 of 2" }));

    expect(view.getByRole("dialog", { name: "Marketing playbook full-screen preview" })).toBeTruthy();
  });
});

describe("AttachedArtifactComposition", () => {
  test("the document thumbnail is a button that opens the full-screen preview", () => {
    const view = render(
      <AttachedArtifactComposition
        artifact={documentArtifactFixture({ pdfUrl: "https://files.example/document.pdf" })}
        busy={false}
        onSwap={() => undefined}
      />,
    );
    const dialog = () => view.queryByRole("dialog", { name: "Marketing playbook full-screen preview" });

    expect(dialog()).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Expand document" }));

    expect(dialog()).toBeTruthy();
  });

  test("a document without a PDF has nothing to expand", () => {
    const view = render(<AttachedArtifactComposition artifact={documentArtifactFixture()} busy={false} onSwap={() => undefined} />);

    expect(view.queryByRole("button", { name: "Expand document" })).toBeNull();
  });
});
