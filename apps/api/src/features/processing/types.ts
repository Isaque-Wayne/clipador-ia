import type { ClipBatch } from "../clip-rendering/types.js";
import type { TranscriptionProgress } from "../transcription/types/transcript.js";
export type ProcessingStage = "not-started" | "preparing-audio" | "transcribing" | "transcribed" | "analyzing" | "selecting-clips" | "planning-edits" | "resolving-assets" | "rendering-subtitles" | "rendering-clips" | "completed" | "failed";
export interface ProcessingStatus {
  uploadId: string; stage: ProcessingStage; startedAt?: string; finishedAt?: string;
  renderedCount?: number; selectedCount?: number; batchId?: string;
  progress?: TranscriptionProgress;
  error?: { code: string; message: string; stage?: string; timeoutMs?: number; elapsedMs?: number; usedBytes?: number; limitBytes?: number; requiredBytes?: number; projectCount?: number };
}
export interface ProcessingJob { status: ProcessingStatus; abort: AbortController; done: Promise<void>; result?: ClipBatch; preferences?: NonNullable<ClipBatch["preferences"]>; selectedIds?: string[]; renderVersion?: string }
