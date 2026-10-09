import { lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import type { StagingContext, OpenedVideo } from "../../uploads/services/persist-video-input.js";
import { writeVideoStream } from "../../uploads/services/write-video-stream.js";
import { validateVideoSize, MAX_VIDEO_BYTES, UploadValidationError } from "../../uploads/utils/validate-video.js";
import type { VideoInputSelection } from "../utils/select-input.js";
import { mergeArguments } from "../utils/ffmpeg-command.js";
import { runMediaTool } from "./ffmpeg-runner.js";
import { createYtdlpStream } from "./stream-ytdlp.js";
import type { TransferSummary } from "./stream-ytdlp.js";
import type { IngestionStatus } from "../types/ingestion.js";

export interface MergeDependencies {
  download?: ReturnType<typeof createYtdlpStream>;
  merge?: (directory: string, signal: AbortSignal) => Promise<OpenedVideo>;
}
export async function mergeVideo(reference: YouTubeReference, selection: Extract<VideoInputSelection, { mode: "separate" }>,
  context: StagingContext, signal: AbortSignal, onStatus?: (status: IngestionStatus) => void,
  onDiagnostic?: (message: string) => void, onTransfer?: (summary: TransferSummary) => void, dependencies: MergeDependencies = {}, onProgress?: (bytes: number) => void): Promise<OpenedVideo> {
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
  const download = dependencies.download ?? createYtdlpStream({ ...(onDiagnostic ? { onDiagnostic } : {}), ...(onTransfer ? { onTransfer } : {}),
    ...(onProgress ? { onProgress: bytes => onProgress(stored + bytes) } : {}) });
  try {
    for (const [kind, track] of [["video", selection.video], ["audio", selection.audio]] as const) {
      signal.throwIfAborted();
      onStatus?.(kind === "video" ? "downloading-video" : "downloading-audio");
      const name = `track-${kind}.part`;
      const file = await open(join(context.directory, name), "wx", 0o600);
      created.push(name);
      let opened: OpenedVideo | undefined;
      try {
        opened = await download(reference, "mp4", signal, track.id);
        opened.content.on("error", () => {}); // O leitor verifica source.errored entre escritas.
        const result = await writeVideoStream(opened.content, file, MAX_VIDEO_BYTES, signal, undefined, (size) => {
          validateVideoSize(stored + size); context.reserveTemporaryBytes(stored + size);
        });
        stored += result.size;
      } finally { try { await opened?.dispose?.(); } finally { await file.close(); } }
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
