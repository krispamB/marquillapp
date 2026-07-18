"use client";
/* eslint-disable @next/next/no-img-element -- media previews are short-lived signed URLs. */

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarClock, ChevronDown, FileText, ImagePlus, LoaderCircle, Send, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import MarquillSelect from "../../components/ui/MarquillSelect";
import type {
  CompletePostMediaUploadsResponse,
  ConnectedAccount,
  CreatePostMediaUploadsResponse,
  LinkedinImageDetailsResponse,
  PostDetailResponse,
  PostMediaItem,
  PostMutationResponse,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";
import { API_BASE, jsonRequest, readApi, sleep } from "./api";
import type { ArtifactDetailData, ArtifactDetailResponse, ArtifactSummary } from "./artifactTypes";
import PostArtifactPicker from "./PostArtifactPicker";
import PostCompositionPreview from "./PostCompositionPreview";
import RedesignShell from "./Shell";
import SchedulePicker, { getDefaultScheduleDate, localDateTimeValue } from "./SchedulePicker";
import StockImagePicker from "./StockImagePicker";

type PendingAction = "attach" | "upload" | "publish" | "schedule" | "remove" | null;
type StockProvider = "pexels" | "unsplash";

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "video/mp4"]);

function artifactCopy(artifact: ArtifactDetailData) {
  if (artifact.content.commentary?.trim()) return artifact.content.commentary.trim();
  if (artifact.content.poll) return artifact.content.poll.question;
  if (artifact.content.document?.slides[0]) {
    const fields = artifact.content.document.slides[0].fields;
    return Object.values(fields).filter((value) => typeof value === "string").join(" · ");
  }
  return "This artifact is ready to publish.";
}

function mediaStatusLabel(item: PostMediaItem) {
  if (item.status === "FAILED") return "Upload failed";
  if (item.status === "READY") return item.type === "VIDEO" ? "Video ready" : "Image ready";
  return item.status === "PENDING" ? "Waiting to upload" : "Processing for LinkedIn";
}

