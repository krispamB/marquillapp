import SettingsRedesignClient from "../redesign/SettingsClient";
import { getWorkspaceProps } from "../redesign/workspace";
import { getServerAuth, getUsage } from "../lib/session";

export default async function SettingsPage() {
  const [workspace, usage] = await Promise.all([
    getWorkspaceProps(),
    getServerAuth().then(getUsage),
  ]);
  return <SettingsRedesignClient {...workspace} initialUsage={usage} />;
}
