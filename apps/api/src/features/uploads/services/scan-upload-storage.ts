import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UploadMetadata } from "../types/upload.js";
import { isUploadId } from "../utils/upload-names.js";
import { parseUploadMetadata } from "../utils/parse-upload-metadata.js";
import { uploadPath } from "./storage-paths.js";

export interface StoredUpload {
  id: string;
  bytes: number;
  modifiedAt: number;
  removable: boolean;
  metadata: UploadMetadata | undefined;
}

export const MANAGED_FILE = /^(metadata\.json(?:\.part)?|transcript\.json(?:\.part)?|(?:analysis|portfolio|processing-legacy|processing-portfolio)\.json(?:\.part)?|video\.(mp4|webm|mov)(?:\.part)?|track-(video|audio)\.part|audio-asr\.wav\.part)$/;

export async function scanUploadStorage(root: string, excluded: ReadonlySet<string> = new Set(), preparing: ReadonlySet<string> = new Set()): Promise<{ uploads: StoredUpload[]; bytes: number }> {
  const uploads: StoredUpload[] = [];
  let bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error("Link simbólico não permitido no armazenamento.");
    if (entry.isFile()) { bytes += (await lstat(join(root, entry.name))).size; continue; }
    if (!entry.isDirectory() || !isUploadId(entry.name)) throw new Error("Entrada desconhecida no armazenamento.");
    const directory = await uploadPath(root, entry.name);
    const files = await readdir(directory, { withFileTypes: true });
    let uploadBytes = 0;
    let modifiedAt = (await lstat(directory)).mtimeMs;
    let removable = true;
    for (const file of files) {
      const stat = await lstat(join(directory, file.name));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Entrada insegura no upload.");
      // Áudio ativo já está coberto pela reserva; órfãos após crash contam normalmente.
      if (!(preparing.has(entry.name) && file.name === "audio-asr.wav.part")) uploadBytes += stat.size;
      modifiedAt = Math.max(modifiedAt, stat.mtimeMs);
      removable &&= MANAGED_FILE.test(file.name);
    }
    let metadata: UploadMetadata | undefined;
    const metaFile = files.find((file) => file.name === "metadata.json");
    if (metaFile && (await lstat(join(directory, metaFile.name))).size <= 4096) {
      try {
        metadata = parseUploadMetadata(JSON.parse(await readFile(join(directory, metaFile.name), "utf8")), entry.name);
      } catch (error: unknown) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    if (metadata) {
      const extension = metadata.extension;
      const video = files.find((file) => file.name === `video${extension}`);
      if ((metadata.status !== "failed" && (!video || (await lstat(join(directory, video.name))).size !== metadata.file.size))
        || files.some((file) => file.name.endsWith(".part") && !["audio-asr.wav.part", "transcript.json.part", "analysis.json.part", "portfolio.json.part", "processing-legacy.json.part", "processing-portfolio.json.part"].includes(file.name))) metadata = undefined;
    }
    bytes += uploadBytes;
    uploads.push({ id: entry.name, bytes: uploadBytes, modifiedAt, removable, metadata });
  }
  return { uploads, bytes };
}
