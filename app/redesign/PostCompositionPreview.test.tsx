import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UserProfile } from "../lib/types";
import PostCompositionPreview from "./PostCompositionPreview";
import type { ComposerPostMediaItem } from "./postMedia";
import type { ArtifactDetailData } from "./artifactTypes";

GlobalRegistrator.register();
afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

const user: UserProfile = {
  name: "Ada Okafor",
  email: "ada@example.com",
};

const artifact: ArtifactDetailData = {
  id: "artifact-1",
  type: "POST",
  currentVersion: 1,
  version: 1,
  status: "READY",
  content: { commentary: "A post with attached media." },
};

function image(id: string, status: ComposerPostMediaItem["status"] = "READY"): ComposerPostMediaItem {
  return {
    id,
    type: "IMAGE",
    status,
    title: `${id}.jpg`,
    altText: `Description for ${id}`,
  };
}

function previewUrls(media: ComposerPostMediaItem[]) {
  return Object.fromEntries(media.map((item) => [item.id, `https://cdn.example/${item.id}`]));
}

function rect(left: number, width: number): DOMRect {
  return {
    bottom: 400,
    height: 400,
    left,
    right: left + width,
    top: 0,
    width,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

function mockCarouselGeometry(view: ReturnType<typeof render>) {
  const rail = view.getByRole("region", { name: "Attached images" }) as HTMLDivElement;
  const slides = view.getAllByRole("group");

  Object.defineProperty(rail, "getBoundingClientRect", {
    configurable: true,
    value: () => rect(0, 100),
  });
  slides.forEach((slide, index) => {
    Object.defineProperty(slide, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(index * 100 - rail.scrollLeft + 10, 80),
    });
  });

  return { rail, slides };
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value(options: ScrollToOptions) {
      if (typeof options.left === "number") this.scrollLeft = options.left;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => true,
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
});

describe("PostCompositionPreview media", () => {
  test("keeps the existing single-image layout without a carousel counter", () => {
    const media = [image("image-1")];
    const view = render(
      <PostCompositionPreview user={user} artifact={artifact} media={media} previewUrls={previewUrls(media)} />,
    );

    expect(view.getByAltText("Description for image-1")).toBeTruthy();
    expect(view.queryByRole("region", { name: "Attached images" })).toBeNull();
    expect(view.queryByText("1/1")).toBeNull();
  });

  test("renders every ready image in order and excludes unavailable media", () => {
    const readyImages = Array.from({ length: 5 }, (_, index) => image(`image-${index + 1}`));
    const media = [...readyImages, image("pending-image", "UPLOADING")];
    const view = render(
      <PostCompositionPreview user={user} artifact={artifact} media={media} previewUrls={previewUrls(media)} />,
    );

    expect(view.getAllByRole("group").map((slide) => slide.getAttribute("aria-label"))).toEqual([
      "Image 1 of 5",
      "Image 2 of 5",
      "Image 3 of 5",
      "Image 4 of 5",
      "Image 5 of 5",
    ]);
    expect(view.getByText("1/5")).toBeTruthy();
    expect(view.queryByAltText("Description for pending-image")).toBeNull();
  });

  test("updates the counter to the image nearest the center after scrolling", async () => {
    const media = [image("image-1"), image("image-2"), image("image-3")];
    const view = render(
      <PostCompositionPreview user={user} artifact={artifact} media={media} previewUrls={previewUrls(media)} />,
    );
    const { rail } = mockCarouselGeometry(view);

    rail.scrollLeft = 100;
    fireEvent.scroll(rail);

    await waitFor(() => expect(view.getByText("2/3")).toBeTruthy());
  });

  test("supports mouse dragging and settles on the nearest image", () => {
    const media = [image("image-1"), image("image-2"), image("image-3")];
    const view = render(
      <PostCompositionPreview user={user} artifact={artifact} media={media} previewUrls={previewUrls(media)} />,
    );
    const { rail } = mockCarouselGeometry(view);

    fireEvent.pointerDown(rail, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 100 });
    fireEvent.pointerMove(rail, { pointerId: 1, pointerType: "mouse", clientX: 0 });
    expect(rail.scrollLeft).toBe(100);
    fireEvent.pointerUp(rail, { pointerId: 1, pointerType: "mouse", clientX: 0 });

    expect(view.getByText("2/3")).toBeTruthy();
  });

  test("resets to the first image when the media collection changes", async () => {
    const initialMedia = [image("image-1"), image("image-2"), image("image-3")];
    const view = render(
      <PostCompositionPreview user={user} artifact={artifact} media={initialMedia} previewUrls={previewUrls(initialMedia)} />,
    );
    const { rail } = mockCarouselGeometry(view);
    rail.scrollLeft = 100;
    fireEvent.scroll(rail);
    await waitFor(() => expect(view.getByText("2/3")).toBeTruthy());

    const nextMedia = [image("image-4"), image("image-5")];
    view.rerender(
      <PostCompositionPreview user={user} artifact={artifact} media={nextMedia} previewUrls={previewUrls(nextMedia)} />,
    );

    expect(view.getByText("1/2")).toBeTruthy();
    expect((view.getByRole("region", { name: "Attached images" }) as HTMLDivElement).scrollLeft).toBe(0);
  });

  test("preserves the single-video preview", () => {
    const media: ComposerPostMediaItem[] = [{
      id: "video-1",
      type: "VIDEO",
      status: "READY",
      title: "Launch video",
    }];
    const view = render(
      <PostCompositionPreview user={user} artifact={artifact} media={media} previewUrls={previewUrls(media)} />,
    );

    const video = view.getByLabelText("Launch video") as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("https://cdn.example/video-1");
    expect(view.queryByRole("region", { name: "Attached images" })).toBeNull();
  });
});
