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

  test("shows a preview when media refreshes while its request is in flight", async () => {
    let resolvePreview!: (value: unknown) => void;
    const previewResponse = new Promise((resolve) => { resolvePreview = resolve; });
    const request = async <T,>() => previewResponse as Promise<T>;
    const hook = renderHook(() => usePostMediaWorkflow({ postId: "post-1", artifactType: "POST", initialMedia: media, onStatus: () => {}, request }));

    await waitFor(() => expect(hook.result.current.media).toHaveLength(1));
    act(() => {
      hook.result.current.replaceMedia([
        ...media,
        { id: "media-2", type: "IMAGE", status: "UPLOADING" },
      ]);
    });

    await act(async () => {
      resolvePreview({
        data: {
          downloadUrl: "https://cdn.example/in-flight",
          downloadUrlExpiresAt: Date.now() + 60_000,
        },
      });
      await previewResponse;
    });

    await waitFor(() => expect(hook.result.current.previewUrls["media-1"]).toBe("https://cdn.example/in-flight"));
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

  test("moves from aggregate upload progress into processing", async () => {
    let reportProgress!: (loadedBytes: number) => void;
    let finishUpload!: () => void;
    const upload = async (_url: string, _headers: Record<string, string>, _file: File, onProgress: (loadedBytes: number) => void) => {
      reportProgress = onProgress;
      await new Promise<void>((resolve) => { finishUpload = resolve; });
    };
    const request = async <T,>(input: string) => {
      if (input.endsWith("/media/uploads")) return { data: { uploads: [{ mediaId: "media-new", uploadUrl: "https://s3.example/upload", requiredHeaders: {} }] } } as T;
      if (input.endsWith("/media/uploads/complete")) return { data: [] } as T;
      return { data: { media: [{ id: "media-new", type: "IMAGE", status: "UPLOADING", title: "image.jpg" }] } } as T;
    };
    const hook = renderHook(() => usePostMediaWorkflow({ postId: "post-1", artifactType: "POST", onStatus: () => {}, request, upload }));
    const file = new File([new Uint8Array(100)], "image.jpg", { type: "image/jpeg" });
    let pendingUpload!: Promise<boolean>;

    act(() => { pendingUpload = hook.result.current.uploadFiles([file]); });
    await waitFor(() => expect(hook.result.current.workflowPhase).toBe("uploading"));
    act(() => reportProgress(50));
    expect(hook.result.current.uploadProgress).toBe(50);

    await act(async () => {
      finishUpload();
      await pendingUpload;
    });
    expect(hook.result.current.workflowPhase).toBe("processing");
    expect(hook.result.current.uploadProgress).toBeNull();
    hook.unmount();
  });

  test("clears upload progress and marks declared media failed after an S3 error", async () => {
    const request = async <T,>(input: string) => {
      if (input.endsWith("/media/uploads")) return { data: { uploads: [{ mediaId: "media-failed", uploadUrl: "https://s3.example/upload", requiredHeaders: {} }] } } as T;
      throw new Error("The completion endpoint should not be called");
    };
    const upload = async () => { throw new Error("Upload failed for image.jpg."); };
    const hook = renderHook(() => usePostMediaWorkflow({ postId: "post-1", artifactType: "POST", onStatus: () => {}, request, upload }));
    const file = new File([new Uint8Array(100)], "image.jpg", { type: "image/jpeg" });

    await act(async () => {
      expect(await hook.result.current.uploadFiles([file])).toBe(false);
    });

    expect(hook.result.current.workflowPhase).toBe("idle");
    expect(hook.result.current.uploadProgress).toBeNull();
    expect(hook.result.current.media[0]?.status).toBe("FAILED");
    expect(hook.result.current.error).toBe("Upload failed for image.jpg.");
  });
});
