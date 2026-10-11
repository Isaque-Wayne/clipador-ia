import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { retryYouTubeIngestion } from "../../apps/web/src/features/youtube-ingestion/services/ingest-youtube.ts";

async function main() {
const originalId = "8aa1a94f-943a-4f1b-a47e-a2ce1cfb6a7c";
const sourceUrl = "https://www.youtube.com/watch?v=ac0RGoBVzhs";
const directory = resolve("apps/api/.data/youtube-diagnostics", `${new Date().toISOString().replace(/[:.]/g, "-")}-proxy-retry`);
await mkdir(directory, { recursive: true });
const nativeFetch = globalThis.fetch;
const requests: { method: string; path: string; status: number }[] = [];
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" && input.startsWith("/") ? new URL(input, "http://127.0.0.1:3000") : input;
  const response = await nativeFetch(url, init);
  requests.push({ method: init?.method ?? "GET", path: String(input), status: response.status });
  return response;
};
const progress: unknown[] = [];
const result: Record<string, unknown> = { originalId, sourceUrl };
const started = performance.now();
try {
  const health = await nativeFetch("http://127.0.0.1:3001/health");
  assert.equal(health.status, 200); result.health = await health.json();
  const imported = await retryYouTubeIngestion(originalId, AbortSignal.timeout(120_000), update => progress.push(update), sourceUrl);
  assert.notEqual(imported.id, originalId);
  const uploadRoot = resolve("apps/api/.data/uploads", imported.id);
  const metadata = JSON.parse(await readFile(join(uploadRoot, "metadata.json"), "utf8"));
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(join(uploadRoot, `video${metadata.extension}`))) { hash.update(chunk); bytes += chunk.length; }
  assert.equal(hash.digest("hex"), imported.upload.checksum.value);
  assert.equal(bytes, imported.upload.file.size);
  assert.equal(imported.upload.checksum.value, "40b7f26ebc8850eb9cf80271439f0f3d5c9368105206bed1892d2860224557ee");
  const get = await nativeFetch(`http://127.0.0.1:3001/ingestions/${imported.id}`);
  assert.equal(get.status, 200);
  const uploadGet = await nativeFetch(`http://127.0.0.1:3001/uploads/${imported.id}`);
  assert.equal(uploadGet.status, 200);
  const files = await readdir(uploadRoot);
  assert.ok(!files.some(file => file.endsWith(".part")));
  Object.assign(result, { imported, bytes, storage: uploadRoot, files, getStatus: get.status, uploadGetStatus: uploadGet.status, checksumVerified: true });
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  Object.assign(result, { elapsedMs: performance.now() - started, requests, progress });
  await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  console.log(`EVIDENCE ${directory}`);
}
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
