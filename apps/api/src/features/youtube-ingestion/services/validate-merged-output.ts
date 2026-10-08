import { lstat } from "node:fs/promises";
import { validateVideoSize, UploadValidationError } from "../../uploads/utils/validate-video.js";
import { runMediaTool } from "./ffmpeg-runner.js";
import { probeArguments } from "../utils/ffmpeg-command.js";

export function validateProbe(value: unknown, size: number, expectedDuration: number | null): void {
  if (typeof value !== "object" || value === null) throw new UploadValidationError("Saída do FFprobe inválida.", 502);
  const data = value as Record<string, unknown>;
  const streams = data["streams"];
  const format = data["format"];
  if (!Array.isArray(streams) || streams.length !== 2 || typeof format !== "object" || format === null)
    throw new UploadValidationError("O resultado não contém exatamente vídeo e áudio.", 502);
  const records = (streams as unknown[]).filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null);
  const video = records.find((s) => s["codec_type"] === "video");
  const audio = records.find((s) => s["codec_type"] === "audio");
  const details = format as Record<string, unknown>;
  const duration = Number(details["duration"]);
  if (!video || !audio || video["codec_name"] !== "h264" || audio["codec_name"] !== "aac" || Number(details["size"]) !== size
    || !Number.isFinite(duration) || duration <= 0 || (expectedDuration !== null && Math.abs(duration - expectedDuration) > Math.max(2, expectedDuration * 0.05)))
    throw new UploadValidationError("Resultado do merge inválido: codecs, tamanho ou duração divergentes.", 502);
}
export async function validateMergedOutput(path: string, signal: AbortSignal, expectedDuration: number | null) {
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink()) throw new UploadValidationError("Resultado do merge inseguro.", 502);
  validateVideoSize(file.size);
  const process = await runMediaTool("ffprobe", probeArguments(path), signal);
  try {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of process.content) {
      size += chunk.length;
      if (size > 512 * 1024) throw new UploadValidationError("Saída do FFprobe excedeu o limite seguro.", 502);
      chunks.push(chunk);
    }
    let info: unknown;
    try { info = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new UploadValidationError("Saída do FFprobe inválida.", 502); }
    validateProbe(info, file.size, expectedDuration);
  } finally { await process.dispose?.(); }
}
