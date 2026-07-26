import { describe, expect, test } from "bun:test";
import type { PostDetailData } from "../lib/types";
import type { ArtifactDetailData } from "./artifactTypes";
import {
  loadInitialPostComposerData,
  resolveDraftQuery,
} from "./postComposer";

const post: PostDetailData = {
  _id: "post-1",
  title: "Saved draft",
  status: "DRAFT",
  connectedAccount: {
    _id: "account-1",
    provider: "LINKEDIN",
    accountType: "PERSONAL",
    displayName: "Ada Lovelace",
  },
  artifacts: [{
    artifact: { _id: "artifact-1", type: "POST" },
    version: { version: 3, status: "READY" },
  }],
  media: [],
};

const artifact: ArtifactDetailData = {
  id: "artifact-1",
  type: "POST",
  title: "Saved artifact",
  currentVersion: 4,
  version: 3,
  status: "READY",
  content: { commentary: "Pinned version copy." },
};

describe("draft composer hydration", () => {
  test("distinguishes a blank composer, invalid query, and saved draft", () => {
    expect(resolveDraftQuery(undefined)).toEqual({ kind: "new" });
    expect(resolveDraftQuery("  ")).toEqual({ kind: "invalid" });
    expect(resolveDraftQuery([])).toEqual({ kind: "invalid" });
    expect(resolveDraftQuery([" post-1 ", "ignored"])).toEqual({
      kind: "draft",
      draftId: "post-1",
    });
  });

  test("loads the post and its exact pinned artifact version", async () => {
    const artifactReads: Array<{ artifactId: string; version: number }> = [];
    const initialPost = await loadInitialPostComposerData(
      "post-1",
      async (postId) => {
        expect(postId).toBe("post-1");
        return { data: post };
      },
      async (artifactId, version) => {
        artifactReads.push({ artifactId, version });
        return { data: artifact };
      },
    );

    expect(artifactReads).toEqual([{ artifactId: "artifact-1", version: 3 }]);
    expect(initialPost.id).toBe("post-1");
    expect(initialPost.artifact.version).toBe(3);
    expect(initialPost.account.id).toBe("account-1");
  });

  test("fails hydration when the draft or pinned artifact is unavailable", async () => {
    await expect(loadInitialPostComposerData(
      "missing-post",
      async () => ({}),
      async () => ({ data: artifact }),
    )).rejects.toThrow("The saved post was unavailable.");

    await expect(loadInitialPostComposerData(
      "post-1",
      async () => ({ data: post }),
      async () => ({}),
    )).rejects.toThrow("The pinned artifact was unavailable.");
  });
});