export default function CreatePostComposerClient({
  user,
  connectedAccounts,
  subscription,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewAttemptedRef = useRef(new Set<string>());
  const [selectedAccountId, setSelectedAccountId] = useState(connectedAccounts[0]?.id ?? "");
  const [postId, setPostId] = useState<string>();
  const [artifact, setArtifact] = useState<ArtifactDetailData>();
  const [media, setMedia] = useState<PostMediaItem[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [isArtifactPickerOpen, setIsArtifactPickerOpen] = useState(false);
  const [stockProvider, setStockProvider] = useState<StockProvider | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [isMobilePreviewOpen, setIsMobilePreviewOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState(localDateTimeValue(getDefaultScheduleDate()));
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusText, setStatusText] = useState("Choose an account and attach an artifact");
  const [error, setError] = useState<string | null>(null);

  const account = useMemo(
    () => connectedAccounts.find((item) => item.id === selectedAccountId) ?? connectedAccounts[0],
    [connectedAccounts, selectedAccountId],
  );
  const mediaBlocked = media.some((item) => item.status !== "READY");
  const canSubmit = Boolean(postId && artifact && !mediaBlocked && pendingAction === null);

  useEffect(() => {
    const readyWithoutPreview = media.filter((item) => item.status === "READY" && !previewUrls[item.id] && !previewAttemptedRef.current.has(item.id));
    if (!postId || !readyWithoutPreview.length) return;
    readyWithoutPreview.forEach((item) => previewAttemptedRef.current.add(item.id));
    let cancelled = false;
    void Promise.all(readyWithoutPreview.map(async (item) => {
      try {
        const response = await readApi<LinkedinImageDetailsResponse>(`${API_BASE}/posts/${postId}/media/${item.id}/preview`);
        return response.data?.downloadUrl ? [item.id, response.data.downloadUrl] as const : null;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (cancelled) return;
      setPreviewUrls((current) => ({ ...current, ...Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))) }));
    });
    return () => { cancelled = true; };
  }, [media, postId, previewUrls]);

  async function attachArtifact(summary: ArtifactSummary) {
    if (!selectedAccountId) {
      setError("Connect and select a LinkedIn account before attaching an artifact.");
      return;
    }
    setPendingAction("attach");
    setError(null);
    try {
      const detailResponse = await readApi<ArtifactDetailResponse>(`${API_BASE}/artifacts/${encodeURIComponent(summary.id)}`);
      const nextArtifact = detailResponse.data;
      if (!nextArtifact || nextArtifact.status !== "READY") throw new Error("Only READY artifacts can be attached.");

      const response = postId
        ? await readApi<PostMutationResponse>(`${API_BASE}/posts/${postId}`, jsonRequest({ artifactId: nextArtifact.id, version: nextArtifact.version }, { method: "PATCH" }))
        : await readApi<PostMutationResponse>(`${API_BASE}/posts`, jsonRequest({ artifactId: nextArtifact.id, version: nextArtifact.version, connectedAccount: selectedAccountId }, { method: "POST" }));
      const createdId = response.data?._id ?? (response.data as { id?: string } | undefined)?.id ?? postId;
      if (!createdId) throw new Error("The post service did not return a draft ID.");
      setPostId(createdId);
      setArtifact(nextArtifact);
      setMedia(response.data?.media ?? media);
      setStatusText("1 artifact attached · ready to publish");
      setIsArtifactPickerOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to attach this artifact.");
    } finally {
      setPendingAction(null);
    }
  }

  function validateFiles(files: File[]) {
    if (!files.length) throw new Error("Choose at least one file.");
    const invalid = files.find((file) => !allowedTypes.has(file.type));
    if (invalid) throw new Error(`${invalid.name} must be a JPEG, PNG, or MP4 file.`);
    const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
    if (oversized) throw new Error(`${oversized.name} is larger than the 200 MB limit.`);
    const containsVideo = files.some((file) => file.type === "video/mp4");
    const existingVideo = media.some((item) => item.type === "VIDEO");
    if (containsVideo && (files.length !== 1 || media.length > 0)) throw new Error("A video must be the only media attached to a post.");
    if (!containsVideo && existingVideo) throw new Error("Remove the video before adding images.");
    if (!containsVideo && media.length + files.length > 20) throw new Error("A post can contain at most 20 images.");
  }

  async function pollMedia(targetIds: string[]) {
    if (!postId) return;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await readApi<PostDetailResponse>(`${API_BASE}/posts/${postId}`);
      const nextMedia = response.data?.media ?? [];
      setMedia(nextMedia);
      const targets = nextMedia.filter((item) => targetIds.includes(item.id));
      if (targets.length === targetIds.length && targets.every((item) => item.status === "READY" || item.status === "FAILED")) {
        if (targets.some((item) => item.status === "FAILED")) throw new Error("One or more media files could not be processed. Remove failed items before publishing.");
        return;
      }
      await sleep(1500);
    }
    throw new Error("Media is still processing. It will remain attached while you wait.");
  }

  async function uploadFiles(files: File[]) {
    setPendingAction("upload");
    setError(null);
    try {
      if (!postId || artifact?.type !== "POST") throw new Error("Attach a POST artifact before adding media.");
      validateFiles(files);
      const declared = await readApi<CreatePostMediaUploadsResponse>(
        `${API_BASE}/posts/${postId}/media/uploads`,
        jsonRequest({ files: files.map((file) => ({ fileName: file.name, mimeType: file.type, sizeBytes: file.size })) }, { method: "POST" }),
      );
      const slots = declared.data?.uploads ?? [];
      if (slots.length !== files.length) throw new Error("The upload service did not return a slot for every file.");
      setMedia((current) => [...current, ...slots.map((slot, index): PostMediaItem => ({ id: slot.mediaId, type: files[index].type === "video/mp4" ? "VIDEO" : "IMAGE", status: "PENDING", title: files[index].name, mimeType: files[index].type, sizeBytes: files[index].size }))]);
      await Promise.all(slots.map(async (slot, index) => {
        const response = await fetch(slot.uploadUrl, { method: "PUT", headers: slot.requiredHeaders, body: files[index] });
        if (!response.ok) throw new Error(`Upload failed for ${files[index].name}.`);
      }));
      await readApi<CompletePostMediaUploadsResponse>(
        `${API_BASE}/posts/${postId}/media/uploads/complete`,
        jsonRequest({ mediaIds: slots.map((slot) => slot.mediaId) }, { method: "POST" }),
      );
      setStatusText("Media is processing for LinkedIn…");
      await pollMedia(slots.map((slot) => slot.mediaId));
      setStatusText("Artifact and media are ready to publish");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to upload media.");
      return false;
    } finally {
      setPendingAction(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    await uploadFiles(Array.from(event.target.files ?? []));
  }

  async function selectStockImage(image: { downloadUrl: string; alt: string }) {
    try {
      const response = await fetch(image.downloadUrl);
      if (!response.ok) throw new Error("Unable to download the selected stock image.");
      const blob = await response.blob();
      const uploaded = await uploadFiles([new File([blob], `${stockProvider ?? "stock"}-image.jpg`, { type: blob.type === "image/png" ? "image/png" : "image/jpeg" })]);
      if (uploaded) setStockProvider(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add the selected image.");
    }
  }

  async function removeMedia(item: PostMediaItem) {
    if (!postId) return;
    setPendingAction("remove");
    setError(null);
    try {
      const response = await readApi<{ data?: PostMediaItem[] }>(`${API_BASE}/posts/${postId}/media/${item.id}`, { method: "DELETE" });
      setMedia(Array.isArray(response.data) ? response.data : media.filter((candidate) => candidate.id !== item.id));
      previewAttemptedRef.current.delete(item.id);
      setPreviewUrls((current) => { const next = { ...current }; delete next[item.id]; return next; });
      setStatusText("Media removed");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to remove media.");
    } finally {
      setPendingAction(null);
    }
  }

  async function publishNow() {
    if (!postId || !canSubmit) return;
    setPendingAction("publish");
    setError(null);
    try {
      await readApi(`${API_BASE}/posts/${postId}/publish`, { method: "POST" });
      router.push("/posts");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to publish this post.");
      setPendingAction(null);
    }
  }

  async function confirmSchedule() {
    if (!postId || !canSubmit) return;
    const scheduledDate = new Date(scheduleValue);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() + 5 * 60_000) {
      setError("Choose a valid schedule time at least five minutes in the future.");
      return;
    }
    setPendingAction("schedule");
    setError(null);
    try {
      await readApi(`${API_BASE}/posts/${postId}/schedule`, jsonRequest({ scheduledAt: scheduledDate.toISOString() }, { method: "POST" }));
      router.push("/posts");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to schedule this post.");
      setPendingAction(null);
    }
  }

  const topbarActions = (
    <div className="mq-create-post-top-actions">
      <button type="button" className="mq-secondary-button mq-create-post-schedule-top" disabled={!postId || pendingAction !== null} onClick={() => setScheduleMode(true)}><CalendarClock size={16} /> Schedule</button>
      <button type="button" className="mq-primary-button" disabled={!canSubmit} onClick={() => void publishNow()}>{pendingAction === "publish" ? <LoaderCircle className="mq-spin" size={16} /> : <Send size={16} />}<span>Publish now</span></button>
    </div>
  );

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      subscription={subscription}
      active="posts"
      title="New post"
      topbar={{ back: { href: "/posts", label: "Back to posts" }, subtitle: artifact ? "1 artifact attached" : "Attach an artifact to continue", minimal: true }}
      topbarExtra={topbarActions}
      showAccountSelector={false}
      hideMobileNav
    >
      <div className="mq-create-post-page">
        {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}

        <div className="mq-create-post-grid">
          <section className="mq-create-post-compose">
            <div className="mq-create-post-intro">
              <div><h1>Compose post</h1><span className="mq-mono">artifact → media → publish</span></div>
              <label className="mq-create-account-field">
                <span>Publishing as</span>
                <MarquillSelect
                  value={selectedAccountId}
                  onChange={setSelectedAccountId}
                  disabled={Boolean(postId)}
                  placeholder="Choose account"
                  ariaLabel="Connected LinkedIn account"
                  options={connectedAccounts.map((item) => ({ value: item.id, label: item.displayName ?? "LinkedIn account" }))}
                />
                {postId ? <small>Account locked to this draft</small> : null}
              </label>
            </div>

            {!connectedAccounts.length ? (
              <div className="mq-card mq-create-post-empty"><FileText size={24} /><h2>Connect LinkedIn to publish</h2><p>A connected personal account or organization page is required before attaching an artifact.</p><Link href="/settings" className="mq-primary-button">Manage accounts</Link></div>
            ) : !artifact ? (
              <button type="button" className="mq-card mq-attach-artifact-empty" onClick={() => setIsArtifactPickerOpen(true)}>
                <span><FileText size={22} /></span><strong>Attach an artifact</strong><small>Choose one READY post, poll, or document.</small>
              </button>
            ) : (
              <>
                <article className="mq-card mq-attached-artifact">
                  <header><span className="mq-mono">_ attached artifact</span><button type="button" onClick={() => setIsArtifactPickerOpen(true)} disabled={pendingAction !== null}>Swap</button></header>
                  <div><span className={`mq-artifact-pick-icon is-${artifact.type.toLowerCase()}`}><FileText size={18} /></span><span><strong>{artifact.title?.trim() || "Untitled artifact"}</strong><small><b>{artifact.type}</b> · v{artifact.version}</small><p>{artifactCopy(artifact)}</p></span></div>
                </article>

                <article className="mq-card mq-readonly-artifact-content">
                  <header><strong>{artifact.type === "POST" ? "Post content" : artifact.type === "POLL" ? "Poll content" : "Document content"}</strong><Link href={`/artifacts/${encodeURIComponent(artifact.id)}`}>Edit in Studio</Link><span className="mq-mono">{artifact.content.commentary?.length ?? 0}/3000</span></header>
                  {artifact.content.commentary ? <div className="mq-readonly-commentary">{artifact.content.commentary}</div> : null}
                  {artifact.type === "POLL" && artifact.content.poll ? <div className="mq-readonly-poll"><strong>{artifact.content.poll.question}</strong>{artifact.content.poll.options.map((option) => <span key={option}>{option}</span>)}<small>{artifact.content.poll.durationDays} day poll</small></div> : null}
                  {artifact.type === "DOCUMENT" && artifact.content.document ? <div className="mq-readonly-document"><FileText size={28} /><span><strong>{artifact.content.document.slides.length} slides</strong><small>{artifact.content.document.templateId} theme</small></span>{artifact.content.document.pdfUrl ? <a href={artifact.content.document.pdfUrl} target="_blank" rel="noreferrer">Open PDF</a> : null}</div> : null}

                  {artifact.type === "POST" ? (
                    <div className="mq-post-media-section">
                      {media.length ? <div className="mq-post-media-list">{media.map((item) => <div key={item.id} className={`mq-post-media-item is-${item.status.toLowerCase()}`}>{previewUrls[item.id] && item.type === "IMAGE" ? <img src={previewUrls[item.id]} alt="" /> : <span><ImagePlus size={17} /></span>}<div><strong>{item.title ?? (item.type === "VIDEO" ? "Video" : "Image")}</strong><small>{mediaStatusLabel(item)}</small></div><button type="button" className="mq-icon-button" disabled={pendingAction !== null} onClick={() => void removeMedia(item)} aria-label={`Remove ${item.title ?? "media"}`}><Trash2 size={15} /></button></div>)}</div> : null}
                      <div className="mq-post-media-actions">
                        <button type="button" className="mq-chip-button mq-stock-button" disabled={pendingAction !== null || media.some((item) => item.type === "VIDEO") || media.length >= 20} onClick={() => setStockProvider("pexels")}><Image src="/pexels.svg" alt="" width={15} height={15} /> Pexels</button>
                        <button type="button" className="mq-chip-button mq-stock-button" disabled={pendingAction !== null || media.some((item) => item.type === "VIDEO") || media.length >= 20} onClick={() => setStockProvider("unsplash")}><Image src="/unsplash.svg" alt="" width={15} height={15} /> Unsplash</button>
                        <label className={`mq-chip-button ${pendingAction !== null ? "is-disabled" : ""}`}><Upload size={14} /> {pendingAction === "upload" ? "Uploading…" : "Upload"}<input ref={fileInputRef} type="file" accept="image/jpeg,image/png,video/mp4" multiple onChange={handleFileInput} hidden disabled={pendingAction !== null} /></label>
                        <small>Up to 20 images or one MP4 · 200 MB each</small>
                      </div>
                    </div>
                  ) : null}
                </article>
              </>
            )}
          </section>

          <aside className="mq-create-post-sidebar">
            {artifact ? <><span className="mq-mono">_ linkedin preview</span><div className="mq-desktop-composition-preview"><PostCompositionPreview user={user} account={account} artifact={artifact} media={media} previewUrls={previewUrls} /></div><div className="mq-mobile-preview-wrap"><button type="button" onClick={() => setIsMobilePreviewOpen((value) => !value)} aria-expanded={isMobilePreviewOpen}>LinkedIn preview <ChevronDown className={isMobilePreviewOpen ? "is-open" : ""} size={16} /></button>{isMobilePreviewOpen ? <PostCompositionPreview user={user} account={account} artifact={artifact} media={media} previewUrls={previewUrls} /> : null}</div></> : null}

            {postId ? <div className={`mq-card mq-create-schedule-card ${scheduleMode ? "is-open" : ""}`}><h2>When should this publish?</h2><div className="mq-segmented mq-segmented-small"><button type="button" className={!scheduleMode ? "is-active" : ""} onClick={() => setScheduleMode(false)}>Publish now</button><button type="button" className={scheduleMode ? "is-active" : ""} onClick={() => setScheduleMode(true)}>Schedule</button></div>{scheduleMode ? <><SchedulePicker value={scheduleValue} onChange={setScheduleValue} disabled={pendingAction !== null} /><button type="button" className="mq-primary-button" disabled={!canSubmit} onClick={() => void confirmSchedule()}>{pendingAction === "schedule" ? "Scheduling…" : "Confirm schedule"}</button></> : <p><Send size={14} /> Ready when you are. Use Publish now above.</p>}</div> : null}
          </aside>
        </div>

        {postId ? <div className="mq-mobile-schedule-bar"><span><CalendarClock size={16} /><span><small>Suggested</small><strong>{new Date(scheduleValue).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</strong></span></span><button type="button" disabled={pendingAction !== null} onClick={() => setScheduleMode(true)}>Schedule</button></div> : null}
        <span className="mq-create-post-status" aria-live="polite">{statusText}</span>
      </div>

      <PostArtifactPicker isOpen={isArtifactPickerOpen} hasMedia={media.length > 0} busy={pendingAction !== null} onClose={() => setIsArtifactPickerOpen(false)} onSelect={(item) => void attachArtifact(item)} />
      {stockProvider ? <StockImagePicker provider={stockProvider} onClose={() => setStockProvider(null)} onSelect={(image) => void selectStockImage(image)} /> : null}
    </RedesignShell>
  );
}
