import BillingRedesignClient from "../redesign/BillingClient";
import { getWorkspaceProps } from "../redesign/workspace";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const [workspace, { checkout }] = await Promise.all([getWorkspaceProps(), searchParams]);
  return <BillingRedesignClient {...workspace} checkoutCompleted={checkout === "success"} />;
}
