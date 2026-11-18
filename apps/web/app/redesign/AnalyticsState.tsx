"use client";

import { BarChart3, FileText, UserPlus } from "lucide-react";
import LinkedInConnectButton from "./LinkedInConnectButton";
import type { AnalyticsAccess } from "../lib/types";

/** Every way an account's analytics can fail to show: the API's non-ok answers, or a failed request. */
export type AnalyticsStateKind = Exclude<AnalyticsAccess, "ok"> | "failed";

const OFF_BENEFITS = [
  { icon: BarChart3, text: "Impressions and engagement rate, day by day" },
  { icon: UserPlus, text: "New followers" },
  { icon: FileText, text: "How each post published with Marquill performed" },
];

/**
 * One card for any state where the numbers can't be shown: a title, a sentence
 * or two, and exactly one action.
 */
export default function AnalyticsState({
  kind,
  name,
  onRetry,
  onTurnedOn,
}: {
  kind: AnalyticsStateKind;
  name: string;
  /** Reload after the user asks to check again, reconnects, or tries again. */
  onRetry: () => void;
  /** Runs once the analytics consent window closes. */
  onTurnedOn: () => void;
}) {
  let title: string;
  let body: string;
  let action;
  if (kind === "missing_scope") {
    title = `Analytics is off for ${name}`;
    body = "LinkedIn shares a personal profile's numbers only after a separate permission. Posting and scheduling keep working without it.";
    action = (
      <LinkedInConnectButton className="mq-primary-button" flow="analytics" onDone={onTurnedOn}>
        Turn on analytics
      </LinkedInConnectButton>
    );
  } else if (kind === "reconnect_required") {
    title = `Reconnect ${name}`;
    body = "LinkedIn stopped accepting this connection, so its numbers can't be read.";
    action = (
      <LinkedInConnectButton className="mq-primary-button" onDone={onRetry}>
        Reconnect LinkedIn
      </LinkedInConnectButton>
    );
  } else if (kind === "not_admin") {
    title = `You're no longer an admin of ${name}`;
    body = "LinkedIn only shares a page's numbers with its admins. Ask a page admin to add you back, then check again.";
    action = <button type="button" className="mq-secondary-button" onClick={onRetry}>Check again</button>;
  } else {
    title = "LinkedIn isn't responding";
    body = "Nothing is wrong with your account. Try again in a minute.";
    action = <button type="button" className="mq-secondary-button" onClick={onRetry}>Try again</button>;
  }

  return (
    <section className="mq-card mq-analytics-state" role={kind === "failed" ? "alert" : "status"}>
      <h2>{title}</h2>
      <p>{body}</p>
      {kind === "missing_scope" ? (
        <ul className="mq-analytics-state-list" aria-label="What turning it on shows">
          {OFF_BENEFITS.map(({ icon: Icon, text }) => (
            <li key={text}><Icon size={16} aria-hidden="true" />{text}</li>
          ))}
        </ul>
      ) : null}
      <div>{action}</div>
    </section>
  );
}
