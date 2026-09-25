import {
  BarChart3,
  FileText,
  GalleryHorizontal,
  type LucideIcon,
} from "lucide-react";
import type { ArtifactType } from "./artifactTypes";

export const artifactTypeIcons: Record<ArtifactType, LucideIcon> = {
  POST: FileText,
  POLL: BarChart3,
  DOCUMENT: GalleryHorizontal,
};
