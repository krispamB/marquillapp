import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import type { PostMediaItem } from "../lib/types";
import { readCachedMediaPreview, writeCachedMediaPreview } from "./mediaPreviewCache";
import usePostMediaWorkflow from "./usePostMediaWorkflow";

GlobalRegistrator.register();
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
afterAll(() => GlobalRegistrator.unregister());

const media: PostMediaItem[] = [{ id: "media-1", type: "IMAGE", status: "READY" }];

describe("usePostMediaWorkflow preview caching", () => {
  test("uses a valid cached preview without requesting the endpoint", async () => {
    writeCachedMediaPreview("media-1", "https://cdn.example/cached", Date.now() + 60_000);
    const requests: string[] = [];
    const request = async <T,>(input: string): Promise<T> => {
      requests.push(input);
      throw new Error("The endpoint should not be requested");
    };

    const hook = renderHook(() => usePostMediaWorkflow({
      postId: "post-1",
      artifactType: "POST",
      initialMedia: media,
      onStatus: () => {},
      request,
    }));

    await waitFor(() => expect(hook.result.current.previewUrls["media-1"]).toBe("https://cdn.example/cached"));
    expect(requests).toHaveLength(0);
  });

  test("persists an endpoint preview and reuses it on a later mount", async () => {
    const requests: string[] = [];
    const request = async <T,>(input: string) => {
      requests.push(input);
      return {
        data: {
          downloadUrl: "https://cdn.example/fresh",
          downloadUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      } as T;
    };

    const firstHook = renderHook(() => usePostMediaWorkflow({ postId: "post-1", artifactType: "POST", initialMedia: media, onStatus: () => {}, request }));
    await waitFor(() => expect(firstHook.result.current.previewUrls["media-1"]).toBe("https://cdn.example/fresh"));
    firstHook.unmount();

    const secondHook = renderHook(() => usePostMediaWorkflow({ postId: "post-1", artifactType: "POST", initialMedia: media, onStatus: () => {}, request }));
    await waitFor(() => expect(secondHook.result.current.previewUrls["media-1"]).toBe("https://cdn.example/fresh"));

    expect(requests).toHaveLength(1);
  });

  test("keeps an uncachable endpoint preview for the current mount", async () => {
    const request = async <T,>() => ({ data: { downloadUrl: "https://cdn.example/current" } }) as T;
    const hook = renderHook(() => usePostMediaWorkflow({ postId: "post-1", artifactType: "POST", initialMedia: media, onStatus: () => {}, request }));

    await waitFor(() => expect(hook.result.current.previewUrls["media-1"]).toBe("https://cdn.example/current"));
    expect(readCachedMediaPreview("media-1")).toBeUndefined();
  });

  test("deletes the cached preview after removing media", async () => {
    writeCachedMediaPreview("media-1", "https://cdn.example/cached", Date.now() + 60_000);
    const request = async <T,>(_input: string, init?: RequestInit) => {
      expect(init?.method).toBe("DELETE");
      return { data: [] } as T;
    };
    const hook = renderHook(() => usePostMediaWorkflow({ postId: "post-1", artifactType: "POST", initialMedia: media, onStatus: () => {}, request }));
    await waitFor(() => expect(hook.result.current.previewUrls["media-1"]).toBe("https://cdn.example/cached"));

    await act(async () => {
      await hook.result.current.removeMedia(media[0]);
    });

    expect(readCachedMediaPreview("media-1")).toBeUndefined();
  });
});
