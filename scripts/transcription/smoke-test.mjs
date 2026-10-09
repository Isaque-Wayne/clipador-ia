import assert from "node:assert/strict";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile, readdir, lstat, readFile, realpath } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "../../apps/api/dist/server/create-server.js";
import { createFasterWhisperEngine } from "../../apps/api/dist/features/transcription/services/faster-whisper-engine.js";
import { runMediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { readProbeJson } from "../../apps/api/dist/features/video-preparation/services/read-probe-json.js";
import { inspectionArguments } from "../../apps/api/dist/features/video-preparation/utils/media-commands.js";
import { isUploadId } from "../../apps/api/dist/features/uploads/utils/upload-names.js";
import { prepareStorageRoot, uploadPath } from "../../apps/api/dist/features/uploads/services/storage-paths.js";

const workspace = resolve(import.meta.dirname, "../..");
const sourceId = process.argv[2];
if (!sourceId || !isUploadId(sourceId)) throw new Error("Passe um UUID de upload local com fala real.");
const sourceDirectory = await uploadPath(await prepareStorageRoot(join(workspace, "apps/api/.data/uploads")), sourceId);
const metadata = JSON.parse(await readFile(join(sourceDirectory, "metadata.json"), "utf8"));
assert.ok([".mp4", ".webm", ".mov"].includes(metadata.extension));
const source = join(sourceDirectory, `video${metadata.extension}`);
assert.equal(await realpath(source), source);
async function checksum(path) {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex");
}
assert.equal(await checksum(source), metadata.checksum.value);
const root = join(workspace, "apps/api/.data/transcription-smoke", new Date().toISOString().replace(/[:.]/g, "-"));
await mkdir(root, { recursive: true });
const sample = join(root, "speech-sample.mp4");
// Apenas extrair uma fixture curta com stream copy; não renderizar cortes do produto.
const excerpt = await runMediaTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "file",
  "-ss", "30", "-i", source, "-t", "20", "-map", "0:v:0", "-map", "0:a:0", "-c", "copy", "-f", "mp4",
  "-movflags", "frag_keyframe+empty_moov", "pipe:1"], new AbortController().signal);
try { await pipeline(excerpt.content, createWriteStream(sample, { flags: "wx" })); }
finally { await excerpt.dispose?.(); }
const evidence = { sourceUploadId: sourceId, sourceStartSeconds: 30, excerptRequestedSeconds: 20, stages: [], diagnostics: [] };
let calls = 0;
const realEngine = createFasterWhisperEngine(text => evidence.diagnostics.push(text), metrics => { evidence.engineMetrics = metrics; });
const engine = { async transcribe(path, signal) {
  calls++;
  evidence.audioTemporaryBytes = (await lstat(path)).size;
  const probe = await readProbeJson(await runMediaTool("ffprobe", inspectionArguments(path, "audio"), signal));
  evidence.audioDurationSeconds = Number(probe.format.duration);
  return realEngine.transcribe(path, signal);
} };
const directory = join(root, "uploads");
const server = createServer({ directory }, {}, { engine });
server.log.level = "warn";
const started = performance.now();
try {
  assert.equal((await server.inject({ method: "GET", url: "/health" })).statusCode, 200);
  const uploaded = await server.inject({ method: "POST", url: "/uploads/video", headers: { "content-type": "video/mp4", "x-file-name": "speech-sample.mp4" }, payload: createReadStream(sample) });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const upload = uploaded.json(); evidence.uploadId = upload.id; evidence.videoBytes = upload.file.size;
  const initiated = await server.inject({ method: "POST", url: `/uploads/${upload.id}/transcription` });
  assert.equal(initiated.statusCode, 202, initiated.body);
  const transcriptionStarted = performance.now();
  let status;
  do {
    const response = await server.inject({ method: "GET", url: `/uploads/${upload.id}/transcription/status` });
    assert.equal(response.statusCode, 200, response.body); status = response.json().status;
    if (evidence.stages.at(-1) !== status.stage) { evidence.stages.push(status.stage); console.log(`STAGE ${status.stage}`); }
    if (["completed", "failed"].includes(status.stage)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (performance.now() - transcriptionStarted < 310000);
  evidence.transcriptionSeconds = (performance.now() - transcriptionStarted) / 1000;
  assert.equal(status.stage, "completed", JSON.stringify(status));
  const result = await server.inject({ method: "GET", url: `/uploads/${upload.id}/transcription` });
  assert.equal(result.statusCode, 200, result.body); const transcript = result.json().transcript;
  evidence.language = transcript.language; evidence.languageProbability = transcript.languageProbability;
  evidence.text = transcript.text; evidence.segmentCount = transcript.segments.length;
  const words = transcript.segments.flatMap(segment => segment.words);
  evidence.wordCount = words.length; evidence.words = words;
  assert.ok(words.length > 0); assert.ok(words.every(word => Number.isFinite(word.start) && Number.isFinite(word.end)));
  evidence.wordTimestamps = true;
  const queried = (await server.inject({ method: "GET", url: `/uploads/${upload.id}` })).json().upload;
  evidence.videoDurationSeconds = queried.inspection.durationSeconds;
  assert.deepEqual(queried.checksum, upload.checksum);
  evidence.speedFactor = evidence.audioDurationSeconds / evidence.transcriptionSeconds;
  evidence.realTimeFactor = evidence.transcriptionSeconds / evidence.audioDurationSeconds;
  evidence.files = await readdir(join(directory, upload.id));
  assert.ok(!evidence.files.some(name => name.endsWith(".part"))); evidence.cleanup = true;
  await server.close();
  const restored = createServer({ directory }, {}, { engine: { transcribe() { assert.fail("Reprocessamento inesperado"); } } });
  restored.log.level = "warn";
  try {
    const recovered = await restored.inject({ method: "GET", url: `/uploads/${upload.id}/transcription` });
    assert.equal(recovered.statusCode, 200, recovered.body); assert.deepEqual(recovered.json().transcript, transcript);
    const reused = await restored.inject({ method: "POST", url: `/uploads/${upload.id}/transcription` });
    assert.equal(reused.statusCode, 200); assert.equal(reused.json().reused, true);
    evidence.recovered = true; evidence.reused = true;
  } finally { await restored.close(); }
  assert.equal(calls, 1); assert.equal(await checksum(source), metadata.checksum.value); evidence.originalPreserved = true;
} catch (error) { evidence.error = error.message; process.exitCode = 1; }
finally {
  await server.close(); evidence.totalSeconds = (performance.now() - started) / 1000;
  const path = join(root, "result.json"); await writeFile(path, JSON.stringify(evidence, null, 2));
  const { words, ...summary } = evidence; console.log(JSON.stringify(summary, null, 2)); console.log(`EVIDENCE ${path}`);
}
