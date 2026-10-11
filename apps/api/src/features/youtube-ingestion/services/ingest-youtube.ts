import { randomUUID } from "node:crypto";
import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";
import type { UploadService } from "../../uploads/services/receive-video.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { UploadStorageQuotaError } from "../../uploads/services/storage-quota.js";
import { mediaConnectionError, YouTubeDownloaderError } from "../utils/downloader-error.js";
import type { IngestionRecord, YouTubeDownloader } from "../types/ingestion.js";
import { PipelineTimeoutError, createStageDeadline, withStageDeadline } from "../../pipeline/services/stage-deadline.js";
import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";

export function createYouTubeIngestion(uploads: UploadService, downloader: YouTubeDownloader) {
  const transient = new Map<string, IngestionRecord>();
  const jobs = new Map<string, { abort: AbortController; done: Promise<unknown> }>();
  let closing = false;
  function prune() {
    for (const [id, record] of transient) {
      if (uploads.now() - Date.parse(record.createdAt) >= uploads.retentionMs && record.status === "failed") transient.delete(id);
    }
    // Sucessos são consultados no índice persistente. Falhas recentes têm memória limitada.
    while (transient.size >= 100) {
      const failed = [...transient].find(([, record]) => record.status === "failed");
      if (!failed) break;
      transient.delete(failed[0]);
    }
  }
  function find(id: string): IngestionRecord | undefined {
    prune();
    const upload = uploads.findUpload(id);
    if (upload?.source?.provider === "youtube") return { id, createdAt: upload.createdAt,
      status: upload.status === "failed" ? "failed" : "downloaded", video: upload.source, upload };
    const record = transient.get(id);
    return record ? structuredClone(record) : undefined;
  }
  function referenceFor(value: unknown) {
    try { return parseYouTubeUrl(value); }
    catch (error) { throw new UploadValidationError(error instanceof Error ? error.message : "URL inválida."); }
  }
  function createRecord(status: IngestionRecord["status"], reference: YouTubeReference) {
    prune();
    const record: IngestionRecord = { id: randomUUID(), createdAt: new Date(uploads.now()).toISOString(), status,
      video: { provider: "youtube", ...reference, title: null, durationSeconds: null, thumbnailUrl: null } };
    transient.set(record.id, record);
    return record;
  }
  async function execute(reference: YouTubeReference, record: IngestionRecord, signal: AbortSignal, detached = false) {
    try {
      const upload = await uploads.receivePreparedVideo(async (operationSignal) => {
        record.status = "fetching-metadata";
        const prepare = (signal: AbortSignal) => downloader.prepare(reference, signal, (status) => { record.status = status; }, bytesReceived => {
          record.progress = { ...record.progress, bytesReceived };
        }, event => {
          record.diagnostics ??= [];
          if (record.diagnostics.length < 16) record.diagnostics.push(event);
        });
        const input = detached ? await withStageDeadline("metadata", operationSignal, prepare) : await prepare(operationSignal);
        if (input.source) record.video = input.source;
        if (input.estimatedSize !== undefined) record.progress = { bytesReceived: 0, estimatedBytes: input.estimatedSize };
        return { ...input, open: async (downloadSignal, context) => {
          record.status = "downloading";
          if (!detached || input.workspace) return input.open(downloadSignal, context);
          const deadline = createStageDeadline("download", downloadSignal);
          try {
            const opened = await input.open(deadline.signal, context);
            const aborted = () => opened.content.destroy(deadline.signal.reason);
            deadline.signal.addEventListener("abort", aborted, { once: true });
            if (deadline.signal.aborted) aborted();
            return { ...opened, dispose: async () => {
              try { await opened.dispose?.(); }
              finally { deadline.signal.removeEventListener("abort", aborted); deadline.dispose(); }
            } };
          } catch (error) { deadline.dispose(); if (deadline.signal.aborted) throw deadline.signal.reason; throw error; }
        } };
      }, signal, record.id, detached ? { timeoutMs: null } : {});
      transient.delete(record.id);
      return { statusCode: 200, body: { success: true, ingestion: { ...record, createdAt: upload.createdAt, status: "downloaded" as const, upload } } };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error
        && ["ENOSPC", "EACCES", "EPERM", "EIO", "EEXIST", "ENOENT"].includes(String(error.code))) {
        error = new UploadValidationError("Falha ao persistir o vídeo no armazenamento temporário.", error.code === "ENOSPC" ? 507 : 500);
      }
      if (typeof error === "object" && error !== null && "code" in error
        && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ESOCKETTIMEDOUT", "ERR_STREAM_PREMATURE_CLOSE"].includes(String(error.code))) {
        error = mediaConnectionError(error);
      }
      const statusCode = error instanceof UploadValidationError ? error.statusCode : 502;
      const message = error instanceof UploadValidationError ? error.message : signal.aborted
        ? "A ingestão foi interrompida." : "Falha interna durante a ingestão do vídeo do YouTube.";
      const code = error instanceof PipelineTimeoutError || error instanceof UploadStorageQuotaError || error instanceof YouTubeDownloaderError ? error.code : signal.aborted ? "CANCELLED" : "INGESTION_FAILED";
      record.error = { code, message, stage: error instanceof PipelineTimeoutError ? error.stage : record.status,
        ...(error instanceof PipelineTimeoutError ? { timeoutMs: error.timeoutMs, elapsedMs: error.elapsedMs } : {}) };
      record.status = "failed"; record.message = message; record.code = code; record.finishedAt = new Date(uploads.now()).toISOString();
      return { statusCode, body: { success: false, code, message, ingestion: structuredClone(record) } };
    }
  }
  return {
    async ingest(value: unknown, signal: AbortSignal) {
      const reference = referenceFor(value);
      return execute(reference, createRecord("pending", reference), signal);
    },
    find,
    start(value: unknown) {
      const reference = referenceFor(value);
      if (closing || jobs.size >= uploads.maxConcurrentUploads) throw new UploadValidationError("Há ingestões em andamento. Aguarde a conclusão ou cancele uma delas.", 429);
      const record = createRecord("queued", reference), abort = new AbortController();
      const job = { abort, done: Promise.resolve() as Promise<unknown> };
      jobs.set(record.id, job);
      job.done = Promise.resolve().then(() => execute(reference, record, abort.signal, true)).finally(() => jobs.delete(record.id));
      return structuredClone(record);
    },
    async cancel(id: string) {
      const job = jobs.get(id);
      if (!job) throw new UploadValidationError("Não há ingestão em andamento para cancelar.", 409);
      job.abort.abort(new UploadValidationError("Ingestão cancelada. Os temporários foram removidos.", 409));
      await job.done;
      return find(id);
    },
    async close() {
      closing = true;
      for (const job of jobs.values()) job.abort.abort(new UploadValidationError("Ingestão interrompida pelo encerramento da API.", 409));
      await Promise.allSettled([...jobs.values()].map(job => job.done));
    },
  };
}
