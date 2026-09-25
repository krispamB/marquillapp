import { ArtifactType } from 'src/database/schemas';
import { ArtifactContent } from './schemas';
import type { BrowserlessUsage } from '../carousel/render-usage.types';

// RENDER_PDF's output for DOCUMENT artifacts, folded into content.document
// by setVersionContent.
export interface VersionRender {
  pdfKey: string;
  pageCount: number;
  browserless: BrowserlessUsage;
}

export interface VersionWriteOptions {
  render?: VersionRender;
  title?: string;
}

export interface CurrentVersionRead {
  type: ArtifactType;
  version: number;
  content: ArtifactContent;
}

export interface RefineContext {
  priorContent: ArtifactContent;
  feedback: string;
}

// Narrow role interface consumed by the workflow engine's StepContext (#115):
// steps depend on this, not on the full ArtifactService surface.
export interface ArtifactWriter {
  setVersionContent(
    artifactId: string,
    version: number,
    content: ArtifactContent,
    options?: VersionWriteOptions,
  ): Promise<void>;
  readCurrent(artifactId: string): Promise<CurrentVersionRead>;
  readRefineInput(artifactId: string, version: number): Promise<RefineContext>;
  // Called only by the engine's terminal-failure handler (#115). FAILED
  // versions stay visible in the library, so the user can refine from one.
  failVersion(
    artifactId: string,
    version: number,
    failureReason: string,
  ): Promise<void>;
}
