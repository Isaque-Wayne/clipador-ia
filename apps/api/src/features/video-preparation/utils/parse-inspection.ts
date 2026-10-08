import type { VideoInspection } from "../types/inspection.js";

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const name = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_,.-]{1,128}$/.test(value);
export function parseInspection(value: unknown): VideoInspection | undefined {
  if (!record(value) || !positive(value["durationSeconds"]) || !positive(value["width"])
    || !Number.isInteger(value["width"]) || !positive(value["height"]) || !Number.isInteger(value["height"])
    || !positive(value["aspectRatio"]) || !(value["fps"] === null || positive(value["fps"]))
    || !name(value["container"]) || !name(value["videoCodec"])
    || !(value["bitrate"] === null || positive(value["bitrate"]))) return undefined;
  const audio = value["audio"];
  if (audio !== null && (!record(audio) || !name(audio["codec"]) || !positive(audio["sampleRate"])
    || !Number.isInteger(audio["sampleRate"]) || !positive(audio["channels"]) || !Number.isInteger(audio["channels"]))) return undefined;
  return { durationSeconds: value["durationSeconds"], width: value["width"], height: value["height"],
    aspectRatio: value["aspectRatio"], fps: value["fps"] as number | null, container: value["container"],
    videoCodec: value["videoCodec"], bitrate: value["bitrate"] as number | null,
    audio: record(audio) ? { codec: String(audio["codec"]), sampleRate: Number(audio["sampleRate"]), channels: Number(audio["channels"]) } : null };
}
