import { prepareStorageRoot, uploadPath } from "../../uploads/services/storage-paths.js";
import { DEFAULT_UPLOAD_DIRECTORY } from "../../uploads/services/temporary-video-storage.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import type { UploadService } from "../../uploads/services/receive-video.js";
import type { TranscriptionOptions, TranscriptionStatus } from "../types/status.js";
import { createFasterWhisperEngine } from "./faster-whisper-engine.js";
import { normalizeTranscript } from "./normalize-transcript.js";
import { readTranscript, persistTranscript, removePartial } from "./transcript-persistence.js";
import { TranscriptionError, cancellation } from "./transcription-error.js";
import { inspectVideo } from "../../video-preparation/services/inspect-video.js";
import { withPreparedAudio } from "../../video-preparation/services/prepare-audio.js";
import { resolvePipelineTimeouts } from "../../../../../../config/pipeline-timeouts.mjs";
import { PipelineTimeoutError, withStageDeadline } from "../../pipeline/services/stage-deadline.js";

interface Job { status: TranscriptionStatus; abort: AbortController; done: Promise<void>; release?: () => void }
export function createTranscriptionService(uploads: UploadService, directory = DEFAULT_UPLOAD_DIRECTORY, options: TranscriptionOptions = {}) {
  const jobs = new Map<string, Job>();
  const engine = options.engine ?? createFasterWhisperEngine();
  const timeoutMs = options.timeoutMs ?? resolvePipelineTimeouts().transcription;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error("Timeout de transcrição inválido.");
  let active = false, closing = false;
  function metadata(id: string) {
    const upload = uploads.findUpload(id);
    if (!upload) throw new UploadValidationError("Upload não encontrado ou expirado.", 404);
    if (upload.status === "failed") throw new UploadValidationError("Upload indisponível para transcrição.", 409);
    return upload;
  }
  async function stored(id: string) {
    const upload = metadata(id);
    const result = await readTranscript(await uploadPath(await prepareStorageRoot(directory), id), upload.checksum);
    if (result && result.status.uploadId !== id) throw new TranscriptionError("INVALID_RESULT", "Transcrição associada a outro upload.", 409);
    return result;
  }
  async function execute(id: string, job: Job) {
    let completedStatus: TranscriptionStatus | undefined;
    try {
      await uploads.prepareUpload(id, async context => {
        await removePartial(context.directory, "transcript.json.part");
        await removePartial(context.directory, "audio-asr.wav.part");
        const consume = async (path: string) => {
          job.status.stage = "transcribing";
          const raw = await withStageDeadline("transcription", context.signal,
            signal => engine.transcribe(path, signal, progress => { job.status.progress = progress; }), timeoutMs);
          context.signal.throwIfAborted();
          job.status.stage = "normalizing";
          let transcript;
          try { transcript = normalizeTranscript(raw); }
          catch { throw new TranscriptionError("INVALID_RESULT", "A engine retornou uma transcrição inválida."); }
          const checksum = metadata(id).checksum;
          if (!checksum) throw new TranscriptionError("INVALID_INPUT", "Upload sem checksum.", 409);
          job.status.stage = "persisting";
          const completed: TranscriptionStatus = { ...job.status, stage: "completed", finishedAt: new Date().toISOString() };
          await persistTranscript(context.directory, checksum, completed, transcript, context.reserve, context.signal);
          completedStatus = completed;
        };
        if (options.prepareAudio) await options.prepareAudio(context, consume);
        else {
          const inspection = await inspectVideo(context.input, context.signal);
          await context.persistInspection(inspection);
          await withPreparedAudio(context.input, context.directory, inspection, context.signal, context.reserve, consume);
        }
      }, job.abort.signal, { timeoutMs: null });
      if (!completedStatus) throw new TranscriptionError("INVALID_RESULT", "A preparação terminou sem transcrição.");
      job.status = completedStatus;
    } catch (error) {
      const known = job.abort.signal.aborted ? job.abort.signal.reason : error;
      job.status = { ...job.status, stage: "failed", finishedAt: new Date().toISOString(), error: {
        code: known instanceof TranscriptionError ? known.code : known instanceof UploadValidationError ? (known.statusCode === 408 ? "TIMEOUT" : "PREPARATION_FAILED") : "PROCESSING_FAILED",
        message: known instanceof TranscriptionError || known instanceof UploadValidationError ? known.message : "Não foi possível concluir a transcrição.",
        ...(known instanceof PipelineTimeoutError ? { stage: known.stage, timeoutMs: known.timeoutMs, elapsedMs: known.elapsedMs } : { stage: job.status.stage }),
      } };
    } finally { job.release?.(); active = false; }
  }
  return {
    async start(id: string) {
      metadata(id);
      const existing = jobs.get(id);
      if (existing && !["completed", "failed"].includes(existing.status.stage))
        throw new TranscriptionError("IN_PROGRESS", "Transcrição já em andamento.", 409);
      if (active || closing) throw new TranscriptionError("BUSY", "A engine está ocupada. Tente novamente após a transcrição atual.", 429);
      active = true;
      try {
        const cached = await stored(id);
        if (cached) {
          await uploads.prepareUpload(id, async context => {
            await removePartial(context.directory, "transcript.json.part");
            await removePartial(context.directory, "audio-asr.wav.part");
          });
          jobs.delete(id);
          active = false;
          return { reused: true, status: cached.status };
        }
        const job: Job = { status: { uploadId: id, stage: "preparing-audio", startedAt: new Date().toISOString() },
          abort: new AbortController(), done: Promise.resolve() };
        if (options.resourceGate) job.release = options.resourceGate.acquire();
        jobs.set(id, job);
        job.done = execute(id, job);
        return { reused: false, status: { ...job.status } };
      } catch (error) { active = false; throw error; }
    },
    async status(id: string) {
      metadata(id);
      const job = jobs.get(id);
      if (job && job.status.stage !== "completed") return structuredClone(job.status);
      const cached = await stored(id);
      return cached?.status ?? (job ? structuredClone(job.status) : { uploadId: id, stage: "not-started" as const });
    },
    async result(id: string) {
      const job = jobs.get(id);
      if (job && !["completed", "failed"].includes(job.status.stage))
        throw new TranscriptionError("IN_PROGRESS", "Transcrição ainda em andamento.", 409);
      if (job?.status.stage === "failed")
        throw new TranscriptionError("NOT_COMPLETED", "A última tentativa falhou. Consulte o status ou inicie novamente.", 409);
      const result = await stored(id);
      if (!result) throw new TranscriptionError("NOT_COMPLETED", "A transcrição ainda não foi concluída.", 409);
      return result.transcript;
    },
    async cancel(id: string) {
      metadata(id);
      const job = jobs.get(id);
      if (!job || ["completed", "failed"].includes(job.status.stage)) throw new TranscriptionError("NOT_RUNNING", "Não há transcrição em andamento.", 409);
      job.abort.abort(cancellation()); await job.done;
      return structuredClone(job.status);
    },
    async close() { closing = true; for (const job of jobs.values()) job.abort.abort(cancellation()); await Promise.allSettled([...jobs.values()].map(job => job.done)); },
  };
}
export type TranscriptionService = ReturnType<typeof createTranscriptionService>;
