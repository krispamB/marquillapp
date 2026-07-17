import ArtifactStudioClient from "../../redesign/ArtifactStudioClient";
import type { ArtifactType } from "../../redesign/artifactTypes";
import { getWorkspaceProps } from "../../redesign/workspace";

const artifactTypes = new Set<ArtifactType>(["POST", "POLL", "DOCUMENT"]);

function readInitialType(value: string | string[] | undefined): ArtifactType | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && artifactTypes.has(candidate as ArtifactType)
    ? candidate as ArtifactType
    : undefined;
}

export default async function NewArtifactPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[] }>;
}) {
  const [workspace, query] = await Promise.all([
    getWorkspaceProps(),
    searchParams,
  ]);

  return (
    <ArtifactStudioClient
      {...workspace}
      initialType={readInitialType(query.type)}
    />
  );
}
