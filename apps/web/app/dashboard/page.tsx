import DashboardRedesignClient from "../redesign/DashboardClient";
import { parseAnalyticsRange } from "../redesign/analytics";
import { getWorkspaceProps } from "../redesign/workspace";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[]; account?: string | string[] }>;
}) {
  const [workspace, query] = await Promise.all([
    getWorkspaceProps({ includeDashboard: true }),
    searchParams,
  ]);
  const account = Array.isArray(query.account) ? query.account[0] : query.account;
  return (
    <DashboardRedesignClient
      {...workspace}
      initialAccountId={account}
      initialRange={parseAnalyticsRange(query.range)}
    />
  );
}
