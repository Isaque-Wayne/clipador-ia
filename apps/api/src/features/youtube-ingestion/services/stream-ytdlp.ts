import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import { downloaderExecutable, downloadArguments, trackArguments } from "./downloader-command.js";
import { verifyDownloader } from "./verify-downloader.js";
import { openProcessStream } from "./stream-process.js";
import type { ProcessStreamOptions } from "./stream-process.js";
export type { TransferSummary } from "./stream-process.js";
interface StreamOptions extends ProcessStreamOptions { verify?: typeof verifyDownloader }
export function createYtdlpStream(options: StreamOptions = {}) {
  return async (reference: YouTubeReference, extension: "mp4" | "webm", signal: AbortSignal, formatId?: string) => {
    const args = formatId ? trackArguments(reference, formatId) : downloadArguments(reference, extension);
    const executable = downloaderExecutable();
    await (options.verify ?? verifyDownloader)(executable);
    return openProcessStream(executable, args, signal, options);
  };
}
