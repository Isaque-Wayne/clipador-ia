import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";

export const PROGRESSIVE_FORMAT = "b[protocol=https][ext~='^(mp4|webm)$']";
export function downloaderExecutable(): string {
  return resolve(process.env["YTDLP_PATH"] ?? fileURLToPath(new URL("../../../../../../tools/yt-dlp/yt-dlp.exe", import.meta.url)));
}
export function commonArguments(): string[] {
  return ["--ignore-config", "--no-plugin-dirs", "--no-playlist", "--no-remote-components", "--no-cache-dir",
    "--no-js-runtimes", "--js-runtimes", `node:${process.execPath}`, "--use-extractors", "youtube",
    "--proxy", "", "--socket-timeout", "15", "--retries", "1", "--no-colors"];
}
export function canonicalDownloadUrl(reference: YouTubeReference): string {
  const validated = parseYouTubeUrl(reference.url);
  if (validated.videoId !== reference.videoId) throw new Error("Referência YouTube inconsistente.");
  return validated.url;
}
export function downloadArguments(reference: YouTubeReference, extension: "mp4" | "webm"): string[] {
  // Apenas o container já validado é fixado; o yt-dlp seleciona o melhor progressivo, sem ID fixo.
  return [...commonArguments(), "--no-progress", "--no-part", "--no-continue", "--fixup", "never",
    "--format", `b[protocol=https][ext=${extension}]`, "--output", "-", "--", canonicalDownloadUrl(reference)];
}
export function trackArguments(reference: YouTubeReference, formatId: string): string[] {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(formatId)) throw new Error("ID de formato inseguro.");
  return [...commonArguments(), "--no-progress", "--no-part", "--no-continue", "--fixup", "never",
    "--format", `${formatId}[protocol=https]`, "--output", "-", "--", canonicalDownloadUrl(reference)];
}
