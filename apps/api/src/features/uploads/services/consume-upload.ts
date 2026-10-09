import type { FileHandle } from "node:fs/promises";
import type { UploadMetadata } from "../types/upload.js";
import type { UploadCoordinator } from "./upload-coordinator.js";
import { openVerifiedUpload, UploadIntegrityError } from "./verify-upload-integrity.js";
import { createStageDeadline } from "../../pipeline/services/stage-deadline.js";

export interface VerifiedUploadInput {
  metadata: UploadMetadata;
  file: FileHandle;
}

export function createUploadConsumer(coordinator: UploadCoordinator) {
  return async function consumeUpload<T>(id: string, consumer: (input: VerifiedUploadInput) => Promise<T>, parent = new AbortController().signal): Promise<T> {
    const metadata = await coordinator.pin(id);
    let file: FileHandle | undefined;
    try {
      try {
        const deadline = createStageDeadline("storage", parent);
        try { file = await openVerifiedUpload(await coordinator.root(), metadata, deadline.signal); deadline.check(); }
        finally { deadline.dispose(); }
      } catch (error: unknown) {
        if (parent.aborted || error instanceof Error && "code" in error && error.code === "TIMEOUT") throw error;
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
