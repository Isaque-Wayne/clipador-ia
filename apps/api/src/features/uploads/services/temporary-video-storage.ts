import { link, mkdir, open, unlink } from "node:fs/promises";
import type { Readable } from "node:stream";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isUploadId } from "../utils/upload-names.js";
import { VIDEO_EXTENSIONS } from "../utils/validate-video.js";
import type { UploadMetadata, UploadChecksum } from "../types/upload.js";
import { prepareStorageRoot, uploadPath } from "./storage-paths.js";
import { writeVideoStream } from "./write-video-stream.js";

export const DEFAULT_UPLOAD_DIRECTORY = fileURLToPath(new URL("../../../../.data/uploads/", import.meta.url));

export function createTemporaryVideoStorage(directory = DEFAULT_UPLOAD_DIRECTORY) {
  async function createWorkspace(id: string): Promise<string> {
    if (!isUploadId(id)) throw new Error("ID de armazenamento inválido.");
    const root = await prepareStorageRoot(directory);
    await mkdir(join(root, id), { mode: 0o700 });
    return uploadPath(root, id);
  }

  async function save(content: Readable, metadata: UploadMetadata, availableBytes: number,
    signal: AbortSignal, expectedSize?: number, reserveBytes?: (size: number) => void, workspaceCreated = false,
    beforePublish?: (partialPath: string) => Promise<void>): Promise<UploadMetadata & { checksum: UploadChecksum }> {
    const extension = VIDEO_EXTENSIONS[metadata.file.type];
    const id = metadata.id;
    if (!extension || !isUploadId(id)) throw new Error("Identificação de armazenamento inválida.");
    const root = await prepareStorageRoot(directory);
    const uploadDirectory = join(root, id);
    // mkdir não recursivo falha em colisão; wx também impede sobrescrita do arquivo.
    if (workspaceCreated) await uploadPath(root, id);
    else await mkdir(uploadDirectory, { mode: 0o700 });
    const partialName = `video${extension}.part`;
    let partialCreated = false;
    let metadataPartialCreated = false;
    try {
      signal.throwIfAborted();
      const file = await open(join(uploadDirectory, partialName), "wx", 0o600);
      partialCreated = true;
      let streamed;
      try {
        streamed = await writeVideoStream(content, file, availableBytes, signal, expectedSize, reserveBytes);
      } finally { await file.close(); }
      signal.throwIfAborted();
      await beforePublish?.(join(uploadDirectory, partialName));
      signal.throwIfAborted();
      const complete = { ...metadata, file: { ...metadata.file, size: streamed.size }, checksum: streamed.checksum };
      await link(join(uploadDirectory, partialName), join(uploadDirectory, `video${extension}`));
      await unlink(join(uploadDirectory, partialName));
      partialCreated = false;
      // metadata.json é o marcador de commit, publicado somente após o vídeo completo.
      const metaFile = await open(join(uploadDirectory, "metadata.json.part"), "wx", 0o600);
      metadataPartialCreated = true;
      try {
        await metaFile.writeFile(JSON.stringify(complete));
        await metaFile.sync();
      } finally { await metaFile.close(); }
      signal.throwIfAborted();
      await link(join(uploadDirectory, "metadata.json.part"), join(uploadDirectory, "metadata.json"));
      await unlink(join(uploadDirectory, "metadata.json.part"));
      metadataPartialCreated = false;
      return complete;
    } catch (error: unknown) {
      await uploadPath(root, id);
      // Apenas parciais criados por esta operação, no diretório UUID validado.
      for (const name of [partialCreated ? partialName : null, metadataPartialCreated ? "metadata.json.part" : null]) {
        if (name) await unlink(join(uploadDirectory, name));
      }
      throw error;
    }
  }

  return { save, createWorkspace };
}

