import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { ClipBatch, RenderedClip } from "../types.js";
import type { CutCandidate } from "../../analysis/candidate.js";
import type { AnalysisReport } from "../../analysis/contracts.js";
import type { Transcript } from "../../transcription/types/transcript.js";
import type { UploadService } from "../../uploads/services/receive-video.js";
import type { ResourceGate } from "../../processing/services/resource-gate.js";
import type { ClipStorage } from "./clip-storage.js";
import type { RenderPlan } from "../../editing/rendering/render-plan.js";
import { fileChecksum } from "./clip-storage.js";
import { digest } from "../../analysis/services/analysis-persistence.js";
import { inspectVideo } from "../../video-preparation/services/inspect-video.js";
import { openMediaInput } from "../../video-preparation/services/open-media-input.js";
import { mediaTool } from "../../youtube-ingestion/services/ffmpeg-runner.js";
import { runRenderProcess } from "./render-process.js";
import { plannedRenderArguments, planFilterGraph, clipByteBudget, PLANNED_RENDER_VERSION } from "../../editing/rendering/ffmpeg-plan.js";
import { renderCaptionAss } from "../../editing/captions/render-ass.js";
import { RENDER_PROFILES } from "../../editing/types.js";
import { ProcessingError } from "../../processing/services/processing-error.js";

