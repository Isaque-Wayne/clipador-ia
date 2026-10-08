import { lstat, mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isUploadId } from "../utils/upload-names.js";

export async function prepareStorageRoot(directory: string): Promise<string> {
  const root = resolve(directory);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Diretório de uploads inseguro.");
  return realpath(root);
}

export async function uploadPath(root: string, id: string): Promise<string> {
  if (!isUploadId(id)) throw new Error("ID de armazenamento inválido.");
  const directory = join(root, id);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory) {
    throw new Error("Caminho de upload inseguro.");
  }
  return directory;
}
