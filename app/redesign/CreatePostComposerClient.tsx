"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarClock, FileText, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import MarquillSelect from "../../components/ui/MarquillSelect";
import type {
  ConnectedAccount,
  PostMutationResponse,
  PostStatus,
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
import MobileComposerSwitcher, { type MobileComposerView } from "./MobileComposerSwitcher";
import usePostMediaWorkflow from "./usePostMediaWorkflow";
import type { InitialPostComposerData } from "./postComposer";

type PendingAction = "attach" | "publish" | "schedule" | "unschedule" | null;
type StockProvider = "pexels" | "unsplash";

export default function CreatePostComposerClient({
  user,
  connectedAccounts,
  subscription,
  initialPost,
  initialLoadError,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  subscription?: SubscriptionTier | null;
  initialPost?: InitialPostComposerData;
  initialLoadError?: string;
}) {
  const isEditing = Boolean(initialPost || initialLoadError);
  const router = useRouter();
  const [selectedAccountId, setSelectedAccountId] = useState(initialPost?.account.id ?? connectedAccounts[0]?.id ?? "");
  const [postId, setPostId] = useState<string | undefined>(initialPost?.id);
  const [postTitle, setPostTitle] = useState(initialPost?.title ?? "");
  const lastSavedTitle = useRef(initialPost?.title.trim() ?? "");
  const titleSavePromise = useRef<Promise<boolean> | null>(null);
  const [isTitleSaving, setIsTitleSaving] = useState(false);
  const [postStatus, setPostStatus] = useState<PostStatus | undefined>(initialPost?.status);
  const [artifact, setArtifact] = useState<ArtifactDetailData | undefined>(initialPost?.artifact);
  const [isArtifactPickerOpen, setIsArtifactPickerOpen] = useState(false);
  const [stockProvider, setStockProvider] = useState<StockProvider | null>(null);
  const [scheduleMode, setScheduleMode] = useState(Boolean(initialPost?.scheduledAt));
  const [mobileView, setMobileView] = useState<MobileComposerView>("compose");
  const [scheduleValue, setScheduleValue] = useState(() => localDateTimeValue(initialPost?.scheduledAt ? new Date(initialPost.scheduledAt) : getDefaultScheduleDate()));
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [statusText, setStatusText] = useState(initialPost ? `Post · ${initialPost.status.toLowerCase()}` : "Choose an account and attach an artifact");
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
  } = usePostMediaWorkflow({ postId, artifactType: artifact?.type, initialMedia: initialPost?.media, onStatus: setStatusText });

  const account = useMemo(
    () => {
      const currentAccount = connectedAccounts.find((item) => item.id === selectedAccountId);
      if (!initialPost?.account || initialPost.account.id !== selectedAccountId) return currentAccount ?? connectedAccounts[0];
      if (!currentAccount) return initialPost.account;
      return {
        ...initialPost.account,
        ...currentAccount,
        profile: { ...initialPost.account.profile, ...currentAccount.profile },
      };
    },
    [connectedAccounts, initialPost, selectedAccountId],
  );
  const accountOptions = useMemo(() => {
    if (!initialPost?.account || connectedAccounts.some((item) => item.id === initialPost.account.id)) return connectedAccounts;
    return [initialPost.account, ...connectedAccounts];
  }, [connectedAccounts, initialPost]);
  const mediaBlocked = media.some((item) => item.status !== "READY");
  const isBusy = pendingAction !== null || isMediaMutating;
  const isPublished = postStatus === "PUBLISHED";
  const isScheduled = postStatus === "SCHEDULED";
  const compositionLocked = isScheduled || isPublished;
  const canSubmit = Boolean(postId && artifact && !mediaBlocked && !isBusy && !isPublished);

  function saveTitle(): Promise<boolean> {
    if (titleSavePromise.current) return titleSavePromise.current;
    if (!postId || compositionLocked) return Promise.resolve(true);
    const title = postTitle.trim();
    if (!title) {
      setPostTitle(lastSavedTitle.current);
      setError("Post titles must contain at least one character.");
      return Promise.resolve(false);
    }
    if (title === lastSavedTitle.current) {
      if (title !== postTitle) setPostTitle(title);
      return Promise.resolve(true);
    }

    setIsTitleSaving(true);
    setError(null);
    const request = readApi<PostMutationResponse>(
        `${API_BASE}/posts/${postId}`,
        jsonRequest({ title }, { method: "PATCH" }),
      )
      .then((response) => {
        const savedTitle = response.data?.title?.trim() || title;
        lastSavedTitle.current = savedTitle;
        setPostTitle(savedTitle);
        if (response.data?.status) setPostStatus(response.data.status as PostStatus);
        setStatusText("Title saved");
        return true;
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : "Unable to save the post title.");
        return false;
      })
      .finally(() => {
        titleSavePromise.current = null;
        setIsTitleSaving(false);
      });
    titleSavePromise.current = request;
    return request;
  }

  async function attachArtifact(summary: ArtifactSummary) {
    if (compositionLocked) return;
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

      const trimmedTitle = postTitle.trim();
      const response = postId
        ? await readApi<PostMutationResponse>(`${API_BASE}/posts/${postId}`, jsonRequest({ artifactId: nextArtifact.id, version: nextArtifact.version, ...(trimmedTitle && trimmedTitle !== lastSavedTitle.current ? { title: trimmedTitle } : {}) }, { method: "PATCH" }))
        : await readApi<PostMutationResponse>(`${API_BASE}/posts`, jsonRequest({ artifactId: nextArtifact.id, version: nextArtifact.version, connectedAccount: selectedAccountId, ...(trimmedTitle ? { title: trimmedTitle } : {}) }, { method: "POST" }));
      const createdId = response.data?._id ?? (response.data as { id?: string } | undefined)?.id ?? postId;
      if (!createdId) throw new Error("The post service did not return a draft ID.");
      setPostId(createdId);
      setPostStatus("DRAFT");
      const savedTitle = response.data?.title?.trim() || trimmedTitle;
      if (savedTitle) {
        lastSavedTitle.current = savedTitle;
        setPostTitle(savedTitle);
      }
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
    if (!await saveTitle()) return;
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
    if (!await saveTitle()) return;
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

  async function unschedulePost() {
    if (!postId || !isScheduled) return;
    setPendingAction("unschedule");
    setError(null);
    try {
      await readApi(`${API_BASE}/posts/${postId}/unschedule`, { method: "POST" });
      setPostStatus("DRAFT");
      setScheduleMode(false);
      setStatusText("Post · draft");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to unschedule this post.");
    } finally {
      setPendingAction(null);
    }
  }

  const topbarActions = !isPublished ? (
    <div className="mq-create-post-top-actions">
      <button type="button" className="mq-secondary-button mq-create-post-schedule-top" disabled={!postId || isBusy} onClick={() => setScheduleMode(true)}><CalendarClock size={16} /> Schedule</button>
      <button type="button" className="mq-primary-button" disabled={!canSubmit} onClick={() => void publishNow()}>{pendingAction === "publish" ? <LoaderCircle className="mq-spin" size={16} /> : <Send size={16} />}<span>Publish now</span></button>
    </div>
  ) : null;

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      subscription={subscription}
      active="posts"
      title={(
        <label className="mq-post-title-editor">
          <input
            aria-label="Post title"
            value={postTitle}
            maxLength={100}
            placeholder={isEditing ? "Untitled post" : "Add a title"}
            disabled={Boolean(initialLoadError) || compositionLocked || isTitleSaving}
            onChange={(event) => setPostTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setPostTitle(lastSavedTitle.current);
                event.currentTarget.blur();
              }
            }}
          />
          {isTitleSaving ? <LoaderCircle className="mq-spin" size={13} aria-label="Saving title" /> : null}
        </label>
      )}
      topbar={{ back: { href: "/posts", label: "Back to posts" }, subtitle: postStatus ? `Post · ${postStatus.toLowerCase()}` : artifact ? "1 artifact attached" : "Attach an artifact to continue", minimal: true }}
      topbarExtra={topbarActions}
      showAccountSelector={false}
      hideMobileNav
    >
      <div className="mq-create-post-page">
        {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}
        {initialLoadError ? <div className="mq-alert mq-alert-error" role="alert">{initialLoadError}</div> : null}

        {initialLoadError ? null : <div className={`mq-create-post-grid mq-mobile-view-${mobileView}`}>
          {artifact ? <MobileComposerSwitcher value={mobileView} onChange={setMobileView} /> : null}

          <section
            id="mq-mobile-compose-panel"
            className="mq-create-post-compose"
            role={artifact ? "tabpanel" : undefined}
            aria-labelledby={artifact ? "mq-mobile-compose-tab" : undefined}
          >
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
                  options={accountOptions.map((item) => ({ value: item.id, label: item.displayName ?? "LinkedIn account" }))}
                />
                {postId ? <small>Account locked to this post</small> : null}
              </label>
            </div>

            {isScheduled ? (
              <div className="mq-alert mq-composer-lock-notice">
                <span>This post is scheduled. Unschedule it before changing the artifact or media.</span>
                <button type="button" className="mq-secondary-button mq-button-small" disabled={isBusy} onClick={() => void unschedulePost()}>{pendingAction === "unschedule" ? "Unscheduling…" : "Unschedule to edit"}</button>
              </div>
            ) : null}
            {isPublished ? <div className="mq-alert mq-composer-lock-notice"><span>This post has been published and is available here as a read-only composition.</span></div> : null}

            {!artifact && !connectedAccounts.length ? (
              <div className="mq-card mq-create-post-empty"><FileText size={24} /><h2>Connect LinkedIn to publish</h2><p>A connected personal account or organization page is required before attaching an artifact.</p><LinkedInConnectButton className="mq-primary-button">Connect LinkedIn</LinkedInConnectButton></div>
            ) : !artifact ? (
              <button type="button" className="mq-card mq-attach-artifact-empty" onClick={() => setIsArtifactPickerOpen(true)}>
                <span><FileText size={22} /></span><strong>Attach an artifact</strong><small>Choose one READY post, poll, or document.</small>
              </button>
            ) : (
              <AttachedArtifactComposition
                artifact={artifact}
                busy={isBusy || compositionLocked}
                canSwap={!compositionLocked}
                onSwap={() => setIsArtifactPickerOpen(true)}
                mediaControls={artifact.type === "POST" ? <PostMediaControls error={mediaError} isBusy={isBusy} readOnly={compositionLocked} media={media} previewUrls={previewUrls} onChooseStock={setStockProvider} onRefresh={() => void refreshMedia()} onRemove={(item) => void removeMedia(item)} onUpload={uploadFiles} /> : undefined}
              />
            )}
          </section>

          <aside className="mq-create-post-sidebar">
            {artifact ? <><span className="mq-mono">_ linkedin preview</span><div className="mq-desktop-composition-preview"><PostCompositionPreview key={`desktop-${artifact.id}:${artifact.version}`} user={user} account={account} artifact={artifact} media={media} previewUrls={previewUrls} /></div><div id="mq-mobile-preview-panel" className="mq-mobile-preview-wrap" role="tabpanel" aria-labelledby="mq-mobile-preview-tab"><PostCompositionPreview key={`mobile-${artifact.id}:${artifact.version}`} user={user} account={account} artifact={artifact} media={media} previewUrls={previewUrls} /></div></> : null}

            {postId && !isPublished ? <PostSchedulingControls canSubmit={canSubmit} isBusy={isBusy} isScheduling={pendingAction === "schedule"} scheduleMode={scheduleMode} scheduleValue={scheduleValue} onChange={setScheduleValue} onConfirm={() => void confirmSchedule()} onModeChange={setScheduleMode} /> : null}
          </aside>
        </div>}

        <span className="mq-create-post-status" aria-live="polite">{statusText}</span>
      </div>

      <PostArtifactPicker isOpen={isArtifactPickerOpen && !compositionLocked} hasMedia={media.length > 0} busy={isBusy} onClose={() => setIsArtifactPickerOpen(false)} onSelect={(item) => void attachArtifact(item)} />
      {stockProvider && !compositionLocked ? <StockImagePicker provider={stockProvider} onClose={() => setStockProvider(null)} onSelect={(image) => void selectStockImage(image)} /> : null}
    </RedesignShell>
  );
}
