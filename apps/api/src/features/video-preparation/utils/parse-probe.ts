import type { VideoInspection } from "../types/inspection.js";
import { parseInspection, record } from "./parse-inspection.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";

function ratio(value: unknown, separator: string): number | null {
  if (typeof value !== "string") return null;
  const parts = value.split(separator);
  if (parts.length !== 2) return null;
  const result = Number(parts[0]) / Number(parts[1]);
  return Number.isFinite(result) && result > 0 ? result : null;
}
export function parseProbe(value: unknown): VideoInspection {
  if (!record(value) || !Array.isArray(value["streams"]) || !record(value["format"]))
    throw new UploadValidationError("FFprobe retornou informações técnicas inválidas.", 422);
  const streams = (value["streams"] as unknown[]).filter(record);
  const video = streams.find((stream) => stream["codec_type"] === "video"
    && !(record(stream["disposition"]) && stream["disposition"]["attached_pic"] === 1));
  const audio = streams.find((stream) => stream["codec_type"] === "audio");
  const format = value["format"];
  const bitrate = Number(format["bit_rate"]);
  const inspection = video && parseInspection({ durationSeconds: Number(format["duration"] ?? video["duration"]),
    width: Number(video["width"]), height: Number(video["height"]),
    aspectRatio: ratio(video["display_aspect_ratio"], ":") ?? Number(video["width"]) / Number(video["height"]),
    fps: ratio(video["avg_frame_rate"], "/") ?? ratio(video["r_frame_rate"], "/"),
    container: format["format_name"], videoCodec: video["codec_name"],
    audio: audio ? { codec: audio["codec_name"], sampleRate: Number(audio["sample_rate"]), channels: Number(audio["channels"]) } : null,
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null });
  if (!inspection) throw new UploadValidationError("Vídeo sem informações técnicas válidas para processamento.", 422);
  return inspection;
}
