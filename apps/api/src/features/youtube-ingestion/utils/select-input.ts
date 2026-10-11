import { videoFormats, isProgressive } from "./video-formats.js";
import { validateVideoSize, UploadValidationError } from "../../uploads/utils/validate-video.js";

export interface TrackSelection { id: string; size?: number; extension: string; codec: string; height?: number; fallbacks?: TrackSelection[] }
export type VideoInputSelection = { mode: "progressive"; extension: "mp4" | "webm"; format: Record<string, unknown> }
  | { mode: "separate"; extension: "mp4"; video: TrackSelection; audio: TrackSelection; estimatedSize?: number };
function track(format: Record<string, unknown>, kind: "video" | "audio"): TrackSelection {
  const id = format["format_id"];
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new UploadValidationError("ID de formato inválido.", 502);
  const size = format["filesize"] ?? format["filesize_approx"];
  if (size !== undefined && size !== null) { if (typeof size !== "number") throw new UploadValidationError("Tamanho de faixa inválido.", 502); validateVideoSize(Math.ceil(size)); }
  return { id, extension: String(format["ext"]), codec: String(format[kind === "video" ? "vcodec" : "acodec"]),
    ...(typeof format["height"] === "number" ? { height: format["height"] } : {}), ...(typeof size === "number" ? { size: Math.ceil(size) } : {}) };
}
export function selectInput(info: Record<string, unknown>): VideoInputSelection {
  const formats = videoFormats(info);
  const progressive = formats.filter(isProgressive).at(-1);
  if (progressive) return { mode: "progressive", extension: progressive["ext"] === "webm" ? "webm" : "mp4", format: progressive };
  // MP4 H.264 + AAC: remux sem reencode e ampla compatibilidade com o pipeline futuro.
  const videos = formats.filter((f) => f["protocol"] === "https" && f["ext"] === "mp4"
    && f["acodec"] === "none" && /^avc1|^h264/.test(String(f["vcodec"])) && typeof f["height"] === "number");
  const reasonable = videos.filter((f) => Number(f["height"]) <= 720 && Number(f["fps"] ?? 30) <= 60);
  const videoFormat = reasonable.at(-1) ?? [...videos].sort((a, b) => Number(a["height"]) - Number(b["height"]))[0];
  const audios = formats.filter((f) => f["protocol"] === "https" && ["m4a", "mp4"].includes(String(f["ext"]))
    && f["vcodec"] === "none" && /^(mp4a|aac)/.test(String(f["acodec"])));
  const normalAudio = audios.filter((f) => !String(f["format_id"]).endsWith("-drc") && Number(f["abr"] ?? 128) <= 192);
  const audioFormat = normalAudio.at(-1) ?? audios.at(-1);
  if (!videoFormat || !audioFormat) throw new UploadValidationError("Não há progressivo nem par de faixas H.264/AAC compatível com remux MP4 sem transcode.", 422);
  const video = track(videoFormat, "video"); const audio = track(audioFormat, "audio");
  const nextVideo = [...videos].reverse().find(f => f["format_id"] !== video.id && Number(f["height"]) <= Number(video.height)
    && Number(f["fps"] ?? 30) <= 60);
  const nextAudio = [...normalAudio].reverse().find(f => f["format_id"] !== audio.id);
  if (nextVideo) video.fallbacks = [track(nextVideo, "video")];
  if (nextAudio) audio.fallbacks = [track(nextAudio, "audio")];
  const estimatedSize = video.size !== undefined && audio.size !== undefined ? video.size + audio.size : undefined;
  if (estimatedSize !== undefined) validateVideoSize(estimatedSize);
  return { mode: "separate", extension: "mp4", video, audio, ...(estimatedSize === undefined ? {} : { estimatedSize }) };
}
