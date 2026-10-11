import { lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import type { StagingContext } from "../../uploads/services/persist-video-input.js";
import { writeVideoStream } from "../../uploads/services/write-video-stream.js";
import { MAX_VIDEO_BYTES, validateVideoSize } from "../../uploads/utils/validate-video.js";
import { withStageDeadline } from "../../pipeline/services/stage-deadline.js";
import { YouTubeDownloaderError } from "../utils/downloader-error.js";
import type { TrackSelection } from "../utils/select-input.js";
import type { createYtdlpStream } from "./stream-ytdlp.js";

export async function downloadTrack(reference: YouTubeReference, kind: "video" | "audio", track: TrackSelection,
  context: StagingContext, stored: number, signal: AbortSignal, download: ReturnType<typeof createYtdlpStream>,
  onAttempt?: (track: TrackSelection, attempt: number) => void) {
  return withStageDeadline("download", signal, async signal => {
    const candidates = [track, ...(track.fallbacks ?? []).slice(0, 1)];
    const name = `track-${kind}.part`, path = join(context.directory, name);
    for (const [index, candidate] of candidates.entries()) {
      signal.throwIfAborted();
      onAttempt?.(candidate, index + 1);
      const file = await open(path, "wx", 0o600);
      let succeeded = false;
      try {
        const opened = await download(reference, "mp4", signal, candidate.id);
        let result;
        try {
          opened.content.on("error", () => {});
          result = await writeVideoStream(opened.content, file, MAX_VIDEO_BYTES, signal, undefined, size => {
            validateVideoSize(stored + size); context.reserveTemporaryBytes(stored + size);
          });
        } finally { await opened.dispose?.(); }
        succeeded = true;
        return { name, size: result.size };
      } catch (error) {
        signal.throwIfAborted();
        const forbidden = error instanceof YouTubeDownloaderError && (error.code === "PROVIDER_HTTP_403"
          || error.code === "FORMAT_BLOCKED" && error.providerStatus === 403);
        if (!forbidden || index + 1 >= candidates.length) throw error;
      } finally {
        await file.close();
        if (!succeeded) {
          const stat = await lstat(path);
          if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Temporário de faixa inseguro.");
          await unlink(path);
          context.reserveTemporaryBytes(stored);
        }
      }
    }
    throw new Error("Nenhum candidato concluído.");
  });
}
