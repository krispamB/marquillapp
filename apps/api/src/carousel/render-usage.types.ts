export interface BrowserlessUsage {
  durationMs: number;
  units: number;
}

export type RenderFailureStage = 'browserless' | 'upload';

export type RenderAttemptUsage = BrowserlessUsage &
  (
    | { outcome: 'SUCCEEDED' }
    | { outcome: 'FAILED'; failureStage: RenderFailureStage }
  );
