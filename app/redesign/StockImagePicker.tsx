"use client";
/* eslint-disable @next/next/no-img-element -- stock-provider URLs are dynamic and cannot use Next image optimization. */

import { FormEvent, useEffect, useRef, useState } from "react";
import { ChevronDown, ImageOff, Search, X } from "lucide-react";
import styles from "./StockImagePicker.module.css";

type Provider = "pexels" | "unsplash";

type StockImage = {
  id: string;
  alt: string;
  author: string;
  authorUrl: string;
  previewUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
};

type Orientation = "any" | "landscape" | "portrait" | "square";

type ProviderAdapter = {
  name: string;
  iconUrl: string;
  attributionUrl: string;
  getKey: () => string | undefined;
  search: (key: string, query: string, orientation: Orientation, signal: AbortSignal) => Promise<StockImage[]>;
};

const PROVIDERS: Record<Provider, ProviderAdapter> = {
  unsplash: {
    name: "Unsplash",
    iconUrl: "/unsplash.svg",
    attributionUrl: "https://unsplash.com",
    getKey: () => process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY?.trim(),
    async search(key, query, orientation, signal) {
    const params = new URLSearchParams({ query, per_page: "18" });
    if (orientation !== "any") params.set("orientation", orientation === "square" ? "squarish" : orientation);
    const response = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
      headers: { Authorization: `Client-ID ${key}` }, signal,
    });
    if (!response.ok) throw new Error("Unable to load Unsplash images.");
    const payload = await response.json() as { results?: Array<{ id: string; width?: number; height?: number; alt_description?: string | null; urls?: { small?: string; regular?: string }; user?: { name?: string; links?: { html?: string } } }> };
    return (payload.results ?? []).flatMap((image) => {
      const previewUrl = image.urls?.small;
      const downloadUrl = image.urls?.regular ?? previewUrl;
      if (!previewUrl || !downloadUrl) return [];
      return [{ id: image.id, alt: image.alt_description ?? "Unsplash image", author: image.user?.name ?? "Unsplash", authorUrl: image.user?.links?.html ?? "https://unsplash.com", previewUrl, downloadUrl, width: image.width ?? 640, height: image.height ?? 480 }];
    });
    },
  },
  pexels: {
    name: "Pexels",
    iconUrl: "/pexels.svg",
    attributionUrl: "https://www.pexels.com",
    getKey: () => process.env.NEXT_PUBLIC_PEXELS_ACCESS_KEY?.trim(),
    async search(key, query, orientation, signal) {
      const params = new URLSearchParams({ query, per_page: "18" });
      if (orientation !== "any") params.set("orientation", orientation);
      const response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
        headers: { Authorization: key }, signal,
      });
      if (!response.ok) throw new Error("Unable to load Pexels images.");
      const payload = await response.json() as { photos?: Array<{ id: number; width?: number; height?: number; alt?: string; src?: { medium?: string; large?: string; large2x?: string }; photographer?: string; photographer_url?: string }> };
      return (payload.photos ?? []).flatMap((image) => {
        const previewUrl = image.src?.medium ?? image.src?.large;
        const downloadUrl = image.src?.large2x ?? image.src?.large ?? previewUrl;
        if (!previewUrl || !downloadUrl) return [];
        return [{ id: String(image.id), alt: image.alt ?? "Pexels image", author: image.photographer ?? "Pexels", authorUrl: image.photographer_url ?? "https://www.pexels.com", previewUrl, downloadUrl, width: image.width ?? 640, height: image.height ?? 480 }];
      });
    },
  },
};

async function searchImages(provider: Provider, query: string, orientation: Orientation, signal: AbortSignal): Promise<StockImage[]> {
  const adapter = PROVIDERS[provider];
  const key = adapter.getKey();
  if (!key) throw new Error(`${adapter.name} is not configured. Add its public access key to enable search.`);
  return adapter.search(key, query, orientation, signal);
}

export default function StockImagePicker({ provider, onClose, onSelect }: { provider: Provider; onClose: () => void; onSelect: (image: StockImage) => void }) {
  const [query, setQuery] = useState("business");
  const [images, setImages] = useState<StockImage[]>([]);
  const [orientation, setOrientation] = useState<Orientation>("any");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  async function runSearch(searchQuery = query, searchOrientation = orientation) {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      setImages(await searchImages(provider, searchQuery.trim() || "business", searchOrientation, controller.signal));
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Unable to load images.");
    } finally {
      if (requestRef.current === controller) setIsLoading(false);
    }
  }

  useEffect(() => {
    void runSearch("business", "any");
    return () => requestRef.current?.abort();
  }, [provider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => returnFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]',
      )).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch();
  }

  const providerAdapter = PROVIDERS[provider];
  const label = providerAdapter.name;
  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section ref={dialogRef} className={styles.picker} role="dialog" aria-modal="true" aria-labelledby="mq-stock-picker-title">
        <header className={styles.header}>
          <span className={styles.brand}>
            <img src={providerAdapter.iconUrl} alt="" />
            <strong id="mq-stock-picker-title">{label}</strong>
          </span>
          <button type="button" className={styles.close} onClick={onClose} aria-label={`Close ${label} search`}><X size={18} /></button>
        </header>
        <form className={styles.searchForm} onSubmit={submit}>
          <label className={styles.searchField}>
            <Search size={18} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${label} photos`} autoFocus aria-label={`Search ${label} photos`} />
            {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button> : null}
          </label>
          <button className={styles.searchButton} type="submit" disabled={isLoading}>Search</button>
        </form>
        <div className={styles.filter}>
          <label>
            <span className={styles.visuallyHidden}>Orientation</span>
            <select value={orientation} onChange={(event) => { const next = event.target.value as Orientation; setOrientation(next); void runSearch(query, next); }}>
              <option value="any">Any orientation</option>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
              <option value="square">Square</option>
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
        </div>
        <div className={styles.results} aria-busy={isLoading}>
          {error ? <div className={`${styles.state} ${styles.error}`}><ImageOff size={22} /><p>{error}</p><button type="button" onClick={() => void runSearch()}>Try again</button></div> : null}
          {isLoading ? Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.skeleton} aria-hidden="true"><span /><small /></div>) : null}
          {!isLoading && !error && images.length === 0 ? <div className={styles.state}><ImageOff size={22} /><p>No images found. Try another search.</p></div> : null}
          {!isLoading && !error ? images.map((image) => (
            <article key={image.id} className={styles.card}>
              <button type="button" className={styles.imageButton} onClick={() => onSelect(image)} aria-label={`Use image: ${image.alt}`}>
                <img src={image.previewUrl} alt={image.alt} width={image.width} height={image.height} />
                <span className={styles.useImage}>Use image</span>
              </button>
              <small className={styles.attribution}><a href={image.authorUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{image.author}</a> for <a href={providerAdapter.attributionUrl} target="_blank" rel="noreferrer">{label}</a></small>
            </article>
          )) : null}
        </div>
      </section>
    </div>
  );
}
