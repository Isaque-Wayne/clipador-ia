import type { EmphasisEvent } from "../portfolio/types.js";
export const EDIT_PLAN_VERSION = "social-edit-1.0.1";
export const RENDER_PROFILES = { "vertical-social": { width: 1080, height: 1920, fps: 30 }, square: { width: 1080, height: 1080, fps: 30 }, landscape: { width: 1920, height: 1080, fps: 30 } } as const;
export type EditStyle = "CLEAN" | "DYNAMIC" | "STORY" | "EMOTIONAL" | "EDUCATIONAL" | "PODCAST" | "AUTO";
export interface TimelineSpan { sourceStart: number; sourceEnd: number; outputStart: number; outputEnd: number }
export interface SafeArea { left: number; right: number; top: number; bottom: number; anchorY: number }
export interface CaptionWord { text: string; start: number; end: number; emphasis: boolean }
export interface CaptionGroup { start: number; end: number; words: CaptionWord[]; activeWord: boolean; emphasis: boolean; position: { x: number; y: number }; style: "clean" | "active" | "concept" }
export interface CaptionPlan { version: string; safeArea: SafeArea; fontSize: number; groups: CaptionGroup[] }
export interface ZoomEvent { start: number; end: number; intensity: number; focus: { x: number; y: number }; reason: string }
export interface PacingPlan { visualTempo: "calm" | "balanced" | "brisk"; maxEffectsPerMinute: number; minZoomGap: number; minShotDuration: number; pauses: { start: number; end: number; action: "preserve" | "trim"; reason: string }[] }
export type MusicMood = "inspirational" | "emotional" | "tense" | "energetic" | "playful" | "neutral" | "cinematic" | "educational";
export interface MusicPlan { requested: boolean; mood: MusicMood; intensity: "low"; volume: number; start: number; end: number; fadeIn: number; fadeOut: number; ducking: { threshold: number; ratio: number; attackMs: number; releaseMs: number }; reason: string }
export interface BRollCue { start: number; end: number; query: string; purpose: "illustrate" | "cutaway"; importance: number }
export interface SoundEffectPlan { events: { start: number; kind: "whoosh" | "impact" | "click" | "riser"; assetId?: string; reason: string }[]; requiresLicensedAsset: true }
export interface FramingPlan { mode: "crop" | "padding"; focus: { x: number; y: number }; reason: string; speakerShots: { start: number; end: number; speakerId: string; mode: "single" | "dialogue" | "split-screen" }[] }
export interface EditPlan {
  version: string; clipId: string; analysisVersion: string; style: Exclude<EditStyle, "AUTO">;
  sourceRange: { start: number; end: number }; renderProfile: keyof typeof RENDER_PROFILES; outputDuration: number;
  timeline: TimelineSpan[]; pacing: PacingPlan; framing: FramingPlan; captions: CaptionPlan;
  zoomEvents: ZoomEvent[]; emphasisEvents: EmphasisEvent[]; bRollEvents: BRollCue[]; music: MusicPlan; soundEffects: SoundEffectPlan;
  silenceCuts: { start: number; end: number; reason: string }[]; transitions: { kind: "cut"; at: number }[];
}
export interface ResolvedMusic { id: string; path: string; checksum: string; extension: ".wav" | ".mp3" | ".m4a" | ".ogg"; license: string }
export interface AssetResolution { music?: ResolvedMusic; warnings: string[] }
