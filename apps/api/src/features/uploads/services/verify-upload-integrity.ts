import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { UploadMetadata } from "../types/upload.js";
import { uploadPath } from "./storage-paths.js";
import { UploadValidationError } from "../utils/validate-video.js";
import { parseUploadMetadata } from "../utils/parse-upload-metadata.js";

export class UploadIntegrityError extends UploadValidationError {
  constructor(message = "A integridade do vídeo armazenado não pôde ser confirmada.") { super(message, 409); }
}

export async function openVerifiedUpload(root: string, metadata: UploadMetadata, signal = new AbortController().signal): Promise<FileHandle> {
  signal.throwIfAborted();
  if (!parseUploadMetadata(metadata, metadata.id)) throw new UploadIntegrityError();
  if (!metadata.checksum) throw new UploadIntegrityError("Upload antigo sem checksum. Envie o vídeo novamente antes de consumi-lo.");
  const directory = await uploadPath(root, metadata.id);
  const path = join(directory, `video${metadata.extension}`);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new UploadIntegrityError();
  const file = await open(path, "r");
  try {
    const opened = await file.stat();
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== metadata.file.size) throw new UploadIntegrityError();
    await verifyUploadIntegrity(file, metadata, signal);
    return file;
  } catch (error: unknown) { await file.close(); throw error; }
}

export async function verifyUploadIntegrity(file: FileHandle, metadata: UploadMetadata, signal = new AbortController().signal): Promise<void> {
  signal.throwIfAborted();
  if (!metadata.checksum) throw new UploadIntegrityError("Upload sem checksum persistido.");
  const before = await file.stat();
  const hash = createHash("sha256");
  let size = 0;
  const stream = file.createReadStream({ start: 0, autoClose: false });
  const aborted = () => stream.destroy(signal.reason);
  signal.addEventListener("abort", aborted, { once: true });
  if (signal.aborted) aborted();
  try {
    for await (const chunk of stream) { signal.throwIfAborted(); hash.update(chunk); size += chunk.length; }
    signal.throwIfAborted();
  } catch (error) { if (signal.aborted) throw signal.reason; throw error; }
  finally { signal.removeEventListener("abort", aborted); }
  const after = await file.stat();
  if (size !== metadata.file.size || hash.digest("hex") !== metadata.checksum.value
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
    throw new UploadIntegrityError("Vídeo corrompido ou alterado. O consumo foi bloqueado.");
  }
}
