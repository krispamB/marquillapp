"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, CalendarClock, ImagePlus, PenLine, RefreshCw, Send, Sparkles, Upload, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import RedesignShell from "./Shell";
import { API_BASE, jsonRequest, readApi, sleep } from "./api";
import LinkedInPreview from "./LinkedInPreview";
import SchedulePicker, { getDefaultScheduleDate, localDateTimeValue } from "./SchedulePicker";
import StockImagePicker from "./StockImagePicker";
import MarquillMark from "../../components/brand/MarquillMark";
import MarquillSelect from "../../components/ui/MarquillSelect";
import { StylePreset } from "../lib/types";
import type { ConnectedAccount, CreateDraftRequest, CreateDraftResponse, DraftStatusResponse, PostDetailResponse, UserProfile } from "../lib/types";

type ComposerMode = "create" | "edit";
type Action = "draft" | "publish" | "schedule";

const draftBodyPlaceholder = "Give Mark a direction and he will turn it into a post in your voice.";

function statusLabel(state?: string) {
  const value = String(state ?? "").toLowerCase();
  if (value.includes("fail")) return "Mark could not finish this draft.";
  if (value.includes("complete") || value.includes("success") || value.includes("ready")) return "Mark finished the draft.";
  return "Mark is drafting your post…";
}

