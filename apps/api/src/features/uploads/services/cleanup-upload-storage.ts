import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { StoredUpload } from "./scan-upload-storage.js";
import { MANAGED_FILE } from "./scan-upload-storage.js";
import { uploadPath } from "./storage-paths.js";

export async function cleanupUploadStorage(root: string, uploads: StoredUpload[], now: number, retentionMs: number,
  protectedIds: ReadonlySet<string> = new Set()): Promise<void> {
  for (const upload of uploads) {
    if (protectedIds.has(upload.id)) continue;
    const timestamp = upload.metadata ? Date.parse(upload.metadata.createdAt) : upload.modifiedAt;
    if (!upload.removable || now - timestamp < retentionMs) continue;
    const directory = await uploadPath(root, upload.id);
    const files = await readdir(directory);
    // Verificar todos os filhos antes de qualquer exclusão. Nunca usar remoção recursiva.
    for (const name of files) {
      const stat = await lstat(join(directory, name));
      if (!MANAGED_FILE.test(name) || !stat.isFile() || stat.isSymbolicLink()) {
        throw new Error("Limpeza interrompida: conteúdo inseguro.");
      }
    }
    for (const name of files) await unlink(join(directory, name));
    await rmdir(directory);
  }
}
