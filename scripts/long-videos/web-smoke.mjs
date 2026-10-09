import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileChecksum } from "../../apps/api/dist/features/clip-rendering/services/clip-storage.js";

const source = resolve("apps/api/.data/processing-smoke/2026-10-08T18-10-13-205Z/uploads/1f5397b6-c4a3-4654-916f-1f7cb07ee477/video.mp4");
const root = resolve("apps/api/.data/long-video-validation", new Date().toISOString().replace(/[:.]/g, "-")); await mkdir(root, { recursive: true });
const evidence = { source, root, stages: [], sourceHash: await fileChecksum(source), web: "http://127.0.0.1:3000", api: "http://127.0.0.1:3001" }, started = performance.now();
async function request(path, method = "GET") {
  const response = await fetch(`${evidence.web}/api${path}`, { method, signal: AbortSignal.timeout(15000) }), value = await response.json();
  assert.ok(response.ok, JSON.stringify(value)); return { status: response.status, value };
}
try {
  assert.equal((await fetch(`${evidence.api}/health`)).status, 200);
  assert.equal((await fetch(`${evidence.web}/upload`)).status, 200);
  const response = await fetch(`${evidence.web}/api/uploads/video`, { method: "POST", headers: { "content-type": "video/mp4", "x-file-name": "known-short.mp4" }, body: createReadStream(source), duplex: "half", signal: AbortSignal.timeout(120000) });
  assert.equal(response.status, 200); const upload = await response.json(); evidence.uploadId = upload.id;
  assert.equal(upload.checksum.value, evidence.sourceHash); assert.equal((await request(`/uploads/${upload.id}`)).status, 200);
  const processingStarted = performance.now(); const posted = await request(`/uploads/${upload.id}/portfolio/process`, "POST");
  assert.equal(posted.status, 202); evidence.processingPostMilliseconds = performance.now() - processingStarted;
  let lastPrint = 0;
  while (performance.now() - started < 600000) {
    const status = (await request(`/uploads/${upload.id}/portfolio/process/status`)).value.status;
    if (evidence.stages.at(-1) !== status.stage) { evidence.stages.push(status.stage); console.log(JSON.stringify(status)); }
    if (performance.now() - lastPrint > 30000) { lastPrint = performance.now(); console.log(JSON.stringify({ seconds: Math.round((performance.now() - started) / 1000), ...status })); }
    assert.notEqual(status.stage, "failed", JSON.stringify(status));
    if (status.stage === "completed") {
      const batch = (await request(`/uploads/${upload.id}/portfolio/clips`)).value.batch;
      evidence.clips = batch.clips.length; evidence.batchId = batch.batchId;
      const clip = batch.clips[0]; const served = await fetch(`${evidence.web}/api/uploads/${upload.id}/clips/${batch.batchId}/${clip.id}/file`, { headers: { range: "bytes=0-63" } });
      assert.equal(served.status, 206); assert.equal((await served.arrayBuffer()).byteLength, 64);
      assert.equal((await request(`/uploads/${upload.id}/portfolio/process`, "POST")).value.reused, true);
      evidence.reused = true; evidence.sourcePreserved = (await fileChecksum(source)) === evidence.sourceHash; break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(evidence.clips > 0);
} catch (error) { evidence.error = error.stack ?? error.message; process.exitCode = 1; }
finally { evidence.totalSeconds = (performance.now() - started) / 1000; await writeFile(join(root, "web-result.json"), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); }
