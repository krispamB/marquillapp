import DashboardRedesignClient from "../redesign/DashboardClient";
import { getWorkspaceProps } from "../redesign/workspace";

export default async function DashboardPage() {
  const workspace = await getWorkspaceProps();
  return <DashboardRedesignClient {...workspace} />;
}
