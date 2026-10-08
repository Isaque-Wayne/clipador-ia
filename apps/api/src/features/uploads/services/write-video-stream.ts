import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import type { Readable } from "node:stream";
import type { UploadChecksum } from "../types/upload.js";
import { assertStorageQuota } from "./storage-quota.js";
import { validateVideoSize, UploadValidationError } from "../utils/validate-video.js";
import { readUploadStream } from "./read-upload-stream.js";

export async function writeVideoStream(source: Readable, file: FileHandle, availableBytes: number,
  signal: AbortSignal, expectedSize?: number, reserveBytes?: (size: number) => void): Promise<{ size: number; checksum: UploadChecksum }> {
  const hash = createHash("sha256");
  let size = 0;
  // Não destruir o stream HTTP ao exceder limites: ainda precisamos responder com erro.
  for await (const chunk of readUploadStream(source, signal)) {
    signal.throwIfAborted();
    const nextSize = size + chunk.length;
    if (chunk.length) validateVideoSize(nextSize);
    assertStorageQuota(0, nextSize, availableBytes);
    reserveBytes?.(nextSize);
    let offset = 0;
    while (offset < chunk.length) {
      signal.throwIfAborted();
      const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
      if (!bytesWritten) throw new Error("Falha ao gravar o vídeo.");
      offset += bytesWritten;
    }
    hash.update(chunk);
    size = nextSize;
  }
  signal.throwIfAborted();
  validateVideoSize(size);
  if (expectedSize !== undefined && size !== expectedSize) {
    throw new UploadValidationError("O tamanho recebido não corresponde ao tamanho informado.");
  }
  await file.sync();
  signal.throwIfAborted();
  return { size, checksum: { algorithm: "sha256", value: hash.digest("hex") } };
}
