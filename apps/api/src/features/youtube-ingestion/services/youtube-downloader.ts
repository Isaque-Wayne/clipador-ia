import type { YouTubeDownloader } from "../types/ingestion.js";
import { createYtdlpRunner, metadataArguments } from "./run-ytdlp.js";
import { parseVideoInfo } from "../utils/parse-video-info.js";
import { createYtdlpStream } from "./stream-ytdlp.js";
import type { TransferSummary } from "./stream-ytdlp.js";
import { mergeVideo } from "./merge-video.js";
import { validateMergedOutput } from "./validate-merged-output.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { summarizeFormats } from "../utils/video-formats.js";
import { downloadArguments } from "./downloader-command.js";
import { sanitizeDiagnostic } from "../types/diagnostic.js";

export function createYouTubeDownloader(onFailure?: (message: string) => void, onInfo?: (value: unknown) => void,
  onTransfer?: (summary: TransferSummary) => void): YouTubeDownloader {
  return { async prepare(reference, signal, onStatus, onProgress, observe) {
    observe?.({ stage: "metadata", arguments: metadataArguments(reference) });
    const resolveInfo = createYtdlpRunner(message => { onFailure?.(message); observe?.({ stage: "metadata", stderr: sanitizeDiagnostic(message) }); });
    const openStream = createYtdlpStream({ ...(onFailure ? { onDiagnostic: onFailure } : {}), onTransfer: summary => {
      onTransfer?.(summary); observe?.({ stage: "progressive", attempt: 1, ...summary, stderr: sanitizeDiagnostic(summary.stderr) });
    }, ...(onProgress ? { onProgress } : {}) });
    const info = await resolveInfo(reference, signal);
    onInfo?.(info);
    const extractor = typeof info === "object" && info !== null && "extractor" in info && typeof info.extractor === "string" ? info.extractor.slice(0, 100) : undefined;
    observe?.({ stage: "metadata", ...(extractor ? { extractor } : {}), formats: summarizeFormats(info).slice(0, 100) });
    const { extension, selection, ...input } = parseVideoInfo(info, reference);
    if (selection.mode === "progressive") return { ...input, open: (downloadSignal) => {
      observe?.({ stage: "progressive", attempt: 1, arguments: downloadArguments(reference, extension) });
      return openStream(reference, extension, downloadSignal);
    } };
    return { ...input, workspace: true,
      validateOutput: (path, outputSignal) => validateMergedOutput(path, outputSignal, input.source.durationSeconds),
      open: (downloadSignal, context) => {
        if (!context) throw new UploadValidationError("Workspace de merge indisponível.", 500);
        return mergeVideo(reference, selection, context, downloadSignal, onStatus, onFailure, onTransfer, {}, onProgress, observe);
      } };
  } };
}
