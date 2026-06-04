import type { ModelMessage } from 'ai';

export type ArtifactType = 'post' | 'poll' | 'document';
export type SessionStatus = 'active' | 'completed' | 'expired';
export type MessageRole = 'user' | 'assistant';

export interface MarkMessage {
  role: MessageRole;
  content: string;
  timestamp: string; // ISO 8601, always set server-side on write
}

export interface ResolvedIntent {
  artifactType: ArtifactType | null;
  topic: string | null;
  tone: string | null;
  targetAudience: string | null;
  additionalContext: string | null;
}

export type ArtifactPayload =
  | { type: 'post'; content: string }
  | { type: 'poll'; question: string; options: string[] }
  | { type: 'document'; html: string; format: 'one-pager' | 'carousel' };

export interface ClarificationQuestion {
  question: string;
  options: string[];
}

export interface PendingClarification {
  toolCallId: string;
  questions: ClarificationQuestion[];
  summary: string;
  sdkMessages: ModelMessage[];
}

export type MarkChatEvent =
  | { type: 'tool'; event: string }
  | { type: 'tool-error'; toolName: string; error: string }
  | { type: 'artifact-chunk'; text: string }
  | { type: 'clarification'; questions: ClarificationQuestion[]; summary: string }
  | { type: 'done'; artifact: ArtifactPayload | null };

export interface MarkSession {
  userId: string;
  status: SessionStatus;
  messages: MarkMessage[];
  intent: ResolvedIntent | null;
  artifactId: string | null; // set once the artifact document is persisted to MongoDB
  refinementCount: number; // max 1; enforced by callers, not here
  pendingClarification: PendingClarification | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}
