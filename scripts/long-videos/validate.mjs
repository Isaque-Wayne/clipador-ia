import assert from "node:assert/strict";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createServer } from "../../apps/api/dist/server/create-server.js";
import { createFasterWhisperEngine } from "../../apps/api/dist/features/transcription/services/faster-whisper-engine.js";
import { fileChecksum } from "../../apps/api/dist/features/clip-rendering/services/clip-storage.js";
import { runMediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { resolvePipelineTimeouts } from "../../config/pipeline-timeouts.mjs";

const input = process.argv[2] ?? "https://www.youtube.com/watch?v=ac0RGoBVzhs";
const root = resolve("apps/api/.data/long-video-validation", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(root, { recursive: true });
const directory = join(root, "uploads"), outputs = join(root, "clips");
const evidence = { input, root, startedAt: new Date().toISOString(), timeouts: resolvePipelineTimeouts(), stages: [], progress: [], diagnostics: [], engineCalls: 0 };
const engine = createFasterWhisperEngine(text => evidence.diagnostics.push(text), metrics => { evidence.engineMetrics = metrics; });
const measuredEngine = { async transcribe(path, signal, onProgress) {
  evidence.engineCalls++; evidence.audioTemporaryBytes = (await stat(path)).size;
  return engine.transcribe(path, signal, onProgress);
} };
const server = createServer({ directory }, {}, { engine: measuredEngine }, { directory: outputs }); server.log.level = "warn";
let base = await server.listen({ host: "127.0.0.1", port: 0 }), peakNodeRss = process.memoryUsage().rss;
const started = performance.now(), sampler = setInterval(() => { peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss); }, 250);
async function request(path, method = "GET", payload) {
  const options = { method, signal: AbortSignal.timeout(15000), ...(payload ? { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) } : {}) };
  const response = await fetch(`${base}${path}`, options), value = await response.json();
  assert.ok(response.ok, JSON.stringify(value)); return { status: response.status, value };
}
async function poll(path, key) {
  const start = performance.now(); let lastPrint = 0;
  while (performance.now() - start < 3_700_000) {
    const { value } = await request(path), status = value[key], stage = status.stage ?? status.status;
    if (evidence.stages.at(-1) !== stage) { evidence.stages.push(stage); console.log(`STAGE ${stage}`); }
    if (performance.now() - lastPrint > 30000) {
      lastPrint = performance.now(); evidence.progress.push({ seconds: (performance.now() - started) / 1000, ...status });
      console.log(JSON.stringify({ elapsedSeconds: Math.round((performance.now() - started) / 1000), stage, progress: status.progress }));
      await writeFile(join(root, "status.json"), JSON.stringify(evidence, null, 2));
    }
    assert.notEqual(stage, "failed", JSON.stringify(status));
    if (["completed", "downloaded"].includes(stage)) return status;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.fail("Validation polling deadline exceeded");
}
async function bytes(path) {
  let sum = 0; for (const entry of await readdir(path, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink()); const child = join(path, entry.name);
    sum += entry.isDirectory() ? await bytes(child) : (await stat(child)).size;
  } return sum;
}
try {
  assert.equal((await request("/health")).status, 200);
  const ingestStarted = performance.now(); let upload;
  if (/^https:\/\/www.youtube.com\/watch\?v=[a-zA-Z0-9_-]{11}$/.test(input)) {
    const posted = await request("/ingestions/youtube/jobs", "POST", { url: input });
    assert.equal(posted.status, 202); evidence.ingestionPostMilliseconds = performance.now() - ingestStarted;
    const id = posted.value.ingestion.id; evidence.uploadId = id;
    upload = (await poll(`/ingestions/${id}`, "ingestion")).upload;
    evidence.ingestionContinuedAfterPost = true;
  } else {
    const response = await fetch(`${base}/uploads/video`, { method: "POST", headers: { "content-type": "video/mp4", "x-file-name": "long-fixture.mp4" }, body: createReadStream(resolve(input)), duplex: "half", signal: AbortSignal.timeout(1_800_000) });
    upload = await response.json(); assert.equal(response.status, 200, JSON.stringify(upload)); evidence.uploadId = upload.id;
  }
  evidence.ingestionSeconds = (performance.now() - ingestStarted) / 1000; evidence.videoBytes = upload.file.size;
  evidence.sourceHash = upload.checksum.value;
  const id = upload.id, transcriptionStarted = performance.now();
  const posted = await request(`/uploads/${id}/transcription`, "POST"); assert.equal(posted.status, 202);
  evidence.transcriptionPostMilliseconds = performance.now() - transcriptionStarted;
  await poll(`/uploads/${id}/transcription/status`, "status"); evidence.transcriptionSeconds = (performance.now() - transcriptionStarted) / 1000;
  const transcript = (await request(`/uploads/${id}/transcription`)).value.transcript;
  evidence.language = transcript.language; evidence.durationSeconds = transcript.duration;
  evidence.segments = transcript.segments.length; evidence.words = transcript.segments.reduce((sum, item) => sum + item.words.length, 0);
  evidence.lastWordEnd = transcript.segments.at(-1)?.words.at(-1)?.end;
  assert.ok(evidence.words > 0); assert.ok(evidence.lastWordEnd > transcript.duration * .9, "Continuous speech fixture should reach the end");
  const analysisStarted = performance.now(); const analyzed = await request(`/uploads/${id}/portfolio`, "POST"), report = analyzed.value.report;
  evidence.analysisSeconds = (performance.now() - analysisStarted) / 1000; evidence.candidateCount = report.candidates.length;
  assert.ok(report.candidates.length); const candidate = report.candidates.find(item => item.duration < 30) ?? report.candidates[0];
  const preferences = { quantity: "few", style: "AUTO", candidateIds: [candidate.id] };
  const renderStarted = performance.now(); assert.equal((await request(`/uploads/${id}/portfolio/process`, "POST", preferences)).status, 202);
  await poll(`/uploads/${id}/portfolio/process/status`, "status"); evidence.renderSeconds = (performance.now() - renderStarted) / 1000;
  const batch = (await request(`/uploads/${id}/portfolio/clips`)).value.batch, clip = batch.clips[0]; assert.equal(batch.clips.length, 1);
  evidence.clip = { id: clip.id, size: clip.size, duration: clip.duration, checksum: clip.checksum, batchId: batch.batchId, profile: clip.candidate.profile, editStyle: clip.editPlan.style };
  const clipPath = join(outputs, id, batch.batchId, clip.file); assert.equal(await fileChecksum(clipPath), clip.checksum);
  const media = await fetch(`${base}/uploads/${id}/clips/${batch.batchId}/${clip.id}/file`, { headers: { range: "bytes=0-63" } }); assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 64);
  const preview = await runMediaTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", "1", "-i", clipPath, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], new AbortController().signal);
  try { await pipeline(preview.content, createWriteStream(join(root, "preview.png"), { flags: "wx" })); } finally { await preview.dispose?.(); }
  evidence.uploadFiles = await readdir(join(directory, id)); evidence.workFiles = await readdir(join(outputs, ".work"));
  assert.ok(!evidence.uploadFiles.some(file => file.endsWith(".part"))); assert.deepEqual(evidence.workFiles, []);
  assert.equal(await fileChecksum(join(directory, id, "video.mp4")), upload.checksum.value);
  evidence.cleanup = true; evidence.checksumPreserved = true; evidence.storageBytes = await bytes(directory); evidence.outputBytes = await bytes(outputs);
  await server.close();
  const restored = createServer({ directory }, {}, { engine: { transcribe() { assert.fail("Completed transcript must be reused"); } } }, { directory: outputs }); restored.log.level = "warn";
  base = await restored.listen({ host: "127.0.0.1", port: 0 });
  try {
    assert.deepEqual((await request(`/uploads/${id}/transcription`)).value.transcript, transcript);
    assert.equal((await request(`/uploads/${id}/transcription`, "POST")).value.reused, true);
    assert.equal((await request(`/uploads/${id}/portfolio/process`, "POST", preferences)).value.reused, true);
    if (upload.source) assert.equal((await request(`/ingestions/${id}`)).value.ingestion.status, "downloaded");
    assert.deepEqual((await request(`/uploads/${id}/portfolio/clips`)).value.batch, batch); evidence.recovery = true;
  } finally { await restored.close(); }
  assert.equal(evidence.engineCalls, 1);
} catch (error) { evidence.error = error.stack ?? error.message; process.exitCode = 1; }
finally {
  clearInterval(sampler); await server.close(); evidence.totalSeconds = (performance.now() - started) / 1000; evidence.peakNodeRssBytes = peakNodeRss;
  evidence.ramNote = "Node RSS and Python peak working set measured separately; FFmpeg child peak not sampled. Source/results remain for audit.";
  await writeFile(join(root, "result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence)); console.log(`EVIDENCE ${join(root, "result.json")}`);
}
