import type { TranscriptionEngine, TranscriptionProgress } from "./transcript.js";
import type { PreparationContext } from "../../video-preparation/types/preparation.js";
import type { ResourceGate } from "../../processing/services/resource-gate.js";
export type TranscriptionStage = "preparing-audio" | "transcribing" | "normalizing" | "persisting" | "completed" | "failed";
export interface TranscriptionStatus {
  uploadId: string;
  stage: TranscriptionStage;
  startedAt: string;
  finishedAt?: string;
  progress?: TranscriptionProgress;
  error?: { code: string; message: string; stage?: string; timeoutMs?: number; elapsedMs?: number };
}
export interface TranscriptionOptions {
  resourceGate?: ResourceGate;
  engine?: TranscriptionEngine;
  timeoutMs?: number;
  prepareAudio?: (context: PreparationContext, consume: (path: string) => Promise<void>) => Promise<void>;
}
