import type { SafeArea } from "../editing/types.js";
import type { GlassOverlay, Region } from "../visual-composition/types.js";
export const THUMBNAIL_VERSION = "thumbnail-1.0.0";
export const THUMBNAIL_STYLES = ["CLEAN", "BOLD", "PODCAST", "EMOTIONAL", "EDUCATIONAL", "DYNAMIC"] as const;
export type ThumbnailStyle = typeof THUMBNAIL_STYLES[number];
export interface FrameRank { timestamp: number; score: number; reason: string; semantic: number; brightness: number; contrast: number; sharpness: number; stability: number }
export interface ThumbnailPlan {
  version: typeof THUMBNAIL_VERSION; clipId: string; frameTimestamp: number; ranking: FrameRank[];
  background: { kind: "blurred-frame"; blurSigma: number; darkness: number }; crop: Region | null; focalRegion: Region | null;
  headline: { text: string; lines: string[]; fontSize: number; region: Region }; subtitle: string | null;
  layout: "frame-and-headline"; style: ThumbnailStyle; foreground: Region; overlays: GlassOverlay[];
  safeAreas: SafeArea; width: 1080; height: 1920; reason: string[];
  validation: { estimatedTextWidth: number; minimumFontSize: 64; withinSafeArea: true; contrastBacking: true };
}
