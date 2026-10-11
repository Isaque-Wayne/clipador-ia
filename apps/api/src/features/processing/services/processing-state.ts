import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UploadService } from "../../uploads/services/receive-video.js";
import type { ProcessingJob, ProcessingStatus } from "../types.js";
import type { ClipBatch } from "../../clip-rendering/types.js";
import { digest, isCandidateId } from "../../analysis/services/analysis-persistence.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";
import { uploadPath } from "../../uploads/services/storage-paths.js";
import { ProcessingError } from "./processing-error.js";

interface SavedState { status: ProcessingStatus; preferences: NonNullable<ClipBatch["preferences"]>; selectedIds?: string[]; renderVersion?: string }
export function createProcessingState(uploads: UploadService, portfolio: boolean) {
  const name = portfolio ? "processing-portfolio.json" : "processing-legacy.json";
  return {
    async write(id: string, job: ProcessingJob) {
      const sourceHash = uploads.findUpload(id)?.checksum?.value;
      if (!sourceHash || !job.preferences) return;
      const state: SavedState = { status: job.status, preferences: job.preferences, ...(job.selectedIds ? { selectedIds: job.selectedIds } : {}), ...(job.renderVersion ? { renderVersion: job.renderVersion } : {}) };
      await uploads.writeProcessingState(id, name, JSON.stringify({ schemaVersion: 1, sourceHash, state, checksum: digest(state) }));
    },
    async read(id: string): Promise<SavedState | null> {
      const metadata = uploads.findUpload(id); if (!metadata) return null;
      try {
        const path = join(await uploadPath(await uploads.storageRoot(), id), name), stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024) throw new Error("Invalid state file");
        const envelope: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!record(envelope) || envelope["schemaVersion"] !== 1 || envelope["sourceHash"] !== metadata.checksum?.value || digest(envelope["state"]) !== envelope["checksum"] || !record(envelope["state"])) throw new Error("Invalid state checksum");
        const state = envelope["state"], status = state["status"], preferences = state["preferences"];
        if (!record(status) || status["uploadId"] !== id || !["not-started", "preparing-audio", "transcribing", "transcribed", "analyzing", "selecting-clips", "planning-edits", "resolving-assets", "rendering-subtitles", "rendering-clips", "completed", "failed"].includes(String(status["stage"]))
          || !record(preferences) || !["auto", "few", "normal", "many", "maximum"].includes(String(preferences["quantity"])) || !["AUTO", "CLEAN", "DYNAMIC", "STORY", "EMOTIONAL", "EDUCATIONAL", "PODCAST"].includes(String(preferences["style"]))) throw new Error("Invalid state");
        const ids = state["selectedIds"];
        if (state["renderVersion"] !== undefined && typeof state["renderVersion"] !== "string") throw new Error("Invalid render version");
        if (ids !== undefined && (!Array.isArray(ids) || ids.length < 1 || ids.length > 1280 || !ids.every(id => typeof id === "string" && isCandidateId(id)) || new Set(ids).size !== ids.length)) throw new Error("Invalid state selection");
        const error = status["error"];
        if (error !== undefined && (!record(error) || typeof error["code"] !== "string" || typeof error["message"] !== "string")) throw new Error("Invalid error");
        if (record(error)) for (const key of ["usedBytes", "limitBytes", "requiredBytes", "projectCount", "timeoutMs", "elapsedMs"] as const) if (error[key] !== undefined && (typeof error[key] !== "number" || !Number.isFinite(error[key]) || error[key] < 0)) throw new Error("Invalid error details");
        for (const key of ["renderedCount", "selectedCount"] as const) if (status[key] !== undefined && (!Number.isSafeInteger(status[key]) || Number(status[key]) < 0 || Number(status[key]) > 1280)) throw new Error("Invalid count");
        return state as unknown as SavedState;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
        throw new ProcessingError("INVALID_PROCESSING_STATE", "Estado persistido do processamento inválido.", 409);
      }
    },
  };
}
