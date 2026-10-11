import type { SafeArea } from "../editing/types.js";
export const VISUAL_VERSION = "visual-composition-1.0.0";
// Keep historical names readable in saved library packages.
export const VISUAL_TEMPLATES = ["FULL_VERTICAL", "TOP_BOTTOM", "SPLIT", "FULL_VIDEO", "CLEAN_PODCAST", "FOCUS_DETAIL", "BLURRED_BACKGROUND", "GLASS_FRAME", "MEDIA_STACK", "HEADLINE_TOP", "HEADLINE_CENTER"] as const;
export type VisualTemplate = typeof VISUAL_TEMPLATES[number];
export interface Region { x: number; y: number; width: number; height: number }
export type GlassKind = "title-bar" | "label" | "card" | "speaker-name" | "topic" | "badge" | "callout";
export interface GlassOverlay { kind: GlassKind; text: string; region: Region; opacity: number }
export interface VisualHints { focalRegion?: Region; detailRegion?: Region; personRegion?: Region; centerClear?: boolean; auxiliaryFrameTimestamp?: number; speakerName?: string }
export interface VisualCompositionPlan {
  version: typeof VISUAL_VERSION; clipId: string; template: VisualTemplate; reason: string[];
  background: { kind: "blurred-video" | "solid"; blurSigma: number; darkness: number };
  foreground: Region; sourceCrop: Region | null; focalRegion: Region | null;
  auxiliaryFrameTimestamp: number | null; overlays: GlassOverlay[]; safeArea: SafeArea;
  identity: { font: "Arial"; accent: "#A0D7E9"; ink: "#101724"; radius: 24 };
  limitations: string[];
}
