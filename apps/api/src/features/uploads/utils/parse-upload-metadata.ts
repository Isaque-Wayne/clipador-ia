import type { UploadMetadata } from "../types/upload.js";
import { sanitizeFilename, isUploadId } from "./upload-names.js";
import { MAX_VIDEO_BYTES, VIDEO_EXTENSIONS } from "./validate-video.js";
import { isUploadStatus } from "./upload-state.js";
import { parseUploadSource } from "./parse-upload-source.js";
import { parseInspection } from "../../video-preparation/utils/parse-inspection.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseUploadMetadata(value: unknown, id: string): UploadMetadata | undefined {
  if (!record(value) || value["id"] !== id || !isUploadId(id)
    || !isUploadStatus(value["status"]) || value["nextStep"] !== "processing") return undefined;
  const file = value["file"];
  const createdAt = value["createdAt"];
  const checksum = value["checksum"];
  const inspection = value["inspection"] === undefined ? undefined : parseInspection(value["inspection"]);
  if (value["inspection"] !== undefined && !inspection) return undefined;
  const source = value["source"] === undefined ? undefined : parseUploadSource(value["source"]);
  if (value["source"] !== undefined && !source) return undefined;
  if (checksum !== undefined && checksum !== null && (!record(checksum)
    || checksum["algorithm"] !== "sha256" || typeof checksum["value"] !== "string"
    || !/^[0-9a-f]{64}$/.test(checksum["value"]))) return undefined;
  if (!record(file) || typeof file["name"] !== "string" || file["name"].length > 255
    || !/^[a-zA-Z0-9._-]+$/.test(file["name"]) || sanitizeFilename(file["name"]) !== file["name"]
    || typeof file["type"] !== "string" || !Object.hasOwn(VIDEO_EXTENSIONS, file["type"])
    || value["extension"] !== VIDEO_EXTENSIONS[file["type"]]
    || !file["name"].toLowerCase().endsWith(String(value["extension"]))
    || typeof file["size"] !== "number" || !Number.isSafeInteger(file["size"])
    || file["size"] <= 0 || file["size"] > MAX_VIDEO_BYTES
    || typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))
    || new Date(createdAt).toISOString() !== createdAt) return undefined;
  // Reconstruir o contrato impede publicar propriedades extras ou caminhos locais.
  return { id, file: { name: file["name"], size: file["size"], type: file["type"] },
    extension: String(value["extension"]), createdAt, status: value["status"], nextStep: "processing",
    checksum: record(checksum) ? { algorithm: "sha256", value: String(checksum["value"]) } : null,
    ...(source ? { source } : {}), ...(inspection ? { inspection } : {}) };
}
