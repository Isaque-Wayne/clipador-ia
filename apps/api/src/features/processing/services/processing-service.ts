import { setTimeout as delay } from "node:timers/promises";
import type { UploadService } from "../../uploads/services/receive-video.js";
import type { TranscriptionService } from "../../transcription/services/transcription-service.js";
import { TranscriptionError } from "../../transcription/services/transcription-error.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import type { AnalysisService } from "../../analysis/services/analysis-service.js";
import { selectCandidates } from "../../analysis/services/select-candidates.js";
import { isCandidateId } from "../../analysis/services/analysis-persistence.js";
import type { ClipStorage } from "../../clip-rendering/services/clip-storage.js";
import { renderClips } from "../../clip-rendering/services/render-clips.js";
import { RENDER_VERSION } from "../../clip-rendering/services/render-commands.js";
import type { ResourceGate } from "./resource-gate.js";
import { ProcessingError } from "./processing-error.js";
import type { ProcessingJob, ProcessingStatus } from "../types.js";
import type { AnalysisReport } from "../../analysis/contracts.js";
import type { CutCandidate } from "../../analysis/candidate.js";
import type { ClipBatch } from "../../clip-rendering/types.js";
import { prepareRenderPlans } from "../../editing/planning/prepare-render-plans.js";
import { resolvePipelineTimeouts } from "../../../../../../config/pipeline-timeouts.mjs";
import { PipelineTimeoutError, withStageDeadline } from "../../pipeline/services/stage-deadline.js";

export interface ProcessingStrategy {
  portfolio?: boolean;
  renderVersion?: string;
  select?: (report: AnalysisReport, quantity: NonNullable<ClipBatch["preferences"]>["quantity"]) => CutCandidate[];
  musicDirectory?: string;
  admission?: ResourceGate;
}

