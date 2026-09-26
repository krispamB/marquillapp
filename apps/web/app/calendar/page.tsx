import CalendarRedesignClient from "../redesign/CalendarClient";
import { getWorkspaceProps } from "../redesign/workspace";

export default async function CalendarPage() {
  const workspace = await getWorkspaceProps();
  return <CalendarRedesignClient {...workspace} />;
}
