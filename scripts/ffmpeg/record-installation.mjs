import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "../../tools/ffmpeg");
const archive = "ffmpeg-n9.0-latest-win64-lgpl-9.0.zip";
async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
const sums = await readFile(join(root, "downloads/checksums.sha256"), "utf8");
const expected = sums.split(/\r?\n/).find((line) => line.endsWith(`  ${archive}`))?.split(/\s+/)[0];
const archiveSha256 = await sha256(join(root, "downloads", archive));
if (!expected || expected !== archiveSha256) throw new Error("SHA-256 publicado divergente; não executar ferramentas.");
const executables = {};
for (const name of ["ffmpeg", "ffprobe"]) {
  const path = join(root, "bin", `${name}.exe`);
  const version = await new Promise((resolve, reject) => {
    const child = spawn(path, ["-version"], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", (chunk) => { output = (output + chunk).slice(0, 16384); });
    child.stderr.resume(); child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(output.split(/\r?\n/)[0]) : reject(new Error(`${name}: exit ${code}`)));
  });
  executables[name] = { version, sha256: await sha256(path) };
}
const release = JSON.parse(await readFile(join(root, "downloads/release.json"), "utf8"));
const record = { source: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/${archive}`,
  checksumSource: "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256",
  archiveSha256, releaseId: release.id, releasePublishedAt: release.published_at, license: "LGPL-3.0-or-later", executables };
await writeFile(join(root, "installation.json"), JSON.stringify(record, null, 2), { flag: "wx" });
console.log(JSON.stringify(record, null, 2));
