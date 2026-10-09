import type { CutCandidate } from "../analysis/candidate.js";
import type { AnalysisReport } from "../analysis/contracts.js";
import type { AnalysisProvider } from "../analysis/contracts.js";
import type { EditPlan, EditStyle } from "../editing/types.js";
import type { QuantityMode } from "../portfolio/types.js";
export interface RenderedClip {
  id: string; file: string; start: number; end: number; duration: number;
  width: number; height: number; checksum: string; size: number; status: "completed";
  candidate: CutCandidate;
  editPlan?: EditPlan;
  assets?: { musicId?: string; warnings: string[] };
  metadata: { videoCodec: "h264"; audioCodec: "aac"; subtitlesBurned: true; cueCount: number; layout: "crop" | "padding"; renderSeconds: number; editsApplied?: string[]; editPlanVersion?: string };
}
export interface ClipBatch {
  schemaVersion: 1; uploadId: string; batchId: string; createdAt: string; analysisVersion: string;
  renderVersion: string; sourceHash: string; analysisHash: string; report: AnalysisReport; clips: RenderedClip[];
  preferences?: { quantity: QuantityMode; style: EditStyle };
}
export interface ProcessingOptions {
  directory?: string;
  analysisProvider?: AnalysisProvider;
  renderTimeoutMs?: number;
  quotaBytes?: number;
  musicDirectory?: string;
}
