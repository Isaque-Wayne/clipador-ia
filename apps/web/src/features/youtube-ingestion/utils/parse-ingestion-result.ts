import type { IngestionResult } from "../types/ingestion";
import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseIngestionResult(value: unknown): IngestionResult {
  if (!object(value) || value["status"] !== "downloaded" || typeof value["id"] !== "string"
    || !/^[a-f0-9-]{36}$/.test(value["id"]) || typeof value["createdAt"] !== "string") throw new Error("Resposta de ingestão inválida.");
  const upload = value["upload"];
  if (!object(upload) || upload["id"] !== value["id"] || typeof upload["status"] !== "string"
    || !object(upload["file"]) || !object(upload["checksum"])) throw new Error("Resposta de ingestão inválida.");
  const file = upload["file"];
  const checksum = upload["checksum"];
  if (typeof file["name"] !== "string" || typeof file["type"] !== "string" || typeof file["size"] !== "number"
    || !Number.isSafeInteger(file["size"]) || file["size"] <= 0 || checksum["algorithm"] !== "sha256"
    || typeof checksum["value"] !== "string" || !/^[a-f0-9]{64}$/.test(checksum["value"])) throw new Error("Resposta de ingestão inválida.");
  let video: IngestionResult["video"];
  const source = value["video"];
  if (object(source)) {
    const reference = parseYouTubeUrl(source["url"]);
    const title = source["title"];
    const duration = source["durationSeconds"];
    video = { title: typeof title === "string" ? title.slice(0, 200) : null,
      durationSeconds: typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null,
      thumbnailUrl: source["thumbnailUrl"] === `https://i.ytimg.com/vi/${reference.videoId}/hqdefault.jpg`
        ? String(source["thumbnailUrl"]) : null };
  }
  return { id: value["id"], status: "downloaded", createdAt: value["createdAt"], ...(video ? { video } : {}),
    upload: { id: value["id"], status: upload["status"], file: { name: file["name"], size: file["size"], type: file["type"] },
      checksum: { algorithm: "sha256", value: checksum["value"] } } };
}
