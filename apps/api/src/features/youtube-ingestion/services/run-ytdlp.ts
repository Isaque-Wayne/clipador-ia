import { spawn } from "node:child_process";
import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { verifyDownloader } from "./verify-downloader.js";
import { downloaderError } from "../utils/downloader-error.js";
import { downloaderExecutable, commonArguments, canonicalDownloadUrl, PROGRESSIVE_FORMAT } from "./downloader-command.js";

// Consulta independente da disponibilidade de progressivos: formats permanece no JSON.
export const YTDLP_FORMAT = PROGRESSIVE_FORMAT;
export function metadataArguments(reference: YouTubeReference): string[] {
  return [...commonArguments(), "--quiet", "--ignore-no-formats-error",
    "--skip-download", "--dump-single-json", "--format", YTDLP_FORMAT, "--", canonicalDownloadUrl(reference)];
}

export function createYtdlpRunner(onFailure?: (message: string) => void) {
  const executable = downloaderExecutable();
  return async (reference: YouTubeReference, signal: AbortSignal): Promise<unknown> => {
    await verifyDownloader(executable);
    signal.throwIfAborted();
    return new Promise((resolveResult, reject) => {
      const child = spawn(executable, metadataArguments(reference), { shell: false, windowsHide: true,
        signal, stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let length = 0;
      let stderr = "";
      let excessive = false;
      child.stdout.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) { excessive = true; child.kill(); } else chunks.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 16_384) stderr += chunk.toString("utf8").slice(0, 16_384 - stderr.length); });
      child.once("error", () => reject(signal.aborted ? signal.reason : new UploadValidationError("Não foi possível iniciar o downloader.", 503)));
      child.once("close", (code) => {
        if (signal.aborted) return reject(signal.reason);
        if (excessive) return reject(new UploadValidationError("Metadados do vídeo excedem o limite seguro.", 502));
        if (code !== 0) {
          onFailure?.(stderr);
          reject(downloaderError(stderr));
          return;
        }
        if (stderr) onFailure?.(stderr);
        try { resolveResult(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch { reject(new UploadValidationError("O downloader retornou metadados inválidos.", 502)); }
      });
    });
  };
}
