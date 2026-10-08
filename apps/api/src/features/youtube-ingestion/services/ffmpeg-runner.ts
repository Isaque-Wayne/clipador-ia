import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { openProcessStream } from "./stream-process.js";
import type { ProcessStreamOptions } from "./stream-process.js";

export async function mediaTool(name: "ffmpeg" | "ffprobe") {
  const directory = fileURLToPath(new URL("../../../../../../tools/ffmpeg/", import.meta.url));
  const path = resolve(directory, "bin", `${name}.exe`);
  try {
    const data: unknown = JSON.parse(await readFile(resolve(directory, "installation.json"), "utf8"));
    if (typeof data !== "object" || data === null || !("source" in data) || typeof data.source !== "string"
      || !data.source.startsWith("https://github.com/BtbN/FFmpeg-Builds/releases/download/") || !("executables" in data)
      || typeof data.executables !== "object" || data.executables === null) throw new Error("Manifesto inválido");
    const entry: unknown = (data.executables as Record<string, unknown>)[name];
    if (typeof entry !== "object" || entry === null || !("sha256" in entry) || typeof entry.sha256 !== "string") throw new Error("Hash ausente");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest("hex") !== entry.sha256) throw new Error("Hash divergente");
    return path;
  } catch { throw new UploadValidationError(`${name} local ausente ou com integridade inválida.`, 503); }
}
export async function runMediaTool(name: "ffmpeg" | "ffprobe", args: string[], signal: AbortSignal, options: ProcessStreamOptions = {}) {
  const executable = await mediaTool(name);
  return openProcessStream(executable, args, signal, { ...options,
    mapFailure: options.mapFailure ?? (() => new UploadValidationError(name === "ffmpeg" ? "FFmpeg falhou ao combinar as faixas sem reencode."
      : "FFprobe não conseguiu validar o resultado do merge.", 502)) });
}
