export const POLL_DURATION_DAYS = [1, 3, 7, 14] as const;
export type PollDurationDays = (typeof POLL_DURATION_DAYS)[number];

export type ArtifactSlide =
  | { type: "cover"; fields: { eyebrow?: string; title: string; subtitle?: string } }
  | { type: "content"; fields: { heading: string; body: string } }
  | { type: "list"; fields: { heading: string; items: string[] } }
  | { type: "quote"; fields: { quote: string; attribution?: string } }
  | { type: "cta"; fields: { headline: string; action: string; handle?: string } };

export type ArtifactPollContent = {
  question: string;
  options: string[];
  durationDays: PollDurationDays;
};

export type ArtifactDocumentContent = {
  templateId: "bold" | "minimal" | "editorial" | "gradient";
  slides: ArtifactSlide[];
  pageCount?: number;
  pdfUrl?: string;
};

export type ArtifactContent = {
  commentary?: string;
  poll?: ArtifactPollContent;
  document?: ArtifactDocumentContent;
};
