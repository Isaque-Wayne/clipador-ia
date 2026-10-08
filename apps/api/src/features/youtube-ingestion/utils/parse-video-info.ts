import type { YouTubeReference } from "../../../../../../config/youtube-url.mjs";
import type { YouTubeSource } from "../../uploads/types/upload.js";
import { validateVideoSize, UploadValidationError } from "../../uploads/utils/validate-video.js";
import { selectInput } from "./select-input.js";
import { validateMediaUrl } from "./media-url.js";

export function parseVideoInfo(value: unknown, reference: YouTubeReference) {
  if (typeof value !== "object" || value === null) throw new UploadValidationError("Metadados inválidos.", 502);
  const info = value as Record<string, unknown>;
  if (info["id"] !== reference.videoId || info["_type"] === "playlist" || info["is_live"] === true
    || ["is_live", "is_upcoming", "post_live"].includes(String(info["live_status"]))) {
    throw new UploadValidationError("Use um vídeo publicado; playlists e transmissões ao vivo não são suportadas.", 422);
  }
  if (info["availability"] === "private") throw new UploadValidationError("O vídeo do YouTube é privado.", 422);
  if (["premium_only", "subscriber_only", "needs_auth"].includes(String(info["availability"])))
    throw new UploadValidationError("O vídeo do YouTube tem restrição de acesso.", 422);
  const selection = selectInput(info);
  const format = selection.mode === "progressive" ? selection.format : undefined;
  // Validar o diagnóstico, sem devolver nem requisitar a URL assinada pelo Node.
  if (format) validateMediaUrl(String(format["url"]));
  const extension = selection.extension;
  const size = format ? format["filesize"] ?? format["filesize_approx"] : selection.mode === "separate" ? selection.estimatedSize : undefined;
  if (size !== undefined && size !== null) {
    if (typeof size !== "number") throw new UploadValidationError("Estimativa de tamanho inválida.", 502);
    validateVideoSize(Math.ceil(size));
  }
  const duration = info["duration"];
  const source: YouTubeSource = { provider: "youtube", ...reference,
    title: typeof info["title"] === "string" ? info["title"].slice(0, 200) : null,
    durationSeconds: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null,
    thumbnailUrl: typeof info["thumbnail"] === "string" ? `https://i.ytimg.com/vi/${reference.videoId}/hqdefault.jpg` : null };
  const plan = selection.mode === "progressive" ? { mode: "progressive" as const, extension } : selection;
  return { source, selection: plan, extension, name: `youtube_${reference.videoId}.${extension}`, type: extension === "mp4" ? "video/mp4" : "video/webm",
    ...(typeof size === "number" ? { estimatedSize: Math.ceil(size) } : {}) };
}