export default function ComposerRedesignClient({
  user,
  connectedAccounts,
  primaryAccountId,
  mode,
  initialPostId,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  mode: ComposerMode;
  initialPostId?: string;
}) {
  const router = useRouter();
  const [selectedAccountId, setSelectedAccountId] = useState(primaryAccountId ?? connectedAccounts[0]?.id);
  const [postId, setPostId] = useState(initialPostId);
  const [postType, setPostType] = useState<"quickPostLinkedin" | "insightPostLinkedin">("insightPostLinkedin");
  const [stylePreset, setStylePreset] = useState<CreateDraftRequest["stylePreset"]>(StylePreset.PROFESSIONAL);
  const [prompt, setPrompt] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [content, setContent] = useState("");
  const [scheduleValue, setScheduleValue] = useState(localDateTimeValue(getDefaultScheduleDate()));
  const [scheduleMode, setScheduleMode] = useState<"now" | "schedule">("now");
  const [isLoadingPost, setIsLoadingPost] = useState(mode === "edit");
  const [pendingAction, setPendingAction] = useState<Action | "generate" | "upload" | null>(null);
  const [statusText, setStatusText] = useState(mode === "edit" ? "Loading saved draft…" : "Draft · not started");
  const [error, setError] = useState<string | null>(null);
  const [mediaName, setMediaName] = useState<string | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<"image" | "video" | null>(null);
  const [stockProvider, setStockProvider] = useState<"pexels" | "unsplash" | null>(null);

  const account = useMemo(
    () => connectedAccounts.find((item) => item.id === selectedAccountId) ?? connectedAccounts[0],
    [connectedAccounts, selectedAccountId],
  );

  useEffect(() => {
    if (!initialPostId) return;
    const controller = new AbortController();
    readApi<PostDetailResponse>(`${API_BASE}/posts/${initialPostId}`, { signal: controller.signal })
      .then((response) => {
        setContent(response?.data?.content ?? "");
        setPostType(response?.data?.type?.toLowerCase().includes("quick") ? "quickPostLinkedin" : "insightPostLinkedin");
        setStatusText(response?.data?.status ? `Draft · ${response.data.status.toLowerCase()}` : "Draft · saved");
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) {
          setError(reason instanceof Error ? reason.message : "Unable to load this post.");
        }
      })
      .finally(() => setIsLoadingPost(false));
    return () => controller.abort();
  }, [initialPostId]);

  useEffect(() => () => {
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
  }, [mediaPreviewUrl]);

  async function generateDraft() {
    if (!selectedAccountId) {
      setError("Connect a LinkedIn account before generating a draft.");
      return;
    }
    if (!prompt.trim()) {
      setError("Add a direction for Mark first.");
      return;
    }
    setPendingAction("generate");
    setError(null);
    setStatusText("Mark is starting your draft…");
    try {
      const input = [prompt.trim(), youtubeUrl.trim() ? `Research this YouTube link: ${youtubeUrl.trim()}` : ""].filter(Boolean).join("\n\n");
      const created = await readApi<CreateDraftResponse>(
        `${API_BASE}/posts/${selectedAccountId}/draft`,
        jsonRequest({ input, contentType: postType, stylePreset }, { method: "POST" }),
      );
      const createdId = created?.data;
      if (!createdId) throw new Error("The draft service did not return a post ID.");
      setPostId(createdId);

      let completed = false;
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await sleep(900);
        const status = await readApi<DraftStatusResponse>(`${API_BASE}/posts/${createdId}/status`);
        const state = `${status?.data?.state ?? ""} ${status?.data?.status ?? ""}`.toLowerCase();
        setStatusText(statusLabel(state));
        if (state.includes("fail")) throw new Error("Mark could not generate this draft.");
        if (state.includes("complete") || state.includes("success") || state.includes("ready")) {
          completed = true;
          break;
        }
      }
      if (!completed) throw new Error("Draft generation is taking longer than expected. Open Posts to check its status.");
      const detail = await readApi<PostDetailResponse>(`${API_BASE}/posts/${createdId}`);
      setContent(detail?.data?.content ?? "");
      setStatusText("Draft · autosaved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to generate a draft.");
      setStatusText("Draft · needs attention");
    } finally {
      setPendingAction(null);
    }
  }

  async function saveContent() {
    if (!postId) throw new Error("Generate a draft before saving it.");
    if (!content.trim()) throw new Error("Add post content before saving.");
    await readApi(`${API_BASE}/posts/${postId}`, jsonRequest({ content }, { method: "PATCH" }));
    setStatusText("Draft · autosaved just now");
  }

  async function runAction(action: Action) {
    setPendingAction(action);
    setError(null);
    try {
      await saveContent();
      if (action === "publish") {
        await readApi(`${API_BASE}/posts/${postId}/publish`, { method: "POST" });
      }
      if (action === "schedule") {
        const scheduledDate = new Date(scheduleValue);
        if (Number.isNaN(scheduledDate.getTime())) throw new Error("Pick a valid date and time before scheduling.");
        if (scheduledDate.getTime() < Date.now() + 5 * 60 * 1000) throw new Error("Choose a time at least 5 minutes in the future.");
        await readApi(`${API_BASE}/posts/${postId}/schedule`, jsonRequest({ scheduledTime: scheduledDate.toISOString() }, { method: "POST" }));
      }
      router.push("/posts");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save this post.");
    } finally {
      setPendingAction(null);
    }
  }

  async function uploadMedia(file: File) {
    if (!postId) throw new Error("Generate a draft before adding media.");
    setPendingAction("upload");
    setError(null);
    try {
      const body = new FormData();
      body.append("files", file);
      await readApi(`${API_BASE}/posts/${postId}/media`, { method: "PUT", body });
      setMediaName(file.name);
      setMediaPreviewUrl(URL.createObjectURL(file));
      setMediaType(file.type.startsWith("video/") ? "video" : "image");
      setStatusText("Media attached");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Image upload failed.");
      return false;
    } finally {
      setPendingAction(null);
    }
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadMedia(file);
  }

  async function selectStockImage(image: { downloadUrl: string; alt: string }) {
    try {
      const response = await fetch(image.downloadUrl);
      if (!response.ok) throw new Error("Unable to download the selected stock image.");
      const imageBlob = await response.blob();
      if (await uploadMedia(new File([imageBlob], "stock-image.jpg", { type: imageBlob.type || "image/jpeg" }))) {
        setStockProvider(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to add the selected image.");
    }
  }

  return (
    <RedesignShell
      user={user}
      accounts={connectedAccounts}
      selectedAccountId={selectedAccountId}
      onSelectAccount={setSelectedAccountId}
      active="posts"
      title="New post"
      topbarExtra={<Link href="/posts" className="mq-back-link"><ArrowLeft size={15} /> Posts</Link>}
    >
      <div className="mq-composer-heading">
        <div><span className="mq-eyebrow">{mode === "edit" ? "Edit post" : "New post"}</span><h1>Chat with Mark <span>→ draft → preview → publish</span></h1><p>{statusText}</p></div>
        <div className="mq-composer-actions"><button type="button" className="mq-secondary-button" disabled={!postId || pendingAction !== null} onClick={() => void runAction("draft")}>Save draft</button><button type="button" className="mq-secondary-button" disabled={!postId || pendingAction !== null} onClick={() => { setScheduleMode("schedule"); void runAction("schedule"); }}><CalendarClock size={15} /> Schedule</button><button type="button" className="mq-primary-button" disabled={!postId || pendingAction !== null} onClick={() => void runAction("publish")}><Send size={15} /> Publish now</button></div>
      </div>

      {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}
      {isLoadingPost ? <div className="mq-alert">Loading saved post…</div> : null}

      <div className="mq-composer-grid">
        <section className="mq-composer-editor">
          <div className="mq-composer-controls">
            <div className="mq-segmented mq-segmented-small">
              <button type="button" className={postType === "quickPostLinkedin" ? "is-active" : ""} onClick={() => setPostType("quickPostLinkedin")}><PenLine size={14} /> Quick</button>
              <button type="button" className={postType === "insightPostLinkedin" ? "is-active" : ""} onClick={() => setPostType("insightPostLinkedin")}><Video size={14} /> Insight</button>
            </div>
            <MarquillSelect className="mq-composer-select" value={stylePreset} onChange={(value) => setStylePreset(value as StylePreset)} ariaLabel="Writing style" options={[{ value: StylePreset.PROFESSIONAL, label: "Tone: Professional" }, { value: StylePreset.STORYTELLING, label: "Tone: Storytelling" }, { value: StylePreset.EDUCATIONAL, label: "Tone: Educational" }, { value: StylePreset.BOLD, label: "Tone: Bold" }, { value: StylePreset.FOUNDER, label: "Tone: Founder" }]} />
          </div>

          <div className="mq-card mq-chat-card">
            <div className="mq-chat-label"><MarquillMark size={22} theme="light" className="mq-ask-mark-small-svg" title="" /><span className="mq-mono">mark · conversation</span></div>
            <textarea className="mq-chat-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Turn our Series A closing into an insight post. Keep my voice." rows={3} />
            <div className="mq-research-row"><input className="mq-input" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="Add a YouTube link for research (optional)" /><button type="button" className="mq-chip-button" onClick={() => void generateDraft()} disabled={pendingAction !== null}><Sparkles size={14} /> {pendingAction === "generate" ? "Mark is drafting…" : "Generate"}</button></div>
            <div className="mq-chat-status"><span className="mq-live-dot" /> {statusText}</div>
          </div>

          <div className="mq-card mq-editor-card">
            <div className="mq-editor-toolbar"><strong>Draft</strong><button type="button" className="mq-chip-button" onClick={() => void generateDraft()} disabled={pendingAction !== null || !prompt.trim()}><RefreshCw size={12} /> Regenerate</button><span className="mq-mono mq-counter">{content.length} / 3000</span></div>
            <textarea className="mq-post-editor" value={content} onChange={(event) => setContent(event.target.value)} placeholder={draftBodyPlaceholder} aria-label="Post draft" />
            <div className="mq-media-row"><div className="mq-media-placeholder"><ImagePlus size={18} /><span>{mediaName ?? "Add media"}</span></div><label className="mq-chip-button"><Upload size={14} /> Upload<input type="file" accept="image/*,video/*" onChange={uploadFile} hidden disabled={!postId || pendingAction !== null} /></label><button type="button" className="mq-chip-button mq-stock-button" onClick={() => setStockProvider("pexels")} disabled={!postId || pendingAction !== null}><Image src="/pexels.svg" alt="" width={15} height={15} /> Pexels</button><button type="button" className="mq-chip-button mq-stock-button" onClick={() => setStockProvider("unsplash")} disabled={!postId || pendingAction !== null}><Image src="/unsplash.svg" alt="" width={15} height={15} /> Unsplash</button></div>
          </div>
        </section>

        <aside className="mq-composer-preview">
          <span className="mq-mono">_ linkedin preview</span>
          <LinkedInPreview user={user} account={account} content={content} mediaName={mediaName} mediaPreviewUrl={mediaPreviewUrl} mediaType={mediaType} />

          <div className="mq-card mq-schedule-card">
            <h2>When should Mark publish?</h2>
            <div className="mq-segmented mq-segmented-small">
              <button type="button" className={scheduleMode === "now" ? "is-active" : ""} onClick={() => setScheduleMode("now")}>Publish now</button>
              <button type="button" className={scheduleMode === "schedule" ? "is-active" : ""} onClick={() => setScheduleMode("schedule")}>Schedule</button>
            </div>
            {scheduleMode === "schedule" ? <>
              <SchedulePicker value={scheduleValue} onChange={setScheduleValue} disabled={pendingAction !== null} />
              <p className="mq-schedule-card-note">Pick a date and time in your local timezone, then use Schedule above. Mark suggests a weekday morning for your audience.</p>
            </> : <p className="mq-publish-now-note"><Send size={14} /> Ready to publish as soon as you click Publish now.</p>}
          </div>
        </aside>
      </div>
      {stockProvider ? <StockImagePicker provider={stockProvider} onClose={() => setStockProvider(null)} onSelect={(image) => void selectStockImage(image)} /> : null}
    </RedesignShell>
  );
}
