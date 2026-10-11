import { lstat, readdir, realpath, unlink, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isUploadId } from "../../uploads/utils/upload-names.js";
import { MANAGED_FILE } from "../../uploads/services/scan-upload-storage.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import { OUTPUT_FILE } from "../../social-packages/validation.js";

export const absent = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
export async function safeDirectory(path: string) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new ProcessingError("UNSAFE_STORAGE", "Diretório inseguro. Operação bloqueada.", 409);
  return path;
}
export async function projectIds(root: string) {
  await safeDirectory(root);
  return (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && isUploadId(entry.name)).map(entry => entry.name);
}
export async function projectFiles(root: string, id: string, outputs: boolean) {
  if (!isUploadId(id)) throw new ProcessingError("INVALID_ID", "ID de projeto inválido.", 400);
  const directories: string[] = [], files: { path: string; name: string; size: number; dev: number; ino: number }[] = [];
  async function visit(path: string, depth: number) {
    await safeDirectory(path);
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name), stat = await lstat(child);
      if (stat.isSymbolicLink()) throw new ProcessingError("UNSAFE_STORAGE", "Link/junction encontrado. Nenhum arquivo será excluído.", 409);
      if (outputs && depth === 0 && stat.isDirectory() && isUploadId(entry.name)) { await visit(child, 1); continue; }
      const allowed = outputs ? depth === 1 && OUTPUT_FILE.test(entry.name) : MANAGED_FILE.test(entry.name);
      if (!stat.isFile() || !allowed) throw new ProcessingError("UNSAFE_STORAGE", "Conteúdo desconhecido no projeto. Exclusão bloqueada.", 409);
      files.push({ path: child, name: entry.name, size: stat.size, dev: stat.dev, ino: stat.ino });
    }
    directories.push(path);
  }
  const path = join(root, id);
  try { await lstat(path); } catch (error) { if (absent(error)) return { files, directories, bytes: 0 }; throw error; }
  await visit(path, 0);
  return { files, directories, bytes: files.reduce((sum, file) => sum + file.size, 0) };
}
export async function removeProjectFiles(plans: Awaited<ReturnType<typeof projectFiles>>[]) {
  let freedBytes = 0;
  try {
    for (const plan of plans) {
      // Keep commit markers and source until other files have been removed.
      const ordered = [...plan.files].sort((a, b) => Number(/^(metadata|manifest)\.json$/.test(a.name)) - Number(/^(metadata|manifest)\.json$/.test(b.name)));
      for (const file of ordered) {
        await safeDirectory(dirname(file.path));
        const stat = await lstat(file.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size || stat.dev !== file.dev || stat.ino !== file.ino) throw new Error("Project changed during deletion");
        await unlink(file.path); freedBytes += file.size;
      }
      for (const directory of plan.directories) { await safeDirectory(directory); await rmdir(directory); }
    }
    return { freedBytes };
  } catch (error) {
    throw new ProcessingError("DELETE_PARTIAL", "A exclusão não terminou. Parte dos arquivos pode ter sido removida; atualize a Biblioteca para verificar o estado e tente novamente.", 500, { freedBytes });
  }
}
