import BillingRedesignClient from "../redesign/BillingClient";
import { getWorkspaceProps } from "../redesign/workspace";

export default async function BillingPage() {
  const workspace = await getWorkspaceProps();
  return <BillingRedesignClient {...workspace} />;
}
