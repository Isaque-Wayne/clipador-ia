import type { FileHandle } from "node:fs/promises";
import type { UploadMetadata } from "../types/upload.js";
import type { UploadCoordinator } from "./upload-coordinator.js";
import { openVerifiedUpload, UploadIntegrityError } from "./verify-upload-integrity.js";

export interface VerifiedUploadInput {
  metadata: UploadMetadata;
  file: FileHandle;
}

export function createUploadConsumer(coordinator: UploadCoordinator) {
  return async function consumeUpload<T>(id: string, consumer: (input: VerifiedUploadInput) => Promise<T>): Promise<T> {
    const metadata = await coordinator.pin(id);
    let file: FileHandle | undefined;
    try {
      try {
        file = await openVerifiedUpload(await coordinator.root(), metadata);
      } catch (error: unknown) {
        if (metadata.checksum) await coordinator.transition(id, "failed", true);
        if (error instanceof UploadIntegrityError) throw error;
        throw new UploadIntegrityError();
      }
      // Consumir pelo mesmo handle verificado, sem reabrir um caminho potencialmente trocado.
      // O consumidor deve ler a partir da posição 0 e concluir antes de retornar.
      return await consumer({ metadata, file });
    } finally {
      try { await file?.close(); } finally { coordinator.unpin(id); }
    }
  };
}
