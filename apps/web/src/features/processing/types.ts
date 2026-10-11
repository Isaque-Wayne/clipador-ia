export type ProcessingStage = "not-started" | "preparing-audio" | "transcribing" | "transcribed" | "analyzing" | "selecting-clips" | "planning-edits" | "resolving-assets" | "rendering-subtitles" | "rendering-clips" | "completed" | "failed";
export interface ProcessingStatus { uploadId: string; stage: ProcessingStage; renderedCount?: number; selectedCount?: number;
  progress?: { segmentsProcessed: number; processedThroughSeconds: number }; error?: { code: string; message: string; usedBytes?: number; limitBytes?: number; requiredBytes?: number; projectCount?: number } }
export type DurationProfile = "micro" | "short" | "standard" | "extended";
export interface ClipCard { id: string; title: string; duration: number; score: number; reason: string; url: string; profile?: DurationProfile; familyId?: string; hookScore?: number; emotions?: string[]; emotionalStrength?: number; educationalScore?: number; editStyle?: string; socialPackage?: import("../social-packages/types").PackagePreview }
