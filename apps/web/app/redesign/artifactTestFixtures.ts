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
        designSystemId: "margin",
        designSystemVersion: 1,
        designSystemName: "Margin",
        pageCount: 2,
        pdfUrl: pdfUrl ?? "",
        pdfUrlExpiresAt: "2026-10-02T13:00:00.000Z",
      },
    },
  };
}
