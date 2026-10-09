import type { Transcript } from "../transcription/types/transcript.js";
import type { CutCandidate } from "./candidate.js";
import type { AudioSignals, ClipPortfolio } from "../portfolio/types.js";
export const ANALYSIS_VERSION = "local-1.0.1";
export interface AnalysisInput { uploadId: string; transcript: Transcript; audio?: AudioSignals }
export interface AnalysisReport { analysisVersion: string; generatedCount: number; deduplicatedCount: number; rejectedCount: number; candidates: CutCandidate[]; portfolio?: ClipPortfolio }
export interface AnalysisProvider { readonly analysisVersion: string; analyze(input: AnalysisInput, signal: AbortSignal): Promise<AnalysisReport> }
