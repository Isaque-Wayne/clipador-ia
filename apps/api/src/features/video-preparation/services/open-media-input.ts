import { lstat, open } from "node:fs/promises";
import type { MediaInput } from "../types/preparation.js";
import { UploadIntegrityError } from "../../uploads/services/verify-upload-integrity.js";

export async function openMediaInput(input: MediaInput) {
  const stat = await lstat(input.path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new UploadIntegrityError();
  const file = await open(input.path, "r");
  try {
    const actual = await file.stat({ bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) {
      if (actual[key] !== input.identity[key]) throw new UploadIntegrityError("Arquivo alterado antes de iniciar o processamento.");
    }
    return file;
  } catch (error) { await file.close(); throw error; }
}
