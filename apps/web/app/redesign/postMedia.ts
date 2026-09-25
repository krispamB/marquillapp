import type { MediaUploadStatus, PostMediaItem } from "../lib/types";

export type ComposerPostMediaItem = Omit<PostMediaItem, "id" | "type" | "status"> & {
  id: string;
  type: "IMAGE" | "VIDEO";
  status: MediaUploadStatus;
};

export function normalizePostMedia(items: PostMediaItem[]): ComposerPostMediaItem[] {
  return items.flatMap((item) => {
    const id = item.id ?? item._id ?? item.linkedinUrn;
    if (!id) return [];
    return [{
      ...item,
      id,
      type: item.type ?? "IMAGE",
      status: item.status ?? "READY",
    }];
  });
}
