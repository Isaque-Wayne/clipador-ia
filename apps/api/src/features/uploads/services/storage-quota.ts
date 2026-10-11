import { UploadValidationError } from "../utils/validate-video.js";

export class UploadStorageQuotaError extends UploadValidationError {
  readonly code = "UPLOAD_STORAGE_QUOTA";
  constructor(readonly details: { usedBytes: number; limitBytes: number; requiredBytes: number }) {
    super("Armazenamento de vídeos cheio. Abra a Biblioteca, exclua projetos de que não precisa e tente novamente.", 507);
  }
}

export function assertStorageQuota(usedBytes: number, incomingBytes: number, quotaBytes: number): void {
  if (incomingBytes > quotaBytes - usedBytes) {
    throw new UploadStorageQuotaError({ usedBytes, limitBytes: quotaBytes, requiredBytes: incomingBytes });
  }
}
