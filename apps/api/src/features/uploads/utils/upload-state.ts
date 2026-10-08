import type { UploadStatus } from "../types/upload.js";
import { UploadValidationError } from "./validate-video.js";

const transitions: Readonly<Record<UploadStatus, readonly UploadStatus[]>> = {
  uploaded: ["queued", "failed"], queued: ["processing", "failed"],
  processing: ["completed", "failed"], completed: ["failed"], failed: [],
};

export function isUploadStatus(value: unknown): value is UploadStatus {
  return typeof value === "string" && Object.hasOwn(transitions, value);
}

export function assertUploadTransition(from: UploadStatus, to: UploadStatus): void {
  if (!isUploadStatus(to) || !transitions[from].includes(to)) {
    throw new UploadValidationError(`Transição de status inválida: ${from} → ${to}.`, 409);
  }
}
