import SettingsRedesignClient from "../redesign/SettingsClient";
import { getWorkspaceProps } from "../redesign/workspace";

export default async function SettingsPage() {
  const workspace = await getWorkspaceProps();
  return <SettingsRedesignClient {...workspace} />;
}
