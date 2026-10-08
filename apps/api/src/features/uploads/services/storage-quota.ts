import { UploadValidationError } from "../utils/validate-video.js";

export function assertStorageQuota(usedBytes: number, incomingBytes: number, quotaBytes: number): void {
  if (incomingBytes > quotaBytes - usedBytes) {
    throw new UploadValidationError("Armazenamento temporário cheio. Aguarde a limpeza de uploads antigos e tente novamente.", 507);
  }
}
