"use client";

import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, FileText, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import MarquillSelect from "../../components/ui/MarquillSelect";
import type {
  ConnectedAccount,
  PostMutationResponse,
  SubscriptionTier,
  UserProfile,
} from "../lib/types";
import { API_BASE, jsonRequest, readApi } from "./api";
import type { ArtifactDetailData, ArtifactDetailResponse, ArtifactSummary } from "./artifactTypes";
import PostArtifactPicker from "./PostArtifactPicker";
import AttachedArtifactComposition from "./ArtifactCompositionContent";
import PostCompositionPreview from "./PostCompositionPreview";
import PostMediaControls from "./PostMediaControls";
import PostSchedulingControls from "./PostSchedulingControls";
import RedesignShell from "./Shell";
import { getDefaultScheduleDate, localDateTimeValue } from "./SchedulePicker";
import StockImagePicker from "./StockImagePicker";
import LinkedInConnectButton from "./LinkedInConnectButton";
import usePostMediaWorkflow from "./usePostMediaWorkflow";

type PendingAction = "attach" | "publish" | "schedule" | null;
type StockProvider = "pexels" | "unsplash";

export default function CreatePostComposerClient({
  user,
  connectedAccounts,
  subscription,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  subscription?: SubscriptionTier | null;
}) {
  const router = useRouter();
  const [selectedAccountId, setSelectedAccountId] = useState(connectedAccounts[0]?.id ?? "");
  const [postId, setPostId] = useState<string>();
  const [artifact, setArtifact] = useState<ArtifactDetailData>();
  const [isArtifactPickerOpen, setIsArtifactPickerOpen] = useState(false);
  const [stockProvider, setStockProvider] = useState<StockProvider | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [isMobilePreviewOpen, setIsMobilePreviewOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState(localDateTimeValue(getDefaultScheduleDate()));
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusText, setStatusText] = useState("Choose an account and attach an artifact");
  const [error, setError] = useState<string | null>(null);
  const {
    error: mediaError,
    isMutating: isMediaMutating,
    media,
    previewUrls,
    refreshMedia,
    removeMedia,
    replaceMedia,
    uploadFiles,
  } = usePostMediaWorkflow({ postId, artifactType: artifact?.type, onStatus: setStatusText });

  const account = useMemo(
    () => connectedAccounts.find((item) => item.id === selectedAccountId) ?? connectedAccounts[0],
    [connectedAccounts, selectedAccountId],
  );
  const mediaBlocked = media.some((item) => item.status !== "READY");
  const isBusy = pendingAction !== null || isMediaMutating;
  const canSubmit = Boolean(postId && artifact && !mediaBlocked && !isBusy);

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
      replaceMedia(response.data?.media ?? media);
      setStatusText("1 artifact attached · ready to publish");
      setIsArtifactPickerOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to attach this artifact.");
    } finally {
      setPendingAction(null);
    }
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
      <button type="button" className="mq-secondary-button mq-create-post-schedule-top" disabled={!postId || isBusy} onClick={() => setScheduleMode(true)}><CalendarClock size={16} /> Schedule</button>
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
              <div className="mq-card mq-create-post-empty"><FileText size={24} /><h2>Connect LinkedIn to publish</h2><p>A connected personal account or organization page is required before attaching an artifact.</p><LinkedInConnectButton className="mq-primary-button">Connect LinkedIn</LinkedInConnectButton></div>
            ) : !artifact ? (
              <button type="button" className="mq-card mq-attach-artifact-empty" onClick={() => setIsArtifactPickerOpen(true)}>
                <span><FileText size={22} /></span><strong>Attach an artifact</strong><small>Choose one READY post, poll, or document.</small>
              </button>
            ) : (
              <AttachedArtifactComposition
                artifact={artifact}
                busy={isBusy}
                onSwap={() => setIsArtifactPickerOpen(true)}
                mediaControls={artifact.type === "POST" ? <PostMediaControls error={mediaError} isBusy={isBusy} media={media} previewUrls={previewUrls} onChooseStock={setStockProvider} onRefresh={() => void refreshMedia()} onRemove={(item) => void removeMedia(item)} onUpload={uploadFiles} /> : undefined}
              />
            )}
          </section>

          <aside className="mq-create-post-sidebar">
            {artifact ? <><span className="mq-mono">_ linkedin preview</span><div className="mq-desktop-composition-preview"><PostCompositionPreview user={user} account={account} artifact={artifact} media={media} previewUrls={previewUrls} /></div><div className="mq-mobile-preview-wrap"><button type="button" onClick={() => setIsMobilePreviewOpen((value) => !value)} aria-expanded={isMobilePreviewOpen}>LinkedIn preview <ChevronDown className={isMobilePreviewOpen ? "is-open" : ""} size={16} /></button>{isMobilePreviewOpen ? <PostCompositionPreview user={user} account={account} artifact={artifact} media={media} previewUrls={previewUrls} /> : null}</div></> : null}

            {postId ? <PostSchedulingControls canSubmit={canSubmit} isBusy={isBusy} isScheduling={pendingAction === "schedule"} scheduleMode={scheduleMode} scheduleValue={scheduleValue} onChange={setScheduleValue} onConfirm={() => void confirmSchedule()} onModeChange={setScheduleMode} /> : null}
          </aside>
        </div>

        <span className="mq-create-post-status" aria-live="polite">{statusText}</span>
      </div>

      <PostArtifactPicker isOpen={isArtifactPickerOpen} hasMedia={media.length > 0} busy={isBusy} onClose={() => setIsArtifactPickerOpen(false)} onSelect={(item) => void attachArtifact(item)} />
      {stockProvider ? <StockImagePicker provider={stockProvider} onClose={() => setStockProvider(null)} onSelect={(image) => void selectStockImage(image)} /> : null}
    </RedesignShell>
  );
}
