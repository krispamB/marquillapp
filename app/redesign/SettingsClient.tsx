"use client";

import { useEffect, useState } from "react";
import { Bell, Check, Link2, LogOut, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import RedesignShell from "./Shell";
import LinkedInConnectButton from "./LinkedInConnectButton";
import { API_BASE, readApi } from "./api";
import type { ConnectedAccount, UserProfile } from "../lib/types";
import LinkedInIcon from "../../components/brand/LinkedInIcon";

export default function SettingsRedesignClient({
  user,
  connectedAccounts,
  primaryAccountId,
}: {
  user: UserProfile;
  connectedAccounts: ConnectedAccount[];
  primaryAccountId?: string;
}) {
  const { signOut } = useClerk();
  const [selectedAccountId, setSelectedAccountId] = useState(primaryAccountId ?? connectedAccounts[0]?.id);
  const [accounts, setAccounts] = useState(connectedAccounts);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState<string | null>(null);
  const effectiveSelectedAccountId = accounts.some((account) => account.id === selectedAccountId)
    ? selectedAccountId
    : accounts[0]?.id;

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
    <RedesignShell user={user} accounts={accounts} selectedAccountId={effectiveSelectedAccountId} onSelectAccount={setSelectedAccountId} active="settings" title="Settings">
      <div className="mq-page-heading mq-page-heading-compact"><div><span className="mq-eyebrow">Workspace preferences</span><h1>Settings</h1><p>Manage your publishing accounts and workspace defaults.</p></div></div>
      {message ? <div className="mq-alert mq-alert-success">{message}</div> : null}
      {error ? <div className="mq-alert mq-alert-error">{error}</div> : null}

      <section className="mq-settings-grid">
        <div className="mq-card mq-settings-card"><div className="mq-card-heading"><span className="mq-title"><Link2 size={16} /> Connected accounts</span><span className="mq-mono">{accounts.length} connected</span></div>{accounts.length ? accounts.map((account) => <div className="mq-setting-row" key={account.id}><span className="mq-post-avatar">{account.displayName?.slice(0, 2).toUpperCase() ?? "IN"}</span><span className="mq-row-copy"><strong>{account.displayName ?? "LinkedIn account"}</strong><small>{account.accountType === "ORGANIZATION" ? "Company page" : "Personal account"}</small></span><span className="mq-status mq-status-published"><i />Active</span><span className="mq-settings-provider"><LinkedInIcon /></span><button type="button" className="mq-icon-button mq-icon-danger" onClick={() => void disconnect(account)} disabled={isDisconnecting === account.id} title="Disconnect account"><Trash2 size={15} /></button></div>) : <p className="mq-empty">No LinkedIn account connected.</p>}<LinkedInConnectButton className="mq-secondary-button mq-button-small mq-setting-connect"><Link2 size={14} /> Connect another account</LinkedInConnectButton></div>

        <div className="mq-card mq-settings-card"><div className="mq-card-heading"><span className="mq-title"><SlidersHorizontal size={16} /> Preferences</span><span className="mq-mono">Unavailable</span></div><div className="mq-preference-row"><span><Bell size={16} /><span><strong>Publishing notifications</strong><small>Get a reminder before scheduled posts publish.</small></span></span><button type="button" className="mq-toggle" disabled aria-label="Publishing notifications unavailable"><i /></button></div><div className="mq-preference-row"><span><ShieldCheck size={16} /><span><strong>Timezone</strong><small>WAT (GMT+1) · inferred from your browser.</small></span></span><button type="button" className="mq-secondary-button mq-button-small" disabled>Set timezone</button></div><p className="mq-missing-note">Notification and timezone preference endpoints are not present in the current backend contract.</p></div>
      </section>

      <section className="mq-card mq-settings-card mq-danger-zone"><div className="mq-card-heading"><span className="mq-title"><LogOut size={16} /> Session</span></div><p>Sign out of Marquill on this device.</p><button type="button" className="mq-secondary-button" onClick={() => void signOut({ redirectUrl: process.env.NEXT_PUBLIC_LANDING || "/sign-in" })}><LogOut size={14} /> Sign out</button></section>
      <p className="mq-missing-note"><Check size={13} /> Account connect and disconnect use the existing LinkedIn endpoints. Preference controls are intentionally marked unavailable until their endpoints exist.</p>
    </RedesignShell>
  );
}
