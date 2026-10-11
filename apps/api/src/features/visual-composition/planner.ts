import type { CutCandidate } from "../analysis/candidate.js";
import type { EditPlan } from "../editing/types.js";
import type { VideoInspection } from "../video-preparation/types/inspection.js";
import { COMMON_SAFE_AREA } from "../social-packages/platform-profiles.js";
import { VISUAL_VERSION } from "./types.js";
import type { VisualCompositionPlan, VisualHints, VisualTemplate } from "./types.js";
import { safeVerticalFrame } from "./safe-vertical-frame.js";

export function buildVisualCompositionPlan(candidate: CutCandidate, _edit: EditPlan, inspection: VideoInspection, hints: VisualHints = {}): VisualCompositionPlan {
  const important = hints.detailRegion ?? hints.personRegion ?? hints.focalRegion;
  const frame = safeVerticalFrame((inspection.aspectRatio ?? inspection.width / inspection.height) * inspection.height, inspection.height, important);
  const template: VisualTemplate = hints.detailRegion && frame.mode === "crop" ? "FOCUS_DETAIL" : frame.mode === "crop" ? "FULL_VERTICAL" : "BLURRED_BACKGROUND";
  return { version: VISUAL_VERSION, clipId: candidate.id, template, reason: [frame.reason, "Composição simples; headline apenas na capa separada."],
    background: { kind: "blurred-video", blurSigma: 14, darkness: .23 }, foreground: frame.foreground,
    sourceCrop: frame.sourceCrop, focalRegion: important ?? null,
    auxiliaryFrameTimestamp: null, overlays: [],
    safeArea: { ...COMMON_SAFE_AREA }, identity: { font: "Arial", accent: "#A0D7E9", ink: "#101724", radius: 24 },
    limitations: ["Sem detecção de rosto ou active speaker; crop central ou região explicitamente informada. Revisar cenas com movimento."] };
}
