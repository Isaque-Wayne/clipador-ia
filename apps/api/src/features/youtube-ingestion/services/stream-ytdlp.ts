import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import { downloaderExecutable, downloadArguments, trackArguments } from "./downloader-command.js";
import { verifyDownloader } from "./verify-downloader.js";
import { openProcessStream } from "./stream-process.js";
import type { ProcessStreamOptions } from "./stream-process.js";
import { createStageDeadline } from "../../pipeline/services/stage-deadline.js";
export type { TransferSummary } from "./stream-process.js";
interface StreamOptions extends ProcessStreamOptions { verify?: typeof verifyDownloader }
export function createYtdlpStream(options: StreamOptions = {}) {
  return async (reference: YouTubeReference, extension: "mp4" | "webm", signal: AbortSignal, formatId?: string) => {
    const args = formatId ? trackArguments(reference, formatId) : downloadArguments(reference, extension);
    const executable = downloaderExecutable();
    const deadline = createStageDeadline("download", signal);
    try {
      await (options.verify ?? verifyDownloader)(executable);
      deadline.check();
      const opened = await openProcessStream(executable, args, deadline.signal, options);
      return { ...opened, dispose: async () => { try { await opened.dispose?.(); } finally { deadline.dispose(); } } };
    } catch (error) { deadline.dispose(); if (deadline.signal.aborted) throw deadline.signal.reason; throw error; }
  };
}
