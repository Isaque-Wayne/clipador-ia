import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileChecksum } from "../../clip-rendering/services/clip-storage.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";
import type { MusicMood, ResolvedMusic } from "../types.js";
export interface MusicProvider { resolve(mood: MusicMood, signal: AbortSignal): Promise<ResolvedMusic | null> }
export class LocalMusicProvider implements MusicProvider {
  constructor(private readonly directory?: string) {}
  async resolve(mood: MusicMood, signal: AbortSignal): Promise<ResolvedMusic | null> {
    signal.throwIfAborted(); if (!this.directory) return null;
    const path = resolve(this.directory), stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Biblioteca de assets insegura.");
    const root = await realpath(path), manifest = join(root, "catalog.json"), meta = await lstat(manifest);
    if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 256 * 1024) throw new Error("Catálogo de assets inválido.");
    const value: unknown = JSON.parse(await readFile(manifest, "utf8"));
    if (!record(value) || value["schemaVersion"] !== 1 || !Array.isArray(value["music"])) throw new Error("Catálogo incompatível.");
    for (const item of value["music"]) {
      if (!record(item) || item["approved"] !== true || item["mood"] !== mood || typeof item["id"] !== "string" || !/^[a-z0-9_-]{1,64}$/.test(item["id"])
        || typeof item["extension"] !== "string" || ![".wav", ".mp3", ".m4a", ".ogg"].includes(item["extension"])
        || typeof item["license"] !== "string" || !item["license"].trim() || typeof item["checksum"] !== "string" || !/^[a-f0-9]{64}$/.test(item["checksum"])) continue;
      const file = join(root, item["id"] + item["extension"]), fileStat = await lstat(file);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > 32 * 1024 * 1024 || await realpath(file) !== file || await fileChecksum(file) !== item["checksum"]) throw new Error("Asset musical inválido ou corrompido.");
      return { id: item["id"], path: file, checksum: item["checksum"], extension: item["extension"] as ResolvedMusic["extension"], license: item["license"] };
    }
    return null;
  }
}
