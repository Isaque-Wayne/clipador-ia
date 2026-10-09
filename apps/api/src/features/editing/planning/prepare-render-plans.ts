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

export async function prepareRenderPlans(uploads: UploadService, id: string, transcript: Transcript, report: AnalysisReport, candidates: CutCandidate[], style: EditStyle, signal: AbortSignal, onAssets: () => void, musicDirectory?: string) {
  return uploads.prepareUpload(id, async context => {
    const inspection = await inspectVideo(context.input, context.signal);
    const edits = candidates.map(candidate => buildEditPlan(candidate, transcript, inspection, report.portfolio?.audio, style));
    onAssets();
    const music = new LocalMusicProvider(musicDirectory);
    const plans = [];
    for (const edit of edits) {
      context.signal.throwIfAborted();
      plans.push(createRenderPlan(edit, await resolveAssets(edit, music, new SourceBRollProvider([], edit.sourceRange), context.signal)));
    }
    return plans;
  }, signal);
}
