import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import ArtifactResponse from "./ArtifactResponse";
import type { ArtifactDetailData } from "./artifactTypes";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function documentArtifact(pdfUrl?: string): ArtifactDetailData {
  return {
    id: "document-1",
    type: "DOCUMENT",
    title: "Marketing playbook",
    currentVersion: 1,
    version: 1,
    status: "READY",
    content: {
      commentary: "A practical guide for growing a SaaS product.",
      document: {
        templateId: "editorial",
        slides: [
          { type: "cover", fields: { title: "Marketing playbook" } },
          { type: "cta", fields: { headline: "Start today", action: "Follow" } },
        ],
        pageCount: 2,
        ...(pdfUrl ? { pdfUrl } : {}),
      },
    },
  };
}

describe("ArtifactResponse document preview", () => {
  test("renders the shared PDF preview beneath the document metadata", () => {
    const view = render(<ArtifactResponse artifact={documentArtifact("https://files.example/document.pdf")} />);

    expect(view.getByText("A practical guide for growing a SaaS product.")).toBeTruthy();
    expect(view.getByLabelText("Marketing playbook PDF preview")).toBeTruthy();
  });

  test("shows the unavailable state without mounting the PDF preview", () => {
    const view = render(<ArtifactResponse artifact={documentArtifact()} />);

    expect(view.getByText("PDF link unavailable")).toBeTruthy();
    expect(view.queryByLabelText("Marketing playbook PDF preview")).toBeNull();
  });
});
