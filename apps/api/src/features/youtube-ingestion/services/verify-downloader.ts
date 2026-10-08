import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";

export async function verifyDownloader(executable: string): Promise<void> {
  try {
    const manifestPath = join(dirname(executable), "installation.json");
    if ((await stat(manifestPath)).size > 4096) throw new Error("Manifesto excessivo.");
    const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (typeof manifest !== "object" || manifest === null) throw new Error("Manifesto inválido.");
    const record = manifest as Record<string, unknown>;
    if (typeof record["sha256"] !== "string" || !/^[a-f0-9]{64}$/.test(record["sha256"])
      || typeof record["version"] !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(record["version"])
      || record["source"] !== `https://github.com/yt-dlp/yt-dlp/releases/download/${record["version"]}/${basename(executable)}`
      || record["checksumSource"] !== `https://github.com/yt-dlp/yt-dlp/releases/download/${record["version"]}/SHA2-256SUMS`) {
      throw new Error("Manifesto inválido.");
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(executable)) hash.update(chunk);
    if (hash.digest("hex") !== record["sha256"]) throw new Error("Checksum do executável divergente.");
  } catch {
    throw new UploadValidationError("Downloader ausente ou não verificado. Confira a instalação do yt-dlp.", 503);
  }
}
