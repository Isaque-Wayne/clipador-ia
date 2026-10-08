import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { UploadMetadata } from "../types/upload.js";
import { uploadPath } from "./storage-paths.js";

export async function updateUploadMetadata(root: string, metadata: UploadMetadata): Promise<void> {
  const directory = await uploadPath(root, metadata.id);
  const final = join(directory, "metadata.json");
  const stat = await lstat(final);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Metadados de upload inseguros.");
  const partial = join(directory, "metadata.json.part");
  const file = await open(partial, "wx", 0o600);
  try {
    try { await file.writeFile(JSON.stringify(metadata)); await file.sync(); }
    finally { await file.close(); }
    await rename(partial, final);
  } catch (error: unknown) {
    await uploadPath(root, metadata.id);
    await unlink(partial);
    throw error;
  }
}