export function createProcessingService(uploads: UploadService, transcription: TranscriptionService, analysis: AnalysisService, storage: ClipStorage, gate: ResourceGate, timeoutMs = resolvePipelineTimeouts().renderClip, onDiagnostic?: (text: string) => void, strategy: ProcessingStrategy = {}) {
  const jobs = new Map<string, ProcessingJob>();
  let active = false, closing = false;
  const matches = (batch: ClipBatch) => Boolean(batch.report.portfolio) === Boolean(strategy.portfolio);
  async function execute(id: string, job: ProcessingJob, preferences: NonNullable<ClipBatch["preferences"]>, releaseAdmission: () => void, selectedIds?: string[]) {
    let ownsTranscription = false;
    try {
      try { const started = await transcription.start(id); ownsTranscription = !started.reused; }
      catch (error) { if (!(error instanceof TranscriptionError && error.code === "IN_PROGRESS")) throw error; }
      while (true) {
        job.abort.signal.throwIfAborted();
        const status = await transcription.status(id);
        if ("progress" in status && status.progress) job.status.progress = status.progress;
        if (status.stage === "completed") break;
        if (status.stage === "failed") throw new ProcessingError(status.error?.code ?? "TRANSCRIPTION_FAILED", status.error?.message ?? "A transcrição falhou.", 500, status.error);
        job.status.stage = status.stage === "preparing-audio" ? "preparing-audio" : "transcribing";
        await delay(200, undefined, { signal: job.abort.signal });
      }
      ownsTranscription = false;
      job.status.stage = "transcribed";
      const transcript = await transcription.result(id);
      job.abort.signal.throwIfAborted(); job.status.stage = "analyzing";
      const { report } = await analysis.start(id, job.abort.signal);
      job.abort.signal.throwIfAborted(); job.status.stage = "selecting-clips";
      const candidates = selectedIds ? selectedIds.map(candidateId => {
        const candidate = report.candidates.find(item => item.id === candidateId);
        if (!candidate) throw new ProcessingError("INVALID_SELECTION", "Um candidato selecionado não pertence à análise atual.", 400);
        return candidate;
      }) : strategy.select ? strategy.select(report, preferences.quantity) : selectCandidates(report.candidates, 3);
      if (!candidates.length) throw new ProcessingError("NO_CANDIDATES", "Não foram encontrados trechos completos para corte. O vídeo e a transcrição foram preservados.", 422);
      job.status.selectedCount = candidates.length;
      job.status.stage = "planning-edits";
      const result = await withStageDeadline("render", job.abort.signal, async signal => {
      const plans = await prepareRenderPlans(uploads, id, transcript, report, candidates, strategy.portfolio ? preferences.style : "CLEAN", signal,
        () => { job.status.stage = "resolving-assets"; }, strategy.musicDirectory);
      return renderClips({ uploads, storage, gate, uploadId: id, transcript, report, candidates, plans, signal, timeoutMs,
        renderVersion: strategy.renderVersion ?? RENDER_VERSION, ...(strategy.portfolio ? { preferences } : {}),
        onStage(stage, completed, total) { job.status.stage = stage; job.status.renderedCount = completed; job.status.selectedCount = total; },
        ...(onDiagnostic ? { onDiagnostic } : {}) });
      });
      job.result = result;
      job.status = { ...job.status, stage: "completed", batchId: result.batchId, renderedCount: result.clips.length, finishedAt: new Date().toISOString() };
    } catch (error) {
      if (ownsTranscription && job.abort.signal.aborted) { try { await transcription.cancel(id); } catch { /* Already completed or failed. */ } }
      const cause = job.abort.signal.aborted ? job.abort.signal.reason : error;
      const known = cause instanceof ProcessingError || cause instanceof TranscriptionError || cause instanceof UploadValidationError;
      if (!known && cause instanceof Error) onDiagnostic?.(cause.stack ?? cause.message);
      job.status = { ...job.status, stage: "failed", finishedAt: new Date().toISOString(), error: {
        code: cause instanceof ProcessingError || cause instanceof TranscriptionError || cause instanceof PipelineTimeoutError ? cause.code : cause instanceof UploadValidationError ? "UPLOAD_ERROR" : "PROCESSING_FAILED",
        message: known ? cause.message : "Não foi possível concluir o processamento. Consulte o diagnóstico da API.",
        ...(cause instanceof PipelineTimeoutError ? { stage: cause.stage, timeoutMs: cause.timeoutMs, elapsedMs: cause.elapsedMs }
          : cause instanceof ProcessingError && cause.details ? cause.details : { stage: job.status.stage }),
      } };
    } finally { active = false; releaseAdmission(); }
  }
  return {
    async start(id: string, selectedIds?: string[], preferences: NonNullable<ClipBatch["preferences"]> = { quantity: "auto", style: "AUTO" }) {
      const maximum = strategy.portfolio ? 1280 : 3;
      if (selectedIds && (selectedIds.length < 1 || selectedIds.length > maximum || new Set(selectedIds).size !== selectedIds.length || selectedIds.some(value => !isCandidateId(value)))) throw new ProcessingError("INVALID_SELECTION", `Selecione IDs distintos dentro do orçamento de ${maximum} candidatos.`, 400);
      const job = jobs.get(id);
      if (job && !["completed", "failed"].includes(job.status.stage)) throw new ProcessingError("IN_PROGRESS", "Este vídeo já está em processamento.", 409);
      if (active || closing) throw new ProcessingError("BUSY", "Há outro vídeo em processamento. Tente novamente ao concluir.", 429);
      active = true;
      let releaseAdmission: (() => void) | undefined;
      try {
        const upload = uploads.findUpload(id);
        const cached = await storage.latest(id, batch => matches(batch) && batch.analysisVersion === analysis.version && batch.renderVersion === (strategy.renderVersion ?? RENDER_VERSION)
          && (!upload || upload.checksum?.value === batch.sourceHash)
          && (!strategy.portfolio || batch.preferences?.quantity === preferences.quantity && batch.preferences.style === preferences.style)
          && (selectedIds ?? (strategy.select ? strategy.select(batch.report, preferences.quantity) : selectCandidates(batch.report.candidates, 3)).map(item => item.id)).join() === batch.clips.map(item => item.id).join());
        if (cached) {
          const status: ProcessingStatus = { uploadId: id, stage: "completed", batchId: cached.batchId, renderedCount: cached.clips.length, selectedCount: cached.clips.length, finishedAt: cached.createdAt };
          jobs.set(id, { status, abort: new AbortController(), done: Promise.resolve(), result: cached }); active = false; return { reused: true, status };
        }
        if (!upload) throw new ProcessingError("NOT_FOUND", "Upload não encontrado ou expirado.", 404);
        if (selectedIds) { const report = await analysis.result(id); if (selectedIds.some(candidateId => !report.candidates.some(item => item.id === candidateId))) throw new ProcessingError("INVALID_SELECTION", "Seleção incompatível com a análise atual.", 400); }
        releaseAdmission = strategy.admission?.acquire();
        const next: ProcessingJob = { status: { uploadId: id, stage: "preparing-audio", startedAt: new Date().toISOString() }, abort: new AbortController(), done: Promise.resolve() };
        jobs.set(id, next); next.done = execute(id, next, preferences, releaseAdmission ?? (() => {}), selectedIds);
        return { reused: false, status: { ...next.status } };
      } catch (error) { active = false; releaseAdmission?.(); throw error; }
    },
    async status(id: string): Promise<ProcessingStatus> {
      const job = jobs.get(id);
      if (job) return structuredClone(job.status);
      const batch = await storage.latest(id, matches);
      if (batch) return { uploadId: id, stage: "completed", batchId: batch.batchId, renderedCount: batch.clips.length, selectedCount: batch.clips.length, finishedAt: batch.createdAt };
      if (!uploads.findUpload(id)) throw new ProcessingError("NOT_FOUND", "Upload não encontrado ou expirado.", 404);
      return { uploadId: id, stage: "not-started" };
    },
    async result(id: string) {
      const completed = jobs.get(id)?.result;
      const batch = completed ? await storage.read(id, completed.batchId) : await storage.latest(id, matches);
      if (!batch) throw new ProcessingError("NOT_COMPLETED", "Nenhum corte concluído para este vídeo.", 409);
      return batch;
    },
    async cancel(id: string) {
      const job = jobs.get(id);
      if (!job || ["completed", "failed"].includes(job.status.stage)) throw new ProcessingError("NOT_RUNNING", "Não há processamento em andamento.", 409);
      job.abort.abort(new ProcessingError("CANCELLED", "Processamento cancelado. O vídeo e os resultados concluídos foram preservados.", 409));
      await job.done; return structuredClone(job.status);
    },
    async close() { closing = true; for (const job of jobs.values()) job.abort.abort(new ProcessingError("CANCELLED", "Processamento interrompido pelo encerramento da API.", 409)); await Promise.allSettled([...jobs.values()].map(job => job.done)); },
  };
}
export type ProcessingService = ReturnType<typeof createProcessingService>;
