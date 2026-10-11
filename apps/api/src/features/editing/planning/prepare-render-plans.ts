import type { UploadService } from "../../uploads/services/receive-video.js";
import type { Transcript } from "../../transcription/types/transcript.js";
import type { AnalysisReport } from "../../analysis/contracts.js";
import type { CutCandidate } from "../../analysis/candidate.js";
import type { EditStyle } from "../types.js";
import { inspectVideo } from "../../video-preparation/services/inspect-video.js";
import { buildEditPlan } from "./edit-plan.js";
import { LocalMusicProvider } from "../music/music-provider.js";
import { SourceBRollProvider } from "../broll/broll-provider.js";
import { resolveAssets } from "../assets/asset-resolver.js";
import { createRenderPlan } from "../rendering/render-plan.js";
import { applyPlatformCaptions } from "../../social-packages/platform-profiles.js";
import { buildVisualCompositionPlan } from "../../visual-composition/planner.js";

export async function prepareRenderPlans(uploads: UploadService, id: string, transcript: Transcript, report: AnalysisReport, candidates: CutCandidate[], style: EditStyle, signal: AbortSignal, onAssets: () => void, musicDirectory?: string) {
  return uploads.prepareUpload(id, async context => {
    const inspection = await inspectVideo(context.input, context.signal);
    const edits = candidates.map(candidate => applyPlatformCaptions(buildEditPlan(candidate, transcript, inspection, report.portfolio?.audio, style)));
    onAssets();
    const music = new LocalMusicProvider(musicDirectory);
    const plans = [];
    for (const edit of edits) {
      context.signal.throwIfAborted();
      const candidate = candidates.find(item => item.id === edit.clipId);
      if (!candidate) throw new Error("Missing candidate for visual plan");
      const visual = buildVisualCompositionPlan(candidate, edit, inspection);
      const framedEdit = { ...edit, framing: { ...edit.framing, mode: ["FULL_VERTICAL", "FOCUS_DETAIL"].includes(visual.template) ? "crop" as const : "padding" as const, reason: visual.reason[0] ?? edit.framing.reason } };
      plans.push(createRenderPlan(framedEdit, await resolveAssets(framedEdit, music, new SourceBRollProvider([], framedEdit.sourceRange), context.signal), visual));
    }
    return plans;
  }, signal);
}
