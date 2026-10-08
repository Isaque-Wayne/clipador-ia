import { randomUUID } from "node:crypto";
import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";
import type { UploadService } from "../../uploads/services/receive-video.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { mediaConnectionError } from "../utils/downloader-error.js";
import type { IngestionRecord, YouTubeDownloader } from "../types/ingestion.js";

export function createYouTubeIngestion(uploads: UploadService, downloader: YouTubeDownloader) {
  const transient = new Map<string, IngestionRecord>();
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
  async function ingest(value: unknown, signal: AbortSignal) {
    let reference;
    try { reference = parseYouTubeUrl(value); }
    catch (error) { throw new UploadValidationError(error instanceof Error ? error.message : "URL inválida."); }
    prune();
    const record: IngestionRecord = { id: randomUUID(), createdAt: new Date(uploads.now()).toISOString(), status: "pending" };
    transient.set(record.id, record);
    try {
      const upload = await uploads.receivePreparedVideo(async (operationSignal) => {
        record.status = "fetching-metadata";
        const input = await downloader.prepare(reference, operationSignal, (status) => { record.status = status; });
        if (input.source) record.video = input.source;
        return { ...input, open: async (downloadSignal, context) => {
          record.status = "downloading";
          return input.open(downloadSignal, context);
        } };
      }, signal, record.id);
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
      record.status = "failed"; record.message = message;
      return { statusCode, body: { success: false, message, ingestion: structuredClone(record) } };
    }
  }
  return { ingest, find };
}
