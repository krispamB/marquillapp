"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, Link2, LogOut, RefreshCw, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import RedesignShell from "./Shell";
import LinkedInConnectButton from "./LinkedInConnectButton";
import OrganizationConnectModal from "./OrganizationConnectModal";
import { API_BASE, readApi } from "./api";
import type { ConnectedAccount, SubscriptionTier, UserProfile } from "../lib/types";
import LinkedInIcon from "../../components/brand/LinkedInIcon";
import { getAccountInitials } from "./types";
import {
  getLinkedInAccountAccess,
  hasUsablePersonalLinkedInAccount,
} from "./linkedinAccess";

export default function SettingsRedesignClient({
  user,
  connectedAccounts,
  primaryAccountId,
  subscription,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
  subscription?: SubscriptionTier | null;
}) {
  const { signOut } = useClerk();
  const router = useRouter();
  const [selectedAccountId, setSelectedAccountId] = useState(primaryAccountId ?? connectedAccounts[0]?.id);
  const [accounts, setAccounts] = useState(connectedAccounts);
  const [isOrganizationModalOpen, setIsOrganizationModalOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState<string | null>(null);
  const effectiveSelectedAccountId = accounts.some((account) => account.id === selectedAccountId)
    ? selectedAccountId
    : accounts[0]?.id;
  const hasPersonalAccount = accounts.some((account) => account.accountType !== "ORGANIZATION");
  const hasUsablePersonalAccount = hasUsablePersonalLinkedInAccount(accounts);
  const connectedOrganizationIds = useMemo(
    () => accounts.filter((account) => account.accountType === "ORGANIZATION").map((account) => account.id),
    [accounts],
  );

  useEffect(() => setAccounts(connectedAccounts), [connectedAccounts]);

  async function disconnect(account: ConnectedAccount) {
    setIsDisconnecting(account.id);
    setError(null);
    try {
      await readApi(`${API_BASE}/auth/connected-accounts/${account.id}`, { method: "DELETE" });
      setAccounts((current) => current.filter((item) => item.id !== account.id));
      setMessage(`${account.displayName ?? "LinkedIn account"} disconnected.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to disconnect account.");
    } finally {
      setIsDisconnecting(null);
    }
  }

  return (
    <RedesignShell user={user} accounts={accounts} selectedAccountId={effectiveSelectedAccountId} onSelectAccount={setSelectedAccountId} subscription={subscription} active="settings" title="Settings">
      <div className="mq-page-heading mq-page-heading-compact"><div><span className="mq-eyebrow">Workspace preferences</span><h1>Settings</h1><p>Manage your publishing accounts and workspace defaults.</p></div></div>
      {message ? <div className="mq-alert mq-alert-success">{message}</div> : null}
      {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}

      <section className="mq-settings-grid">
        <div className="mq-card mq-settings-card">
          <div className="mq-card-heading">
            <span className="mq-title"><Link2 size={16} /> Connected accounts</span>
            <span className="mq-mono">{accounts.length} connected</span>
          </div>
          {accounts.length ? accounts.map((account) => {
            const access = getLinkedInAccountAccess(account, accounts);
            const statusClass = access.isExpired
              ? "mq-status-expired"
              : access.isInactive
                ? "mq-status-inactive"
                : "mq-status-published";

            return (
              <div className="mq-setting-row mq-setting-account-row" key={account.id}>
                <span className="mq-account-avatar-wrap">
                  {account.avatarUrl ? (
                    // Avatar hosts are supplied by the backend and are not constrained to configured Next image hosts.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={account.avatarUrl} alt="" className="mq-avatar mq-avatar-md" />
                  ) : (
                    <span className="mq-avatar mq-avatar-md">{getAccountInitials(account) || "IN"}</span>
                  )}
                  <span className="mq-avatar-provider"><LinkedInIcon size={14} /></span>
                </span>

                <span className="mq-setting-account-copy">
                  <span className="mq-setting-account-name">
                    <strong>{account.displayName?.trim() || "LinkedIn account"}</strong>
                    <span className={`mq-status ${statusClass}`}><i />{access.statusLabel}</span>
                  </span>
                  <span className="mq-setting-account-meta">
                    <small>{account.accountType === "ORGANIZATION" ? "Company page" : "Personal account"}</small>
                    {access.detailLabel ? <small className={access.isUrgent ? "is-urgent" : ""}>{access.detailLabel}</small> : null}
                  </span>
                </span>

                <button
                  type="button"
                  className="mq-icon-button mq-icon-danger mq-setting-disconnect"
                  onClick={() => void disconnect(account)}
                  disabled={isDisconnecting === account.id}
                  title={`Disconnect ${account.displayName?.trim() || "LinkedIn account"}`}
                  aria-label={`Disconnect ${account.displayName?.trim() || "LinkedIn account"}`}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          }) : null}

          {!hasPersonalAccount ? (
            <div className="mq-account-empty-state">
              <span className="mq-account-empty-icon" aria-hidden="true"><LinkedInIcon size={21} /></span>
              <div>
                <strong>Connect your LinkedIn account</strong>
                <p>Connect once to publish and schedule posts from any device.</p>
              </div>
              <LinkedInConnectButton
                className="mq-primary-button mq-account-connect-button"
                title="Connect your LinkedIn account"
              >
                <Link2 size={15} /> Connect LinkedIn
              </LinkedInConnectButton>
            </div>
          ) : (
            <div className="mq-setting-account-actions">
              <LinkedInConnectButton
                className="mq-secondary-button mq-button-small"
                title="Re-authenticate your LinkedIn account"
              >
                <RefreshCw size={14} /> Reconnect LinkedIn
              </LinkedInConnectButton>
              <button
                type="button"
                className="mq-secondary-button mq-button-small"
                onClick={() => setIsOrganizationModalOpen(true)}
                disabled={!hasUsablePersonalAccount}
                title={hasUsablePersonalAccount ? "Connect an organization page" : "Reconnect your personal LinkedIn account first"}
              >
                <Link2 size={14} /> Add organization page
              </button>
            </div>
          )}
        </div>

        <div className="mq-card mq-settings-card"><div className="mq-card-heading"><span className="mq-title"><SlidersHorizontal size={16} /> Preferences</span><span className="mq-mono">Unavailable</span></div><div className="mq-preference-row"><span><Bell size={16} /><span><strong>Publishing notifications</strong><small>Get a reminder before scheduled posts publish.</small></span></span><button type="button" className="mq-toggle" disabled aria-label="Publishing notifications unavailable"><i /></button></div><div className="mq-preference-row"><span><ShieldCheck size={16} /><span><strong>Timezone</strong><small>WAT (GMT+1) · inferred from your browser.</small></span></span><button type="button" className="mq-secondary-button mq-button-small" disabled>Set timezone</button></div><p className="mq-missing-note">Notification and timezone preference endpoints are not present in the current backend contract.</p></div>
      </section>

      <section className="mq-card mq-settings-card mq-danger-zone"><div className="mq-card-heading"><span className="mq-title"><LogOut size={16} /> Session</span></div><p>Sign out of Marquill on this device.</p><button type="button" className="mq-secondary-button" onClick={() => void signOut({ redirectUrl: process.env.NEXT_PUBLIC_LANDING || "/sign-in" })}><LogOut size={14} /> Sign out</button></section>
      <p className="mq-missing-note"><Check size={13} /> Account connect and disconnect use the existing LinkedIn endpoints. Preference controls are intentionally marked unavailable until their endpoints exist.</p>
      <OrganizationConnectModal
        isOpen={isOrganizationModalOpen}
        connectedOrganizationIds={connectedOrganizationIds}
        onClose={() => setIsOrganizationModalOpen(false)}
        onConnected={() => router.refresh()}
      />
    </RedesignShell>
  );
}
