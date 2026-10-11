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
import { visualOverlayEvents } from "../../visual-composition/overlays-ass.js";
import { generateSocialPackage, SOCIAL_ARTIFACT_BUDGET } from "../../social-packages/generate-package.js";
import { evaluateFinalCandidate, maxFinalClips } from "../../portfolio/services/final-quality.js";
import { selectFinalPortfolio } from "../../portfolio/services/final-selection.js";
import type { FinalSelectionSummary } from "../../portfolio/services/final-selection.js";
import { validateSocialOutput } from "./validate-social-output.js";

interface RenderInput {
  uploads: UploadService; storage: ClipStorage; gate: ResourceGate; uploadId: string; report: AnalysisReport; transcript: Transcript;
  candidates: CutCandidate[]; signal: AbortSignal; timeoutMs: number; plans: RenderPlan[]; renderVersion?: string; preferences?: ClipBatch["preferences"];
  onStage: (stage: "rendering-clips" | "rendering-subtitles", completed: number, total: number) => void;
  onDiagnostic?: (text: string) => void;
  selection?: FinalSelectionSummary;
}
export async function renderClips(input: RenderInput): Promise<ClipBatch> {
  if (!input.candidates.length || input.candidates.length > maxFinalClips()) throw new ProcessingError("INVALID_SELECTION", "Seleção vazia ou acima do limite de clips finais.", 400);
  if (input.report.portfolio) {
    const selected = selectFinalPortfolio({ ...input.report, candidates: input.candidates }, "maximum").candidates;
    if (selected.length !== input.candidates.length || input.candidates.some(candidate => !evaluateFinalCandidate(candidate).renderEligible))
      throw new ProcessingError("QUALITY_GATE", "A seleção contém clips abaixo do piso de qualidade ou variações repetidas do mesmo momento.", 422);
  }
  if (input.plans.some(plan => plan.edit.renderProfile !== "vertical-social")) throw new ProcessingError("INVALID_PLAN", "O perfil social exige saída vertical 1080×1920.", 409);
  if (input.plans.length !== input.candidates.length || input.candidates.some(candidate => !input.plans.some(plan => plan.edit.clipId === candidate.id)))
    throw new ProcessingError("INVALID_PLAN", "Cada clip deve ter um plano correspondente.", 409);
  const release = input.gate.acquire();
  let batchId: string = randomUUID(), created = false;
  try {
    const sourceHash = input.uploads.findUpload(input.uploadId)?.checksum?.value;
    if (!sourceHash) throw new ProcessingError("NOT_FOUND", "Upload não encontrado ou expirado.", 404);
    let batch = await input.storage.latest(input.uploadId, item => item.sourceHash === sourceHash && item.analysisHash === digest(input.report)
      && item.renderVersion === (input.renderVersion ?? PLANNED_RENDER_VERSION) && digest(item.preferences ?? null) === digest(input.preferences ?? null)
      && item.requestedIds?.join() === input.candidates.map(candidate => candidate.id).join()
      && item.clips.every(clip => {
        const plan = input.plans.find(entry => entry.edit.clipId === clip.id);
        return digest(clip.editPlan) === digest(plan?.edit) && digest(clip.visualCompositionPlan ?? null) === digest(plan?.visual ?? null) && (!plan?.visual || !!clip.socialPackage);
      }));
    if (batch) batchId = batch.batchId;
    const executable = await mediaTool("ffmpeg"), clips: RenderedClip[] = [...(batch?.clips ?? [])];
    input.onStage("rendering-clips", clips.length, input.candidates.length);
    for (const candidate of input.candidates) {
      if (clips.some(clip => clip.id === candidate.id)) continue;
      input.signal.throwIfAborted();
      const renderPlan = input.plans.find(plan => plan.edit.clipId === candidate.id);
      const assetBudget = renderPlan?.assets.music && renderPlan.edit.music.requested ? 32 * 1024 * 1024 : 0;
      await input.storage.reserve(clipByteBudget(candidate.duration) + 16 * 1024 * 1024 + assetBudget + SOCIAL_ARTIFACT_BUDGET);
      const work = await input.storage.work(batchId, true); created = true;
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
        await writeFile(assPath, renderCaptionAss(plan) + (render.visual ? visualOverlayEvents(render.visual.overlays, profile.width, profile.height, plan.outputDuration) : ""), { flag: "wx", mode: 0o600 });
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
        validateSocialOutput(output, plan.outputDuration);
        const checksum = await fileChecksum(partial);
        await rename(partial, join(work, `${candidate.id}.mp4`)); await unlink(assPath); await unlink(graphPath);
        if (musicName) await unlink(join(work, musicName));
        const editsApplied = ["vertical-framing", plan.captions.groups.some(group => group.activeWord) ? "active-word-captions" : "captions",
          ...(plan.zoomEvents.length ? ["event-driven-zoom"] : []), ...(plan.silenceCuts.length ? ["measured-silence-trim"] : []), ...(musicName ? ["licensed-music", "voice-ducking"] : [])];
        const result: RenderedClip = { id: candidate.id, file: `${candidate.id}.mp4`, start: candidate.start, end: candidate.end, duration: output.durationSeconds, width: profile.width, height: profile.height, checksum, size: stat.size, status: "completed" as const, candidate, editPlan: plan,
          ...(input.report.portfolio ? { finalQuality: evaluateFinalCandidate(candidate) } : {}),
          ...(render.visual ? { visualCompositionPlan: render.visual } : {}),
          assets: { ...(musicName && render.assets.music ? { musicId: render.assets.music.id } : {}), warnings: render.assets.warnings },
          metadata: { videoCodec: "h264" as const, audioCodec: "aac" as const, subtitlesBurned: true as const, cueCount: plan.captions.groups.length, layout: plan.framing.mode, renderSeconds: (performance.now() - started) / 1000, editsApplied, editPlanVersion: plan.version } };
        if (render.visual) {
          result.metadata.editsApplied?.push("visual-composition", render.visual.template);
          result.socialPackage = await generateSocialPackage({ clip: result, visual: render.visual, source: context.input, sourceHash, projectId: input.uploadId, work, signal: context.signal });
        }
        return result;
      }, input.signal, { timeoutMs: null });
      clips.push(clip);
      if (batch) batch = await input.storage.append(batch, clip);
      else {
        batch = { schemaVersion: 1, uploadId: input.uploadId, batchId, createdAt: new Date().toISOString(), analysisVersion: input.report.analysisVersion,
          renderVersion: input.renderVersion ?? PLANNED_RENDER_VERSION, sourceHash, analysisHash: digest(input.report), report: input.report, clips: [...clips], requestedIds: input.candidates.map(item => item.id),
          ...(input.preferences ? { preferences: input.preferences } : {}) };
        if (input.selection) batch.selection = input.selection;
        await input.storage.publish(batch); created = false;
      }
      if (created) { await input.storage.clearWork(batchId); created = false; }
      input.onStage("rendering-clips", clips.length, input.candidates.length);
    }
    input.signal.throwIfAborted();
    if (!batch) throw new ProcessingError("INVALID_OUTPUT", "Nenhum corte foi persistido.");
    return batch;
  } finally { try { if (created) await input.storage.clearWork(batchId); } finally { release(); } }
}
