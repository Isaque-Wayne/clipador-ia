import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { runMediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { createUploadService } from "../../apps/api/dist/features/uploads/services/receive-video.js";
import { createVideoPreparation } from "../../apps/api/dist/features/video-preparation/services/prepare-video.js";
import { createServer } from "../../apps/api/dist/server/create-server.js";

const base = fileURLToPath(new URL(`../../apps/api/.data/preparation-smoke/${randomUUID()}/`, import.meta.url));
const root = join(base, "uploads");
await mkdir(root, { recursive: true });
const uploads = createUploadService({ directory: root }); await uploads.initialize();
const controller = new AbortController();
const fixturePath = join(base, "synthetic-source.mp4");
const fixture = await runMediaTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
  "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "2", "-c:v", "mpeg4", "-c:a", "aac", "-n", "-f", "mp4", fixturePath], controller.signal);
let upload;
try { for await (const _chunk of fixture.content) { /* Drenar e confirmar exit zero. */ } }
finally { await fixture.dispose(); }
const fixtureBytes = await readFile(fixturePath); // Fixture controlada de 2 s, não vídeo do usuário.
assert.ok(fixtureBytes.indexOf(Buffer.from("moov")) > fixtureBytes.indexOf(Buffer.from("mdat")));
upload = await uploads.receiveVideo(createReadStream(fixturePath), "synthetic.mp4", "video/mp4");
const stages = [];
const preparation = createVideoPreparation(uploads);
const started = performance.now();
await preparation.prepare(upload.id, async (path, inspection) => {
  const audio = await readFile(path); // Fixture de apenas 2 s; produção permanece streaming.
  assert.equal(audio.subarray(0, 4).toString(), "RIFF");
  assert.ok(audio.length > 64000); assert.equal(inspection.width, 320); assert.equal(inspection.height, 180);
}, controller.signal, stage => stages.push(stage));
assert.deepEqual((await readdir(join(root, upload.id))).sort(), ["metadata.json", "video.mp4"]);
const cancelled = new AbortController();
await assert.rejects(preparation.prepare(upload.id, async () => assert.fail("Consumidor não deve executar após cancelamento"),
  cancelled.signal, stage => { if (stage === "extracting-audio") cancelled.abort(new Error("cancelamento de teste")); }), /cancelamento de teste/);
assert.deepEqual((await readdir(join(root, upload.id))).sort(), ["metadata.json", "video.mp4"]);
const limited = createUploadService({ directory: root, quotaBytes: upload.file.size + 4096 }); await limited.initialize();
await assert.rejects(createVideoPreparation(limited).prepare(upload.id, async () => assert.fail("Sem quota")), { statusCode: 507 });
assert.deepEqual((await readdir(join(root, upload.id))).sort(), ["metadata.json", "video.mp4"]);
await assert.rejects(preparation.prepare(upload.id, async () => { throw new Error("falha da engine simulada"); }), /falha da engine simulada/);
assert.deepEqual((await readdir(join(root, upload.id))).sort(), ["metadata.json", "video.mp4"]);
const server = createServer({ directory: root });
try {
  const inspect = await server.inject({ method: "POST", url: `/uploads/${upload.id}/inspect` });
  assert.equal(inspect.statusCode, 200);
  const get = await server.inject({ method: "GET", url: `/uploads/${upload.id}` });
  assert.equal(get.statusCode, 200);
  const result = get.json();
  assert.deepEqual(result.upload.inspection, uploads.findUpload(upload.id).inspection);
  console.log(JSON.stringify({ storage: root, id: upload.id, inspection: result.upload.inspection,
    stages, mp4WithTrailingMoov: true, temporaryAudioCleaned: true, cleanupAfterConsumerFailure: true, cleanupAfterCancellation: true,
    quotaEnforced: true, recoveredAfterRestart: true,
    getStatus: get.statusCode, inspectStatus: inspect.statusCode, elapsedMs: performance.now() - started }, null, 2));
} finally { await server.close(); }
