import type { EditPlan, EditStyle, SafeArea } from "../editing/types.js";
import type { VisualCompositionPlan } from "../visual-composition/types.js";
import type { ThumbnailPlan, ThumbnailStyle } from "../thumbnails/types.js";
import type { FinalQuality } from "../portfolio/services/final-quality.js";

export const SOCIAL_PACKAGE_VERSION = "social-package-1.0.0";
export const PLATFORM_IDS = ["youtube-shorts", "instagram-reels", "tiktok"] as const;
export type PlatformId = typeof PLATFORM_IDS[number];
export interface PackageFile { file: string; size: number; checksum: string }
export interface ImageAsset extends PackageFile { width: number; height: number; mime: "image/jpeg" }
export interface PlatformProfile {
  id: PlatformId; safeArea: SafeArea; cover: { file: string; previewAspect: number; placement: "candidate" | "cover" };
  metadata: { title?: string; description?: string; caption?: string };
  exportRequirements: { aspect: "9:16"; width: 1080; height: 1920; videoCodec: "h264"; audioCodec: "aac"; fps: 30; automaticPublishing: false };
  textPlacement: { headlineY: number; captionsY: number }; notes: string[];
}
export interface SocialClipPackage {
  version: typeof SOCIAL_PACKAGE_VERSION; clipId: string; projectId: string;
  video: PackageFile & { width: number; height: number; duration: number };
  thumbnail: ImageAsset; sourceFrame: ImageAsset;
  metadata: { file: string; generatedAt: string; semanticMethod: "existing-analysis-and-transcript"; warnings: string[] };
  platformProfiles: PlatformProfile[]; editPlan: EditPlan; visualCompositionPlan: VisualCompositionPlan; thumbnailPlan: ThumbnailPlan;
  title: string; description: string; style: EditStyle; score: number; duration: number;
  finalQuality?: FinalQuality;
  assets: { kind: "source-video" | "source-frame" | "licensed-music"; id: string; checksum?: string }[];
  checksum: { algorithm: "sha256"; value: string };
  capabilities: { downloadFiles: true; zip: false; regenerateThumbnail: "planned"; chooseFrame: "planned"; changeTemplate: "planned" };
}
export interface SocialPackageSummary {
  version: typeof SOCIAL_PACKAGE_VERSION; thumbnail: ImageAsset; sourceFrame: ImageAsset; metadata: PackageFile;
  template: VisualCompositionPlan["template"]; thumbnailStyle: ThumbnailStyle; headline: string; frameTimestamp: number;
  platforms: PlatformId[]; selectionReason: string;
}
