import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReadStream } from "node:fs";
import { buildCues } from "../dist/features/clip-rendering/subtitles/cues.js";
import { createAss } from "../dist/features/clip-rendering/subtitles/ass.js";
import { composition, renderArguments } from "../dist/features/clip-rendering/services/render-commands.js";
import { runRenderProcess } from "../dist/features/clip-rendering/services/render-process.js";
import { createClipStorage } from "../dist/features/clip-rendering/services/clip-storage.js";
import { createResourceGate } from "../dist/features/processing/services/resource-gate.js";
import { createServer } from "../dist/server/create-server.js";
import { mediaTool } from "../dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { normalizeTranscript } from "../dist/features/transcription/services/normalize-transcript.js";

const raw = { language: "pt", duration: 3, segments: [{ id: 0, start: .2, end: 2.8, text: "Olá, este é um corte real.", words: ["Olá,", "este", "é", "um", "corte", "real."].map((word, i) => ({ word, start: .2 + i * .4, end: .6 + i * .4 })) }] };
const transcript = normalizeTranscript(raw);
const signal = new AbortController().signal;
test("cues usam timestamps relativos, poucas palavras e ASS sem tags injetadas", () => {
  const cues = buildCues(transcript, { start: .1, end: 3 });
  assert.equal(cues.length, 2); assert.ok(cues.every(cue => cue.start >= 0 && cue.end <= 2.9 && cue.text.split(" ").length <= 5));
  const ass = createAss([...cues, { start: 0, end: 1, text: "{\\pos(0,0)}Texto\\Ncontrole" }]);
  assert.match(ass, /PlayResY: 1920/); assert.match(ass, /Arial,60/); assert.match(ass, /130,130,470/);
  assert.ok(!ass.includes("{\\pos")); assert.ok(!ass.includes("\\N"));
});
test("composição preserva proporção; comando tem limite, seek preciso e legendas", () => {
  assert.equal(composition({ width: 1920, height: 1080 }).layout, "padding");
  assert.equal(composition({ width: 1080, height: 1920 }).layout, "crop");
  const args = renderArguments({ id: "c_0123456789abcdef", start: 1.2, end: 31.2 }, { width: 1920, height: 1080, fps: 60 });
  assert.ok(args.includes("fd:")); assert.ok(args.includes("libopenh264")); assert.ok(args.includes("aac")); assert.equal(args[args.indexOf("-t") + 1], "30");
  assert.equal(args[args.indexOf("-r") + 1], "30"); assert.match(args[args.indexOf("-vf") + 1], /ass=filename=c_0123456789abcdef.ass/);
  assert.throws(() => renderArguments({ id: "../bad", start: 0, end: 3 }, { width: 1, height: 1, fps: 30 }));
});
test("runner registra erro real, timeout, cancelamento e processo inexistente", async () => {
  let diagnostic;
  const run = (code, timeoutMs = 1000, abort = signal) => runRenderProcess({ executable: process.execPath, args: ["-e", code], cwd: process.cwd(), timeoutMs, onDiagnostic: text => { diagnostic = text; } }, abort);
  await assert.rejects(run('process.stderr.write("real ffmpeg failure");process.exit(2)'), { code: "FFMPEG_FAILED" }); assert.equal(diagnostic, "real ffmpeg failure");
  await assert.rejects(run("setInterval(()=>{},1000)", 30), { code: "RENDER_TIMEOUT" });
  const abort = new AbortController(); const pending = run("setInterval(()=>{},1000)", 1000, abort.signal); setTimeout(() => abort.abort(), 30); await assert.rejects(pending, { code: "CANCELLED" });
  await assert.rejects(runRenderProcess({ executable: join(tmpdir(), "missing-clipador-ffmpeg.exe"), args: [], cwd: process.cwd(), timeoutMs: 1000 }, signal), { code: "FFMPEG_UNAVAILABLE" });
});
test("gate libera recurso e storage limpa apenas temporários controlados", async () => {
  const gate = createResourceGate(), release = gate.acquire(); assert.throws(() => gate.acquire(), { code: "BUSY" }); release(); release(); gate.acquire()();
  const directory = await mkdtemp(join(tmpdir(), "clipador-outputs-")), storage = createClipStorage(directory, 100);
  await storage.initialize(); await assert.rejects(storage.reserve(101), { code: "OUTPUT_QUOTA" });
  const id = "f174c731-3291-4c3f-8bb4-6250559c14fe", work = await storage.work(id, true);
  await writeFile(join(work, "c_0123456789abcdef.mp4.part"), "partial"); await storage.initialize();
  assert.deepEqual(await readdir(join(directory, ".work")), []);
  const unsafe = await storage.work(id, true); await writeFile(join(unsafe, "preserve.txt"), "important");
  await assert.rejects(storage.clearWork(id), { code: "UNSAFE_STORAGE" }); assert.equal(await readFile(join(unsafe, "preserve.txt"), "utf8"), "important");
});
test("fixture real: pipeline, MP4 com áudio, ASS queimado, GET/ranges, reuso e recuperação", { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "clipador-render-fixture-")), directory = join(root, "uploads"), outputs = join(root, "clips");
  const ffmpeg = await mediaTool("ffmpeg");
  await runRenderProcess({ executable: ffmpeg, args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=15:d=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libopenh264", "-b:v", "300k", "-c:a", "aac", "-shortest", "fixture.mp4"], cwd: root, timeoutMs: 15000 }, signal);
  let engineCalls = 0;
  const options = { directory: outputs };
  const server = createServer({ directory }, {}, { engine: { async transcribe() { engineCalls++; return transcript; } } }, options); server.log.level = "silent";
  let id, batch;
  try {
    const received = await server.inject({ method: "POST", url: "/uploads/video", headers: { "content-type": "video/mp4", "x-file-name": "fixture.mp4" }, payload: createReadStream(join(root, "fixture.mp4")) });
    assert.equal(received.statusCode, 200, received.body); id = received.json().id;
    assert.equal((await server.inject({ method: "POST", url: `/uploads/${id}/process` })).statusCode, 202);
    assert.equal((await server.inject({ method: "POST", url: `/uploads/${id}/process` })).statusCode, 409);
    let status;
    for (let i = 0; i < 400; i++) { status = (await server.inject(`/uploads/${id}/process/status`)).json().status; if (["failed", "completed"].includes(status.stage)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
    assert.equal(status.stage, "completed", JSON.stringify(status));
    const response = await server.inject(`/uploads/${id}/clips`); assert.equal(response.statusCode, 200, response.body); batch = response.json().batch;
    assert.equal(batch.clips.length, 1); const clip = batch.clips[0]; assert.equal(clip.metadata.subtitlesBurned, true); assert.equal(clip.metadata.audioCodec, "aac"); assert.equal(clip.width, 1080); assert.ok(clip.size > 1000);
    assert.equal((await server.inject(`/uploads/${id}/analysis/candidates/${clip.id}`)).statusCode, 200);
    assert.equal((await server.inject({ method: "POST", url: `/uploads/${id}/analysis/select`, payload: { candidateIds: ["c_0000000000000000"] } })).statusCode, 400);
    const url = `/uploads/${id}/clips/${batch.batchId}/${clip.id}/file`;
    const range = await server.inject({ url, headers: { range: "bytes=0-31" } }); assert.equal(range.statusCode, 206); assert.equal(range.rawPayload.length, 32); assert.match(range.headers["content-range"], /^bytes 0-31\//);
    assert.equal((await server.inject({ url, headers: { range: "bytes=999999999-" } })).statusCode, 416);
    const download = await server.inject(`${url}?download=1`); assert.match(download.headers["content-disposition"], /attachment/);
    assert.equal((await server.inject({ method: "POST", url: `/uploads/${id}/process` })).json().reused, true);
    assert.equal(engineCalls, 1); assert.deepEqual(await readdir(join(outputs, ".work")), []);
    assert.deepEqual((await readdir(join(directory, id))).sort(), ["analysis.json", "metadata.json", "processing-legacy.json", "transcript.json", "video.mp4"]);
  } finally { await server.close(); }
  const restored = createServer({ directory }, {}, { engine: { async transcribe() { assert.fail("No reprocessing"); } } }, options); restored.log.level = "silent";
  try {
    assert.deepEqual((await restored.inject(`/uploads/${id}/clips`)).json().batch, batch);
    assert.equal((await restored.inject({ method: "POST", url: `/uploads/${id}/process` })).json().reused, true);
  } finally { await restored.close(); }
  // Exercise the real pipeline's rollback after a child-process deadline.
  const timeoutOutputs = join(root, "timeout-clips");
  const timed = createServer({ directory }, {}, {}, { directory: timeoutOutputs, renderTimeoutMs: 1 }); timed.log.level = "silent";
  try {
    assert.equal((await timed.inject({ method: "POST", url: `/uploads/${id}/process` })).statusCode, 202);
    let status;
    for (let i = 0; i < 100; i++) { status = (await timed.inject(`/uploads/${id}/process/status`)).json().status; if (status.stage === "failed") break; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.equal(status.stage, "failed", JSON.stringify(status)); assert.equal(status.error.code, "RENDER_TIMEOUT");
    assert.deepEqual(await readdir(join(timeoutOutputs, ".work")), []);
    assert.equal((await timed.inject(`/uploads/${id}`)).statusCode, 200);
    const saved = batch.clips[0];
    assert.deepEqual((await readdir(join(outputs, id, batch.batchId))).sort(), [saved.file, saved.socialPackage.thumbnail.file, saved.socialPackage.sourceFrame.file, saved.socialPackage.metadata.file, "manifest.json"].sort());
  } finally { await timed.close(); }
  const cancelledOutputs = join(root, "cancelled-clips");
  const cancelled = createServer({ directory }, {}, {}, { directory: cancelledOutputs }); cancelled.log.level = "silent";
  try {
    await cancelled.inject({ method: "POST", url: `/uploads/${id}/process` });
    assert.equal((await cancelled.inject({ method: "DELETE", url: `/uploads/${id}/process` })).json().status.error.code, "CANCELLED");
    assert.deepEqual(await readdir(join(cancelledOutputs, ".work")), []);
    assert.equal((await cancelled.inject(`/uploads/${id}`)).statusCode, 200);
  } finally { await cancelled.close(); }
  const failureDirectory = join(root, "broken-uploads"), failureOutputs = join(root, "broken-clips");
  // An invalid source cannot reach a successful render; its validated ingestion remains available.
  const broken = createServer({ directory: failureDirectory }, {}, {}, { directory: failureOutputs }); broken.log.level = "silent";
  try {
    const received = await broken.inject({ method: "POST", url: "/uploads/video", headers: { "content-type": "video/mp4", "x-file-name": "broken.mp4" }, payload: Buffer.from("not media") });
    const failedId = received.json().id;
    await broken.inject({ method: "POST", url: `/uploads/${failedId}/process` });
    let status;
    for (let i = 0; i < 100; i++) { status = (await broken.inject(`/uploads/${failedId}/process/status`)).json().status; if (status.stage === "failed") break; await new Promise(resolve => setTimeout(resolve, 20)); }
    assert.equal(status.stage, "failed", JSON.stringify(status)); assert.ok(status.error.message);
    assert.deepEqual(await readdir(join(failureOutputs, ".work")), []);
    assert.equal((await broken.inject(`/uploads/${failedId}`)).statusCode, 200);
  } finally { await broken.close(); }
});
