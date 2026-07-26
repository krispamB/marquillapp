"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, UserRound, X } from "lucide-react";
import LinkedInIcon from "../../components/brand/LinkedInIcon";
import type { ConnectedAccount } from "../lib/types";
import LinkedInConnectButton from "./LinkedInConnectButton";
import { getAccountInitials } from "./types";

export function activeConnectedAccounts(accounts: ConnectedAccount[]) {
  return accounts.filter((account) => account.isActive !== false);
}

export default function ConnectedAccountPicker({
  isOpen,
  accounts,
  isCreating,
  error,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  accounts: ConnectedAccount[];
  isCreating: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (accountId: string) => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const closePicker = useCallback(() => {
    setSelectedAccountId("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCreating) {
        closePicker();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])',
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [closePicker, isCreating, isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="mq-attach-account-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isCreating) closePicker();
      }}
    >
      <section
        ref={dialogRef}
        className="mq-attach-account-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attach-account-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <span className="mq-eyebrow">Create post</span>
            <h2 id="attach-account-title">
              {accounts.length ? "Choose a LinkedIn account" : "Connect LinkedIn to continue"}
            </h2>
            <p>
              {accounts.length
                ? "The selected account will be permanently attached to this draft."
                : "A connected personal account or organization page is required to create a post."}
            </p>
          </div>
          <button
            type="button"
            className="mq-icon-button"
            onClick={closePicker}
            disabled={isCreating}
            aria-label="Close account picker"
          >
            <X size={18} />
          </button>
        </header>

        {accounts.length ? (
          <>
            <div className="mq-attach-account-list">
              {accounts.map((account) => {
                const selected = selectedAccountId === account.id;
                return (
                  <button
                    type="button"
                    className={`mq-attach-account-option${selected ? " is-selected" : ""}`}
                    key={account.id}
                    disabled={isCreating}
                    aria-pressed={selected}
                    onClick={() => setSelectedAccountId(account.id)}
                  >
                    <span className="mq-account-avatar-wrap">
                      {account.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={account.avatarUrl} alt="" className="mq-avatar mq-avatar-md" />
                      ) : (
                        <span className="mq-avatar mq-avatar-md">
                          {getAccountInitials(account) || <UserRound size={15} />}
                        </span>
                      )}
                      <span className="mq-avatar-provider"><LinkedInIcon size={14} /></span>
                    </span>
                    <span className="mq-account-copy">
                      <strong>{account.displayName?.trim() || "LinkedIn account"}</strong>
                      <small>{account.accountType === "ORGANIZATION" ? "Organization page" : "Personal account"}</small>
                    </span>
                    <span className="mq-attach-account-check" aria-hidden="true">
                      {selected ? <Check size={14} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
            {error ? <p className="mq-attach-account-error" role="alert">{error}</p> : null}
            <footer>
              <button
                type="button"
                className="mq-secondary-button"
                onClick={closePicker}
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mq-primary-button"
                onClick={() => onConfirm(selectedAccountId)}
                disabled={!selectedAccountId || isCreating}
              >
                {isCreating ? "Creating draft…" : "Continue to post"}
              </button>
            </footer>
          </>
        ) : (
          <div className="mq-attach-account-empty">
            <span><LinkedInIcon size={24} /></span>
            <p>Connect LinkedIn, then return here to attach this artifact.</p>
            <LinkedInConnectButton className="mq-primary-button">
              Connect LinkedIn
            </LinkedInConnectButton>
          </div>
        )}
      </section>
    </div>
  );
}
