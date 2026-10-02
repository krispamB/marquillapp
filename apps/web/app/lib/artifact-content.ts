export const POLL_DURATION_DAYS = [1, 3, 7, 14] as const;
export type PollDurationDays = (typeof POLL_DURATION_DAYS)[number];

export type ArtifactPollContent = {
  question: string;
  options: string[];
  durationDays: PollDurationDays;
};

/** A READY Document Version as the API serializes it: its pin, size and a signed PDF. */
export type ArtifactDocumentContent = {
  designSystemId: string;
  designSystemVersion: number;
  designSystemName: string;
  pageCount: number;
  /** Signed per read; valid until `pdfUrlExpiresAt`. */
  pdfUrl: string;
  pdfUrlExpiresAt: string;
};

export type ArtifactContent = {
  commentary?: string;
  poll?: ArtifactPollContent;
  document?: ArtifactDocumentContent;
};
