import { lstat, readdir, realpath, statfs } from "node:fs/promises";
import { join } from "node:path";
import { isUploadId } from "../../uploads/utils/upload-names.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import { OUTPUT_FILE, WORK_FILE } from "../../social-packages/validation.js";

export function outputQuota(value?: number) {
  const raw = process.env["OUTPUT_STORAGE_QUOTA_BYTES"];
  if (value === undefined && raw !== undefined && !/^\d+$/.test(raw)) throw new Error("OUTPUT_STORAGE_QUOTA_BYTES inválida.");
  const quota = value ?? (raw === undefined ? 4 * 1024 ** 3 : Number(raw));
  if (!Number.isSafeInteger(quota) || quota < 1) throw new Error("Quota de outputs inválida.");
  return quota;
}
export async function outputUsage(root: string) {
  let bytes = 0, temporaryBytes = 0, projects = 0;
  async function visit(path: string, depth: number, temporary: boolean) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new ProcessingError("UNSAFE_STORAGE", "Diretório de outputs inseguro.", 409);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name), info = await lstat(file);
      if (info.isSymbolicLink()) throw new ProcessingError("UNSAFE_STORAGE", "Link em outputs. Operação bloqueada.", 409);
      if (info.isDirectory()) {
        if (depth >= 2 || !(isUploadId(entry.name) || depth === 0 && entry.name === ".work")) throw new ProcessingError("UNSAFE_STORAGE", "Entrada de outputs desconhecida.", 409);
        if (depth === 0 && entry.name !== ".work") projects++;
        await visit(file, depth + 1, temporary || entry.name === ".work");
      } else if (info.isFile()) {
        if (depth !== 2 || !(temporary ? WORK_FILE : OUTPUT_FILE).test(entry.name)) throw new ProcessingError("UNSAFE_STORAGE", "Arquivo de outputs desconhecido.", 409);
        bytes += info.size; if (temporary) temporaryBytes += info.size;
      } else throw new ProcessingError("UNSAFE_STORAGE", "Entrada de outputs insegura.", 409);
    }
  }
  await visit(root, 0, false);
  const disk = await statfs(root);
  return { bytes, temporaryBytes, projects, freeDiskBytes: disk.bavail * disk.bsize };
}
