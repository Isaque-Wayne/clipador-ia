import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const id = process.argv[2];
if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error("Informe um UUID válido.");
const baselinePath = process.argv[3]; if (!baselinePath) throw new Error("Informe o relatório anterior de validação.");
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const root = resolve("apps/api/.data/library-validation", `retry-real-${new Date().toISOString().replaceAll(":", "-")}`); await mkdir(root, { recursive: true });
async function get(path) { const response = await fetch(`http://127.0.0.1:3001${path}`, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`HTTP ${response.status} ${path}`); return response.json(); }
async function checksum(path) { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
let previous = "", status;
const began = Date.now();
while (true) {
  status = (await get(`/uploads/${id}/portfolio/process/status`)).status;
  const signature = `${status.stage}:${status.renderedCount ?? 0}:${status.selectedCount ?? 0}`;
  if (signature !== previous) { console.log(JSON.stringify({ stage: status.stage, renderedCount: status.renderedCount, selectedCount: status.selectedCount, error: status.error, elapsedSeconds: (Date.now() - began) / 1000 })); previous = signature; }
  if (["completed", "failed"].includes(status.stage)) break;
  if (Date.now() - began > 65 * 60 * 1000) throw new Error("Monitor excedeu 65 minutos; o job não foi cancelado.");
  await new Promise(resolve => setTimeout(resolve, 3000));
}
await writeFile(join(root, "terminal-status.json"), JSON.stringify(status, null, 2));
if (status.stage !== "completed") throw new Error(JSON.stringify(status));
const batch = (await get(`/uploads/${id}/portfolio/clips`)).batch;
assert.equal(batch.clips.length, status.selectedCount);
const integrity = [];
for (const project of baseline.inventory) {
  const detail = (await get(`/projects/${project.id}`)).project;
  if (project.originalChecksum) {
    const digest = await checksum(resolve("apps/api/.data/uploads", project.id, `video${detail.metadata.extension}`)); assert.equal(digest, project.originalChecksum);
  }
  // All previously stored clips must still be present and have their manifest checksums.
  assert.ok(detail.clips.length >= project.verifiedClips);
  for (const clip of detail.clips) assert.equal(await checksum(resolve("apps/api/.data/clips", project.id, clip.batchId, `${clip.id}.mp4`)), clip.checksum);
  integrity.push({ id: project.id, originalUnchanged: Boolean(project.originalChecksum), verifiedClips: detail.clips.length });
}
const first = batch.clips[0];
const range = await fetch(`http://127.0.0.1:3000/api/uploads/${id}/clips/${batch.batchId}/${first.id}/file`, { headers: { Range: "bytes=0-1023" } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 1024);
const uploadFiles = await readdir(resolve("apps/api/.data/uploads", id)), work = await readdir(resolve("apps/api/.data/clips/.work"));
assert.ok(!uploadFiles.some(name => name.endsWith(".part"))); assert.deepEqual(work, []);
const result = { id, recordedAt: new Date().toISOString(), status, batchId: batch.batchId, clips: batch.clips.length, sourceAndOldOutputsIntegrity: integrity,
  originalStorage: baseline.storage, finalStorage: (await get("/storage/usage")).usage, uploadFiles, work, webRangeStatus: range.status,
  noRealDeletion: true, quotaNotIncreased: true, passed: true };
await writeFile(join(root, "result.json"), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ root, ...result }, null, 2));
