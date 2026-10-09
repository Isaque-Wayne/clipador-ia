import assert from "node:assert/strict";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, resolve } from "node:path";
import { createServer } from "../../apps/api/dist/server/create-server.js";
import { createFasterWhisperEngine } from "../../apps/api/dist/features/transcription/services/faster-whisper-engine.js";
import { runMediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { fileChecksum } from "../../apps/api/dist/features/clip-rendering/services/clip-storage.js";
import { prepareStorageRoot, uploadPath } from "../../apps/api/dist/features/uploads/services/storage-paths.js";
import { buildCues } from "../../apps/api/dist/features/clip-rendering/subtitles/cues.js";
import { inspectionArguments } from "../../apps/api/dist/features/video-preparation/utils/media-commands.js";
import { readProbeJson } from "../../apps/api/dist/features/video-preparation/services/read-probe-json.js";

const workspace = resolve(import.meta.dirname, "../.."), sourceId = process.argv[2];
const sourceDirectory = await uploadPath(await prepareStorageRoot(join(workspace, "apps/api/.data/uploads")), sourceId);
const metadata = JSON.parse(await readFile(join(sourceDirectory, "metadata.json"), "utf8"));
assert.ok([".mp4", ".webm", ".mov"].includes(metadata.extension));
const source = join(sourceDirectory, `video${metadata.extension}`);
assert.equal(await fileChecksum(source), metadata.checksum.value);
const root = join(workspace, "apps/api/.data/processing-smoke", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(root, { recursive: true });
const sample = join(root, "speech-sample.mp4"), signal = new AbortController().signal;
const originalProbe = await readProbeJson(await runMediaTool("ffprobe", inspectionArguments(source), signal));
const excerpt = await runMediaTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file", "-ss", "30", "-i", source, "-t", "150", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov", "pipe:1"], signal);
try { await pipeline(excerpt.content, createWriteStream(sample, { flags: "wx" })); } finally { await excerpt.dispose?.(); }
const evidence = { sourceUploadId: sourceId, originalDurationSeconds: Number(originalProbe.format.duration), excerptRequestedSeconds: 150, sourceStartSeconds: 30, stages: [], diagnostics: [], clips: [] };
let engineCalls = 0;
const realEngine = createFasterWhisperEngine(text => evidence.diagnostics.push(text), metrics => { evidence.engineMetrics = metrics; });
const engine = { async transcribe(path, abort) { engineCalls++; const started = performance.now(); try { return await realEngine.transcribe(path, abort); } finally { evidence.transcriptionSeconds = (performance.now() - started) / 1000; } } };
const directory = join(root, "uploads"), outputs = join(root, "clips");
const server = createServer({ directory }, {}, { engine }, { directory: outputs }); server.log.level = "error";
const started = performance.now();
try {
  const uploaded = await server.inject({ method: "POST", url: "/uploads/video", headers: { "content-type": "video/mp4", "x-file-name": "fala-portugues.mp4" }, payload: createReadStream(sample) });
  assert.equal(uploaded.statusCode, 200, uploaded.body); const upload = uploaded.json(); evidence.uploadId = upload.id;
  const initiated = await server.inject({ method: "POST", url: `/uploads/${upload.id}/process` }); assert.equal(initiated.statusCode, 202, initiated.body);
  let status;
  do {
    const response = await server.inject(`/uploads/${upload.id}/process/status`); assert.equal(response.statusCode, 200, response.body); status = response.json().status;
    if (evidence.stages.at(-1) !== status.stage) { evidence.stages.push(status.stage); console.log(`STAGE ${status.stage}`); }
    if (["completed", "failed"].includes(status.stage)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (performance.now() - started < 610000);
  assert.equal(status.stage, "completed", JSON.stringify(status));
  const batchResult = await server.inject(`/uploads/${upload.id}/clips`); assert.equal(batchResult.statusCode, 200, batchResult.body); const batch = batchResult.json().batch;
  const transcript = (await server.inject(`/uploads/${upload.id}/transcription`)).json().transcript;
  const queried = (await server.inject(`/uploads/${upload.id}`)).json().upload;
  evidence.testedDurationSeconds = queried.inspection.durationSeconds; evidence.language = transcript.language;
  evidence.wordCount = transcript.segments.flatMap(segment => segment.words).length; evidence.segmentCount = transcript.segments.length;
  evidence.generatedCount = batch.report.generatedCount; evidence.deduplicatedCount = batch.report.deduplicatedCount; evidence.rejectedCount = batch.report.rejectedCount;
  evidence.retainedCandidates = batch.report.candidates.length; evidence.scores = batch.report.candidates.map(item => ({ id: item.id, score: item.score.value, start: item.start, end: item.end }));
  evidence.batchId = batch.batchId;
  assert.ok(batch.clips.length <= 3);
  for (const clip of batch.clips) {
    const path = join(outputs, upload.id, batch.batchId, clip.file);
    assert.equal(await fileChecksum(path), clip.checksum);
    const probe = await readProbeJson(await runMediaTool("ffprobe", inspectionArguments(path), signal));
    const preview = join(root, `${clip.id}-preview.png`);
    const cue = buildCues(transcript, clip.candidate)[0]; assert.ok(cue);
    const frameTime = Math.min(cue.end - .02, cue.start + .2);
    const frame = await runMediaTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-ss", String(frameTime), "-i", path, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], signal);
    try { await pipeline(frame.content, createWriteStream(preview, { flags: "wx" })); } finally { await frame.dispose?.(); }
    const url = `/uploads/${upload.id}/clips/${batch.batchId}/${clip.id}/file`;
    const served = await server.inject({ url, headers: { range: "bytes=0-63" } }); assert.equal(served.statusCode, 206); assert.equal(served.rawPayload.length, 64);
    evidence.clips.push({ ...clip, path, preview, probe, firstCue: cue, previewTime: frameTime, served: true });
  }
  evidence.uploadFiles = await readdir(join(directory, upload.id)); evidence.workFiles = await readdir(join(outputs, ".work"));
  assert.ok(!evidence.uploadFiles.some(file => file.endsWith(".part"))); assert.deepEqual(evidence.workFiles, []); evidence.cleanup = true;
  await server.close();
  const restored = createServer({ directory }, {}, { engine: { async transcribe() { assert.fail("Reprocessamento inesperado"); } } }, { directory: outputs }); restored.log.level = "error";
  try {
    assert.deepEqual((await restored.inject(`/uploads/${upload.id}/clips`)).json().batch, batch);
    assert.equal((await restored.inject({ method: "POST", url: `/uploads/${upload.id}/process` })).json().reused, true);
    assert.equal((await restored.inject({ method: "POST", url: `/uploads/${upload.id}/analysis` })).json().reused, true);
    evidence.recovered = true; evidence.reused = true;
  } finally { await restored.close(); }
  assert.equal(engineCalls, 1); assert.equal(await fileChecksum(source), metadata.checksum.value); evidence.originalPreserved = true;
} catch (error) { evidence.error = error.stack ?? error.message; process.exitCode = 1; }
finally { await server.close(); evidence.totalSeconds = (performance.now() - started) / 1000; const path = join(root, "result.json"); await writeFile(path, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify({ ...evidence, clips: evidence.clips.map(({ candidate, probe, ...clip }) => ({ ...clip, score: candidate.score.value })) }, null, 2)); console.log(`EVIDENCE ${path}`); }
