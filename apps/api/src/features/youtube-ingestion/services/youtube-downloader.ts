import type { YouTubeDownloader } from "../types/ingestion.js";
import { createYtdlpRunner } from "./run-ytdlp.js";
import { parseVideoInfo } from "../utils/parse-video-info.js";
import { createYtdlpStream } from "./stream-ytdlp.js";
import type { TransferSummary } from "./stream-ytdlp.js";
import { mergeVideo } from "./merge-video.js";
import { validateMergedOutput } from "./validate-merged-output.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";

export function createYouTubeDownloader(onFailure?: (message: string) => void, onInfo?: (value: unknown) => void,
  onTransfer?: (summary: TransferSummary) => void): YouTubeDownloader {
  const resolveInfo = createYtdlpRunner(onFailure);
  return { async prepare(reference, signal, onStatus, onProgress) {
    const openStream = createYtdlpStream({ ...(onFailure ? { onDiagnostic: onFailure } : {}), ...(onTransfer ? { onTransfer } : {}), ...(onProgress ? { onProgress } : {}) });
    const info = await resolveInfo(reference, signal);
    onInfo?.(info);
    const { extension, selection, ...input } = parseVideoInfo(info, reference);
    if (selection.mode === "progressive") return { ...input, open: (downloadSignal) => openStream(reference, extension, downloadSignal) };
    return { ...input, workspace: true,
      validateOutput: (path, outputSignal) => validateMergedOutput(path, outputSignal, input.source.durationSeconds),
      open: (downloadSignal, context) => {
        if (!context) throw new UploadValidationError("Workspace de merge indisponível.", 500);
        return mergeVideo(reference, selection, context, downloadSignal, onStatus, onFailure, onTransfer, {}, onProgress);
      } };
  } };
}
