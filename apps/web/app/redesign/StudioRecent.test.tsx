import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { ArtifactsListResponse } from "./artifactTypes";
import StudioRecent from "./StudioRecent";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const response: ArtifactsListResponse = {
  data: [
    { id: "a1", type: "POST", title: "First idea", status: "READY" },
    { id: "a2", type: "POLL", status: "READY" },
    { id: "a3", type: "DOCUMENT", title: "Third", status: "READY" },
    { id: "a4", type: "POST", title: "Fourth", status: "READY" },
  ],
};

describe("StudioRecent", () => {
  test("links to at most three recent artifacts", async () => {
    const view = render(<StudioRecent load={async () => response} />);

    await waitFor(() => expect(view.getByText("First idea")).toBeTruthy());
    const hrefs = view.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(["/artifacts", "/artifacts/a1", "/artifacts/a2", "/artifacts/a3"]);
    expect(view.getByText("Untitled poll")).toBeTruthy();
    expect(view.queryByText("Fourth")).toBeNull();
  });

  test("renders nothing for an empty list", async () => {
    const view = render(<StudioRecent load={async () => ({ data: [] })} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(view.container.innerHTML).toBe("");
  });

  test("renders nothing when the request fails", async () => {
    const view = render(<StudioRecent load={async () => { throw new Error("down"); }} />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(view.container.innerHTML).toBe("");
  });
});