interface RenderInput {
  uploads: UploadService; storage: ClipStorage; gate: ResourceGate; uploadId: string; report: AnalysisReport; transcript: Transcript;
  candidates: CutCandidate[]; signal: AbortSignal; timeoutMs: number; plans: RenderPlan[]; renderVersion?: string; preferences?: ClipBatch["preferences"];
  onStage: (stage: "rendering-clips" | "rendering-subtitles", completed: number, total: number) => void;
  onDiagnostic?: (text: string) => void;
}
export async function renderClips(input: RenderInput): Promise<ClipBatch> {
  if (!input.candidates.length || input.candidates.length > 1280) throw new ProcessingError("INVALID_SELECTION", "Seleção vazia ou acima do orçamento de candidatos.", 400);
  if (input.plans.length !== input.candidates.length || input.candidates.some(candidate => !input.plans.some(plan => plan.edit.clipId === candidate.id)))
    throw new ProcessingError("INVALID_PLAN", "Cada clip deve ter um plano correspondente.", 409);
  const release = input.gate.acquire(), batchId = randomUUID();
  let created = false, published = false;
  try {
    await input.storage.reserve(input.candidates.reduce((sum, candidate) => sum + clipByteBudget(candidate.duration), 0) + 16 * 1024 * 1024);
    const work = await input.storage.work(batchId, true); created = true;
    const sourceHash = input.uploads.findUpload(input.uploadId)?.checksum?.value;
    if (!sourceHash) throw new ProcessingError("NOT_FOUND", "Upload não encontrado ou expirado.", 404);
    const executable = await mediaTool("ffmpeg"), clips: RenderedClip[] = [];
    for (const candidate of input.candidates) {
      // Each native process and the batch own explicit budgets; preparation only pins/verifies the source.
      const clip = await input.uploads.prepareUpload(input.uploadId, async context => {
        const inspection = await inspectVideo(context.input, context.signal);
        if (!inspection.audio) throw new ProcessingError("NO_AUDIO", "O vídeo não possui áudio para o corte.", 422);
        if (candidate.end > inspection.durationSeconds + .1) throw new ProcessingError("INVALID_BOUNDS", "Candidato ultrapassa a duração do vídeo.", 409);
        const render = input.plans.find(plan => plan.edit.clipId === candidate.id);
        if (!render) throw new ProcessingError("INVALID_PLAN", "Plano ausente para o clip.", 409);
        const plan = render.edit, profile = RENDER_PROFILES[plan.renderProfile];
        if (plan.sourceRange.start !== candidate.start || plan.sourceRange.end !== candidate.end) throw new ProcessingError("INVALID_PLAN", "Plano associado a bordas diferentes.", 409);
        input.onStage("rendering-subtitles", clips.length, input.candidates.length);
        if (!plan.captions.groups.length) throw new ProcessingError("NO_SUBTITLES", "Plano sem palavras válidas para legendar.", 422);
        const assPath = join(work, `${candidate.id}.ass`), graphPath = join(work, `${candidate.id}.ffgraph`), partial = join(work, `${candidate.id}.mp4.part`);
        let musicName: string | undefined;
        if (render.assets.music && plan.music.requested) {
          const music = render.assets.music; musicName = `asset-${music.checksum.slice(0, 16)}${music.extension}`;
          const assetPath = join(work, musicName);
          try {
            await copyFile(music.path, assetPath, constants.COPYFILE_EXCL);
            if (await fileChecksum(assetPath) !== music.checksum) throw new Error("Asset changed");
          } catch {
            try { await unlink(assetPath); } catch { /* May not have been created. */ }
            render.assets.warnings.push("Asset mudou/ficou indisponível antes do render; música omitida."); musicName = undefined;
          }
        }
        await writeFile(assPath, renderCaptionAss(plan), { flag: "wx", mode: 0o600 });
        await writeFile(graphPath, planFilterGraph(render, musicName), { flag: "wx", mode: 0o600 });
        input.onStage("rendering-clips", clips.length, input.candidates.length);
        const started = performance.now(), source = await openMediaInput(context.input);
        try { await runRenderProcess({ executable, args: plannedRenderArguments(render, musicName), cwd: work, inputFd: source.fd, timeoutMs: input.timeoutMs,
          ...(input.onDiagnostic ? { onDiagnostic: input.onDiagnostic } : {}) }, context.signal); }
        finally { await source.close(); }
        context.signal.throwIfAborted();
        const stat = await lstat(partial), identity = await lstat(partial, { bigint: true });
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > clipByteBudget(plan.outputDuration) || !stat.size) throw new ProcessingError("INVALID_OUTPUT", "FFmpeg produziu arquivo inválido ou excedeu o orçamento.");
        const output = await inspectVideo({ path: partial, identity }, context.signal);
        if (output.width !== profile.width || output.height !== profile.height || output.videoCodec !== "h264" || output.audio?.codec !== "aac" || Math.abs(output.durationSeconds - plan.outputDuration) > .3)
          throw new ProcessingError("INVALID_OUTPUT", "MP4 não corresponde ao plano: resolução, codecs ou duração.");
        const checksum = await fileChecksum(partial);
        await rename(partial, join(work, `${candidate.id}.mp4`)); await unlink(assPath); await unlink(graphPath);
        if (musicName) await unlink(join(work, musicName));
        const editsApplied = ["vertical-framing", plan.captions.groups.some(group => group.activeWord) ? "active-word-captions" : "captions",
          ...(plan.zoomEvents.length ? ["event-driven-zoom"] : []), ...(plan.silenceCuts.length ? ["measured-silence-trim"] : []), ...(musicName ? ["licensed-music", "voice-ducking"] : [])];
        return { id: candidate.id, file: `${candidate.id}.mp4`, start: candidate.start, end: candidate.end, duration: output.durationSeconds, width: profile.width, height: profile.height, checksum, size: stat.size, status: "completed" as const, candidate, editPlan: plan,
          assets: { ...(musicName && render.assets.music ? { musicId: render.assets.music.id } : {}), warnings: render.assets.warnings },
          metadata: { videoCodec: "h264" as const, audioCodec: "aac" as const, subtitlesBurned: true as const, cueCount: plan.captions.groups.length, layout: plan.framing.mode, renderSeconds: (performance.now() - started) / 1000, editsApplied, editPlanVersion: plan.version } };
      }, input.signal, { timeoutMs: null });
      clips.push(clip);
    }
    input.signal.throwIfAborted();
    const batch: ClipBatch = { schemaVersion: 1, uploadId: input.uploadId, batchId, createdAt: new Date().toISOString(), analysisVersion: input.report.analysisVersion,
      renderVersion: input.renderVersion ?? PLANNED_RENDER_VERSION, sourceHash, analysisHash: digest(input.report), report: input.report, clips,
      ...(input.preferences ? { preferences: input.preferences } : {}) };
    await input.storage.publish(batch); published = true;
    return batch;
  } finally { try { if (created && !published) await input.storage.clearWork(batchId); } finally { release(); } }
}
