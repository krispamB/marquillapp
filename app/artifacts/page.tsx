import ArtifactsRedesignClient from "../redesign/ArtifactsClient";
import { getWorkspaceProps } from "../redesign/workspace";

export default async function ArtifactsPage() {
  const workspace = await getWorkspaceProps();
  return <ArtifactsRedesignClient {...workspace} />;
}
