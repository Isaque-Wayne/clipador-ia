import type { CutCandidate } from "../analysis/candidate.js";
import type { AnalysisReport } from "../analysis/contracts.js";
import type { AnalysisProvider } from "../analysis/contracts.js";
import type { EditPlan, EditStyle } from "../editing/types.js";
import type { QuantityMode } from "../portfolio/types.js";
import type { SocialPackageSummary } from "../social-packages/types.js";
import type { VisualCompositionPlan } from "../visual-composition/types.js";
import type { FinalSelectionSummary } from "../portfolio/services/final-selection.js";
import type { FinalQuality } from "../portfolio/services/final-quality.js";
export interface RenderedClip {
  id: string; file: string; start: number; end: number; duration: number;
  width: number; height: number; checksum: string; size: number; status: "completed";
  candidate: CutCandidate;
  editPlan?: EditPlan;
  visualCompositionPlan?: VisualCompositionPlan;
  socialPackage?: SocialPackageSummary;
  finalQuality?: FinalQuality;
  assets?: { musicId?: string; warnings: string[] };
  metadata: { videoCodec: "h264"; audioCodec: "aac"; subtitlesBurned: true; cueCount: number; layout: "crop" | "padding"; renderSeconds: number; editsApplied?: string[]; editPlanVersion?: string };
}
export interface ClipBatch {
  schemaVersion: 1; uploadId: string; batchId: string; createdAt: string; analysisVersion: string;
  renderVersion: string; sourceHash: string; analysisHash: string; report: AnalysisReport; clips: RenderedClip[];
  preferences?: { quantity: QuantityMode; style: EditStyle };
  requestedIds?: string[];
  selection?: FinalSelectionSummary;
}
export interface ProcessingOptions {
  directory?: string;
  analysisProvider?: AnalysisProvider;
  renderTimeoutMs?: number;
  quotaBytes?: number;
  musicDirectory?: string;
}
