import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import ArtifactResponse from "./ArtifactResponse";
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
