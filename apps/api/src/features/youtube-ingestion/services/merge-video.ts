import { lstat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import type { StagingContext, OpenedVideo } from "../../uploads/services/persist-video-input.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import type { VideoInputSelection } from "../utils/select-input.js";
import { mergeArguments } from "../utils/ffmpeg-command.js";
import { runMediaTool } from "./ffmpeg-runner.js";
import { createYtdlpStream } from "./stream-ytdlp.js";
import type { TransferSummary } from "./stream-ytdlp.js";
import type { IngestionStatus } from "../types/ingestion.js";
import { downloadTrack } from "./download-track.js";
import { trackArguments } from "./downloader-command.js";
import type { DiagnosticObserver } from "../types/diagnostic.js";
import { sanitizeDiagnostic } from "../types/diagnostic.js";

export interface MergeDependencies {
  download?: ReturnType<typeof createYtdlpStream>;
  merge?: (directory: string, signal: AbortSignal) => Promise<OpenedVideo>;
}
export async function mergeVideo(reference: YouTubeReference, selection: Extract<VideoInputSelection, { mode: "separate" }>,
  context: StagingContext, signal: AbortSignal, onStatus?: (status: IngestionStatus) => void,
  onDiagnostic?: (message: string) => void, onTransfer?: (summary: TransferSummary) => void, dependencies: MergeDependencies = {}, onProgress?: (bytes: number) => void, observe?: DiagnosticObserver): Promise<OpenedVideo> {
  const created: string[] = [];
  let stored = 0;
  const clean = async () => {
    for (const name of created) {
      const path = join(context.directory, name);
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Temporário de merge inseguro.");
      await unlink(path);
    }
    created.length = 0;
  };
  let current: { stage: "video" | "audio"; formatId: string; attempt: number } | undefined;
  const download = dependencies.download ?? createYtdlpStream({ ...(onDiagnostic ? { onDiagnostic } : {}), onTransfer: summary => {
    onTransfer?.(summary);
    if (current) observe?.({ ...current, ...summary, stderr: sanitizeDiagnostic(summary.stderr) });
  },
    ...(onProgress ? { onProgress: bytes => onProgress(stored + bytes) } : {}) });
  try {
    for (const [kind, track] of [["video", selection.video], ["audio", selection.audio]] as const) {
      signal.throwIfAborted();
      onStatus?.(kind === "video" ? "downloading-video" : "downloading-audio");
      const result = await downloadTrack(reference, kind, track, context, stored, signal, download, (candidate, attempt) => {
        current = { stage: kind, formatId: candidate.id, attempt };
        observe?.({ ...current, arguments: trackArguments(reference, candidate.id) });
        onProgress?.(stored);
      });
      created.push(result.name);
      stored += result.size;
    }
    onStatus?.("merging");
    const merged = await (dependencies.merge ? dependencies.merge(context.directory, signal)
      : runMediaTool("ffmpeg", mergeArguments(context.directory), signal, { ...(onDiagnostic ? { onDiagnostic } : {}), ...(onTransfer ? { onTransfer } : {}) }));
    return { ...merged, dispose: async () => { try { await merged.dispose?.(); } finally { await clean(); } } };
  } catch (error) {
    await clean();
    throw error instanceof Error ? error : new UploadValidationError("Falha ao preparar merge.", 502);
  }
}
