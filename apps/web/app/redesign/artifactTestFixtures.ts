import type { ArtifactDetailData } from "./artifactTypes";

export function documentArtifactFixture({
  pdfUrl,
  commentary,
}: {
  pdfUrl?: string;
  commentary?: string;
} = {}): ArtifactDetailData {
  return {
    id: "document-1",
    type: "DOCUMENT",
    title: "Marketing playbook",
    currentVersion: 1,
    version: 1,
    status: "READY",
    content: {
      ...(commentary ? { commentary } : {}),
      document: {
        templateId: "editorial",
        slides: [
          { type: "cover", fields: { title: "Marketing playbook" } },
          { type: "cta", fields: { headline: "Start today", action: "Follow" } },
        ],
        pageCount: 2,
        ...(pdfUrl ? { pdfUrl } : {}),
      },
    },
  };
}
