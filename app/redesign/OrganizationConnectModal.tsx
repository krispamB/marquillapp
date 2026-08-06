"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Check, LockKeyhole, X } from "lucide-react";
import { API_BASE, jsonRequest, readApi } from "./api";
import {
  FeatureLimitExceededError,
  type ConnectOrgsResponse,
  type LinkedInOrg,
  type ListOrgsResponse,
} from "../lib/types";

type Phase = "loading" | "select" | "connecting" | "success" | "empty" | "all-connected" | "limit-exceeded" | "load-error" | "connect-error";

export default function OrganizationConnectModal({
  isOpen,
  connectedOrganizationIds,
  onClose,
  onConnected,
}: {
  isOpen: boolean;
  connectedOrganizationIds: string[];
  onClose: () => void;
  onConnected: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [organizations, setOrganizations] = useState<LinkedInOrg[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [limitDetails, setLimitDetails] = useState({ tierName: "", message: "" });

  const showFeatureLimit = useCallback((reason: FeatureLimitExceededError) => {
    setLimitDetails({ tierName: reason.tier.name, message: reason.upgradeHint });
    setPhase("limit-exceeded");
  }, []);

  const loadOrganizations = useCallback(async () => {
    setPhase("loading");
    setError("");
    setLimitDetails({ tierName: "", message: "" });
    setSelectedIds(new Set());
    try {
      const response = await readApi<ListOrgsResponse>(`${API_BASE}/auth/linkedin/orgs`);
      const available = Array.isArray(response?.data) ? response.data : [];
      setOrganizations(available);
      if (!available.length) setPhase("empty");
      else if (available.every((organization) => connectedOrganizationIds.includes(organization.id))) setPhase("all-connected");
      else setPhase("select");
    } catch (reason) {
      if (reason instanceof FeatureLimitExceededError) {
        showFeatureLimit(reason);
        return;
      }
      setError(reason instanceof Error ? reason.message : "Unable to load your LinkedIn organization pages.");
      setPhase("load-error");
    }
  }, [connectedOrganizationIds, showFeatureLimit]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => void loadOrganizations(), 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, loadOrganizations]);

  const closeModal = useCallback(() => {
    if (phase === "success") onConnected();
    onClose();
  }, [onClose, onConnected, phase]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeModal, isOpen]);

  function toggleOrganization(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function connectOrganizations() {
    if (!selectedIds.size) return;
    setPhase("connecting");
    setError("");
    try {
      await readApi<ConnectOrgsResponse>(
        `${API_BASE}/auth/linkedin/orgs`,
        jsonRequest({ organizationIds: [...selectedIds] }, { method: "POST" }),
      );
      setPhase("success");
    } catch (reason) {
      if (reason instanceof FeatureLimitExceededError) {
        showFeatureLimit(reason);
        return;
      }
      setError(reason instanceof Error ? reason.message : "Unable to connect the selected organization pages.");
      setPhase("connect-error");
    }
  }

  if (!isOpen) return null;

  const selectedCount = selectedIds.size;

  return (
    <div className="mq-org-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }}>
      <section className="mq-org-modal" role="dialog" aria-modal="true" aria-labelledby="mq-org-title">
        <button type="button" className="mq-org-close" onClick={closeModal} aria-label="Close organization picker">
          <X size={21} />
          <span>ESC</span>
        </button>

        {phase === "loading" || phase === "connecting" ? (
          <div className="mq-org-state">
            <span className="mq-org-spinner" />
            <p>{phase === "loading" ? "Loading your organization pages…" : "Connecting your pages…"}</p>
          </div>
        ) : null}

        {phase === "select" ? (
          <>
            <header className="mq-org-header">
              <h2 id="mq-org-title">Connect an Organization Page</h2>
              <p>Select one or more LinkedIn Company Pages you manage.</p>
            </header>
            <div className="mq-org-list">
              {organizations.map((organization) => {
                const isConnected = connectedOrganizationIds.includes(organization.id);
                const isSelected = selectedIds.has(organization.id);
                return (
                  <button
                    type="button"
                    key={organization.id}
                    className={`mq-org-option ${isSelected ? "is-selected" : ""}`}
                    disabled={isConnected}
                    onClick={() => toggleOrganization(organization.id)}
                  >
                    {organization.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={organization.logoUrl} alt="" className="mq-org-avatar" />
                    ) : (
                      <span className="mq-org-avatar">{organization.name.slice(0, 1).toUpperCase()}</span>
                    )}
                    <span className="mq-org-copy">
                      <strong>{organization.name}</strong>
                      <small>{organization.role.toLowerCase()}</small>
                    </span>
                    {isConnected ? <span className="mq-org-connected">Connected</span> : (
                      <span className="mq-org-radio" aria-hidden="true">{isSelected ? <Check size={13} /> : null}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <button type="button" className="mq-org-submit" disabled={!selectedCount} onClick={() => void connectOrganizations()}>
              Connect {selectedCount ? `${selectedCount} page${selectedCount === 1 ? "" : "s"}` : "pages"}
            </button>
          </>
        ) : null}

        {phase === "empty" || phase === "all-connected" ? (
          <div className="mq-org-state">
            <span className="mq-org-state-icon"><Building2 size={21} /></span>
            <h2 id="mq-org-title">{phase === "empty" ? "No pages found" : "All pages connected"}</h2>
            <p>{phase === "empty" ? "Your LinkedIn account does not manage any Company Pages, or LinkedIn returned none." : "Every organization page managed by this LinkedIn account is already connected."}</p>
            <button type="button" className="mq-secondary-button" onClick={closeModal}>Close</button>
          </div>
        ) : null}

        {phase === "success" ? (
          <div className="mq-org-state">
            <span className="mq-org-state-icon is-success"><Check size={22} /></span>
            <h2 id="mq-org-title">{selectedCount === 1 ? "Page connected" : "Pages connected"}</h2>
            <p>Your organization {selectedCount === 1 ? "page is" : "pages are"} now available in the account switcher.</p>
            <button type="button" className="mq-org-submit" onClick={closeModal}>Done</button>
          </div>
        ) : null}

        {phase === "limit-exceeded" ? (
          <div className="mq-org-state mq-org-limit-state">
            <span className="mq-org-state-icon is-limit"><LockKeyhole size={22} /></span>
            <span className="mq-org-plan-label">{limitDetails.tierName || "Current"} plan</span>
            <h2 id="mq-org-title">Upgrade to connect company pages</h2>
            <p>{limitDetails.message || "Your current plan does not include LinkedIn company pages."}</p>
            <div className="mq-org-actions">
              <button type="button" className="mq-secondary-button" onClick={closeModal}>Not now</button>
              <Link href="/billing#change-plan" className="mq-org-submit" onClick={closeModal}>View upgrade options</Link>
            </div>
          </div>
        ) : null}

        {phase === "load-error" || phase === "connect-error" ? (
          <div className="mq-org-state">
            <h2 id="mq-org-title">{phase === "load-error" ? "Couldn’t load organization pages" : "Couldn’t connect organization pages"}</h2>
            <p className="mq-org-error" role="alert">{error}</p>
            <div className="mq-org-actions">
              <button type="button" className="mq-secondary-button" onClick={closeModal}>Cancel</button>
              <button type="button" className="mq-org-submit" onClick={() => void (phase === "load-error" ? loadOrganizations() : connectOrganizations())}>Try again</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
