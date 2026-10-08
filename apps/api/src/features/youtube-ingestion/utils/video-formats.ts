import { UploadValidationError } from "../../uploads/utils/validate-video.js";

export function videoFormats(info: Record<string, unknown>): Record<string, unknown>[] {
  const values: unknown[] = Array.isArray(info["formats"]) ? info["formats"] : [info];
  return values.filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
}

export function isProgressive(format: Record<string, unknown>): boolean {
  return ["mp4", "webm"].includes(String(format["ext"])) && format["protocol"] === "https"
    && typeof format["url"] === "string"
    && typeof format["acodec"] === "string" && !["none", "unknown"].includes(format["acodec"])
    && typeof format["vcodec"] === "string" && !["none", "unknown"].includes(format["vcodec"]);
}

export function selectProgressive(info: Record<string, unknown>): Record<string, unknown> {
  // yt-dlp ordena formats da menor para a maior preferência. Sem juntar faixas separadas.
  const selected = videoFormats(info).filter(isProgressive).at(-1);
  if (!selected) throw new UploadValidationError(
    "Não há formato progressivo MP4/WebM com áudio e vídeo via HTTPS. Formatos separados ou segmentados não são suportados sem FFmpeg.", 422);
  return selected;
}

// Evidência estruturada sem URLs assinadas, cookies ou caminhos internos.
export function summarizeFormats(value: unknown) {
  if (typeof value !== "object" || value === null) return [];
  return videoFormats(value as Record<string, unknown>).map((format) => ({
    id: typeof format["format_id"] === "string" ? format["format_id"].slice(0, 100) : null,
    extension: format["ext"], protocol: format["protocol"], audioCodec: format["acodec"],
    videoCodec: format["vcodec"], height: format["height"], estimatedBytes: format["filesize"] ?? format["filesize_approx"],
    compatible: isProgressive(format),
  }));
}
