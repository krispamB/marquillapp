import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { ArtifactDetailData } from "./artifactTypes";
import type { ArtifactPostDraftRequest } from "./useArtifactPostDraft";

const navigations: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => { navigations.push(url); },
  }),
}));

const {
  artifactPostDraftPayload,
  default: useArtifactPostDraft,
} = await import("./useArtifactPostDraft");

GlobalRegistrator.register();
afterEach(() => {
  cleanup();
  navigations.length = 0;
});
afterAll(() => GlobalRegistrator.unregister());

const artifact: ArtifactDetailData = {
  id: "artifact-1",
  type: "POST",
  title: "A ready post",
  currentVersion: 3,
  version: 3,
  status: "READY",
  content: { commentary: "Ready to publish." },
};

describe("useArtifactPostDraft", () => {
  test("builds the exact create-post payload", () => {
    expect(artifactPostDraftPayload(artifact, "account-1")).toEqual({
      artifactId: "artifact-1",
      version: 3,
      connectedAccount: "account-1",
    });
  });

  test("ignores duplicate creation attempts while a request is pending", async () => {
    let resolveRequest: ((postId: string) => void) | undefined;
    let requestCount = 0;
    const requestDraft: ArtifactPostDraftRequest = () => {
      requestCount += 1;
      return new Promise<string>((resolve) => { resolveRequest = resolve; });
    };
    const hook = renderHook(() => useArtifactPostDraft(requestDraft));

    let first: ReturnType<typeof hook.result.current.createDraft>;
    let duplicate: ReturnType<typeof hook.result.current.createDraft>;
    act(() => {
      first = hook.result.current.createDraft(artifact, "account-1");
      duplicate = hook.result.current.createDraft(artifact, "account-1");
    });

    expect(requestCount).toBe(1);
    expect(await duplicate!).toBe("ignored");

    await act(async () => {
      resolveRequest?.("post-1");
      expect(await first!).toBe("created");
    });
    expect(navigations).toEqual(["/posts/new?draft=post-1"]);
  });

  test("exposes request failures and allows a retry", async () => {
    let requestCount = 0;
    const requestDraft: ArtifactPostDraftRequest = async () => {
      requestCount += 1;
      if (requestCount === 1) throw new Error("Draft creation failed.");
      return "post-2";
    };
    const hook = renderHook(() => useArtifactPostDraft(requestDraft));

    await act(async () => {
      expect(await hook.result.current.createDraft(artifact, "account-1")).toBe("failed");
    });
    expect(hook.result.current.error).toBe("Draft creation failed.");

    await act(async () => {
      expect(await hook.result.current.createDraft(artifact, "account-1")).toBe("created");
    });
    expect(requestCount).toBe(2);
    expect(navigations).toEqual(["/posts/new?draft=post-2"]);
  });
});
