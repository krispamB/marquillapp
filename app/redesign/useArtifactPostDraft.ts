"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CreatePostRequest, PostMutationResponse } from "../lib/types";
import type { ArtifactDetailData } from "./artifactTypes";
import { API_BASE, jsonRequest, readApi } from "./api";

export type ArtifactPostDraftRequest = (
  artifact: ArtifactDetailData,
  connectedAccount: string,
) => Promise<string>;

export function artifactPostDraftPayload(
  artifact: ArtifactDetailData,
  connectedAccount: string,
): CreatePostRequest {
  return {
    artifactId: artifact.id,
    version: artifact.version,
    connectedAccount,
  };
}

export async function requestArtifactPostDraft(
  artifact: ArtifactDetailData,
  connectedAccount: string,
) {
  const response = await readApi<PostMutationResponse>(
    `${API_BASE}/posts`,
    jsonRequest(artifactPostDraftPayload(artifact, connectedAccount), {
      method: "POST",
    }),
  );
  const createdId = response.data?._id
    ?? (response.data as { id?: string } | undefined)?.id;
  if (!createdId) throw new Error("The post service did not return a draft ID.");
  return createdId;
}

export default function useArtifactPostDraft(
  requestDraft: ArtifactPostDraftRequest = requestArtifactPostDraft,
) {
  const router = useRouter();
  const isCreatingRef = useRef(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const createDraft = useCallback(async (
    artifact: ArtifactDetailData,
    connectedAccount: string,
  ): Promise<"created" | "failed" | "ignored"> => {
    if (isCreatingRef.current || !connectedAccount) return "ignored";
    isCreatingRef.current = true;
    setIsCreating(true);
    setError(null);
    try {
      const createdId = await requestDraft(artifact, connectedAccount);
      router.push(`/posts/new?draft=${encodeURIComponent(createdId)}`);
      return "created";
    } catch (reason) {
      setError(reason instanceof Error
        ? reason.message
        : "Unable to create a post from this artifact.");
      setIsCreating(false);
      isCreatingRef.current = false;
      return "failed";
    }
  }, [requestDraft, router]);

  return {
    clearError,
    createDraft,
    error,
    isCreating,
  };
}
