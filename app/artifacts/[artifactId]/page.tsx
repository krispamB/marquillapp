import ArtifactConversationClient from "../../redesign/ArtifactConversationClient";
import { getWorkspaceProps } from "../../redesign/workspace";

export default async function ArtifactConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ artifactId: string }>;
  searchParams: Promise<{ run?: string | string[] }>;
}) {
  const [workspace, route, query] = await Promise.all([
    getWorkspaceProps(),
    params,
    searchParams,
  ]);
  const runId = Array.isArray(query.run) ? query.run[0] : query.run;

  return (
    <ArtifactConversationClient
      {...workspace}
      artifactId={route.artifactId}
      initialRunId={runId}
    />
  );
}
