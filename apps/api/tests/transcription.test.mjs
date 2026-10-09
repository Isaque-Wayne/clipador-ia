import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, readdir, realpath, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createTranscriptionService } from "../dist/features/transcription/services/transcription-service.js";
import { normalizeTranscript } from "../dist/features/transcription/services/normalize-transcript.js";
import { runPython } from "../dist/features/transcription/services/python-runner.js";
import { scanUploadStorage } from "../dist/features/uploads/services/scan-upload-storage.js";
import { createServer } from "../dist/server/create-server.js";

const raw = { language: " PT ", languageProbability: .97, duration: 2, segments: [
  { id: 0, start: 0, end: 2, text: " Olá,   mundo! ", words: [
    { word: " Olá,", start: 0, end: .8, probability: .9 }, { word: " mundo! ", start: .8, end: 2, probability: null },
  ] },
] };
async function fixture(extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), "clipador-transcription-"));
  const uploads = createUploadService({ directory, ...extra }); await uploads.initialize();
  const upload = await uploads.receiveVideo(Readable.from([Buffer.from("controlled fixture")]), "fixture.mp4", "video/mp4");
  return { directory, uploads, upload };
}
async function prepareAudio(context, consume) {
  const audio = join(context.directory, "audio-asr.wav.part");
  context.reserve(1000); await writeFile(audio, Buffer.alloc(1000));
  try { await consume(audio); }
  finally { const { removePartial } = await import("../dist/features/transcription/services/transcript-persistence.js"); await removePartial(context.directory, "audio-asr.wav.part"); }
}
async function wait(service, id) {
  for (let i = 0; i < 200; i++) {
    const status = await service.status(id);
    if (["completed", "failed"].includes(status.stage)) return status;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Job did not finish");
}
test("normalização mantém tempos reais, texto, IDs e confiança ausente como null", () => {
  const result = normalizeTranscript(raw);
  assert.equal(result.language, "pt"); assert.equal(result.languageProbability, .97);
  assert.equal(result.text, "Olá, mundo!"); assert.equal(result.segments[0].id, 0);
  const corruptEncoding = structuredClone(raw); corruptEncoding.segments[0].text = "voc\uFFFD";
  assert.throws(() => normalizeTranscript(corruptEncoding));
  assert.equal(result.segments[0].words[0].end, .8);
  const absent = structuredClone(raw); delete absent.languageProbability; delete absent.segments[0].words[0].probability;
  assert.equal(normalizeTranscript(absent).languageProbability, null);
  assert.equal(normalizeTranscript(absent).segments[0].words[0].probability, null);
});
test("rejeita resultado inválido, NaN, tempos fora de ordem e confiança fabricada", () => {
  for (const input of [{ ...raw, languageProbability: 2 }, { ...raw, duration: NaN }, { ...raw, segments: [{ ...raw.segments[0], words: [] }] },
    { ...raw, segments: [{ ...raw.segments[0], end: 3 }] },
    { ...raw, segments: [{ ...raw.segments[0], words: [{ word: "x", start: 1, end: 3, probability: .5 }] }] },
    { ...raw, segments: [{ ...raw.segments[0], words: [{ word: "x", start: 0, end: 1, probability: 2 }] }] }])
    assert.throws(() => normalizeTranscript(input));
});
test("runner valida JSON e diferencia falha de processo, timeout, cancelamento e limite", async () => {
  const launch = (code, signal = new AbortController().signal, timeoutMs = 1000) =>
    runPython({ executable: process.execPath, args: ["-e", code], timeoutMs }, signal);
  assert.deepEqual(await launch('process.stdout.write(JSON.stringify({ok:true}))'), { ok: true });
  await assert.rejects(launch('process.stdout.write("invalid")'), { code: "INVALID_RESULT" });
  let diagnostic;
  await assert.rejects(runPython({ executable: process.execPath, args: ["-e", 'process.stderr.write("engine real error");process.exit(3)'],
    timeoutMs: 1000, onDiagnostic: text => { diagnostic = text; } }, new AbortController().signal), { code: "ENGINE_FAILED" });
  assert.equal(diagnostic, "engine real error");
  await assert.rejects(launch("setInterval(()=>{},1000)", undefined, 30), { code: "TIMEOUT" });
  const abort = new AbortController();
  const pending = launch("setInterval(()=>{},1000)", abort.signal);
  setTimeout(() => abort.abort(), 30); await assert.rejects(pending, { code: "CANCELLED" });
  await assert.rejects(launch('process.stdout.write("x".repeat(17*1024*1024))'), { code: "INVALID_RESULT" });
  await assert.rejects(runPython({ executable: join(tmpdir(), "missing-python-clipador.exe"), args: [], timeoutMs: 1000 }, new AbortController().signal),
    { code: "ENGINE_UNAVAILABLE" });
});
test("persistência íntegra, recuperação, reuso e quota/cleanup preservam o upload", async () => {
  let now = Date.now(), calls = 0;
  const { uploads, upload, directory } = await fixture({ now: () => now, retentionMs: 10000 });
  const service = createTranscriptionService(uploads, directory, { prepareAudio, engine: { async transcribe() { calls++; return normalizeTranscript(raw); } } });
  assert.equal((await service.start(upload.id)).reused, false);
  assert.equal((await wait(service, upload.id)).stage, "completed");
  assert.equal((await service.result(upload.id)).text, "Olá, mundo!");
  assert.equal((await service.start(upload.id)).reused, true); assert.equal(calls, 1);
  assert.deepEqual((await readdir(join(directory, upload.id))).sort(), ["metadata.json", "transcript.json", "video.mp4"]);
  const disk = JSON.parse(await readFile(join(directory, upload.id, "transcript.json"), "utf8"));
  assert.deepEqual(disk.sourceChecksum, upload.checksum);
  const snapshot = await scanUploadStorage(await realpath(directory));
  const bytes = await Promise.all((await readdir(join(directory, upload.id))).map(name => lstat(join(directory, upload.id, name))));
  assert.equal(snapshot.bytes, bytes.reduce((sum, stat) => sum + stat.size, 0));
  await uploads.consumeUpload(upload.id, async () => {
    const pinned = await scanUploadStorage(await realpath(directory), new Set(), new Set([upload.id]));
    assert.equal(pinned.bytes, snapshot.bytes, "Transcrição concluída conta quota mesmo com upload em uso");
  });
  await service.close();
  await writeFile(join(directory, upload.id, "audio-asr.wav.part"), "crash after commit");
  await writeFile(join(directory, upload.id, "transcript.json.part"), "crash after commit");
  const restartedUploads = createUploadService({ directory, now: () => now, retentionMs: 10000 }); await restartedUploads.initialize();
  const restarted = createTranscriptionService(restartedUploads, directory, { engine: { transcribe() { assert.fail("Must reuse"); } } });
  assert.equal((await restarted.status(upload.id)).stage, "completed");
  assert.equal((await restarted.start(upload.id)).reused, true);
  assert.deepEqual((await readdir(join(directory, upload.id))).sort(), ["metadata.json", "transcript.json", "video.mp4"]);
  assert.equal((await restarted.result(upload.id)).segments[0].words.length, 2);
  assert.deepEqual(restartedUploads.findUpload(upload.id).checksum, upload.checksum);
  now += 20000; await restartedUploads.cleanup(); assert.deepEqual(await readdir(directory), []);
});
test("corrupção de transcrição bloqueia reuso sem sobrescrever ou tocar no vídeo", async () => {
  const { uploads, upload, directory } = await fixture();
  const service = createTranscriptionService(uploads, directory, { prepareAudio, engine: { async transcribe() { return normalizeTranscript(raw); } } });
  await service.start(upload.id); await wait(service, upload.id);
  const path = join(directory, upload.id, "transcript.json");
  const disk = JSON.parse(await readFile(path, "utf8")); disk.transcript.text = "changed"; await writeFile(path, JSON.stringify(disk));
  await assert.rejects(service.start(upload.id), { code: "INVALID_RESULT" });
  assert.ok(uploads.findUpload(upload.id)); assert.equal(JSON.parse(await readFile(path, "utf8")).transcript.text, "changed");
});
test("falha e resultado inválido nunca persistem e liberam temporários", async () => {
  for (const engine of [{ async transcribe() { throw new Error("failed"); } }, { async transcribe() { return { bad: true }; } }]) {
    const { uploads, upload, directory } = await fixture();
    const service = createTranscriptionService(uploads, directory, { prepareAudio, engine });
    await service.start(upload.id); assert.equal((await wait(service, upload.id)).stage, "failed");
    await assert.rejects(service.result(upload.id), { code: "NOT_COMPLETED" });
    assert.deepEqual((await readdir(join(directory, upload.id))).sort(), ["metadata.json", "video.mp4"]);
    assert.equal(uploads.findUpload(upload.id).status, "uploaded");
  }
});
test("timeout, cancelamento, duplicidade e shutdown encerram engine e limpam áudio", async () => {
  const blocking = { transcribe(path, signal) { return new Promise((resolve, reject) => {
    signal.throwIfAborted(); signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }); } };
  for (const mode of ["timeout", "cancel", "close"]) {
    const { uploads, upload, directory } = await fixture();
    const service = createTranscriptionService(uploads, directory, { prepareAudio, engine: blocking, timeoutMs: mode === "timeout" ? 80 : 1000 });
    await service.start(upload.id);
    await assert.rejects(service.start(upload.id), { code: "IN_PROGRESS" });
    if (mode === "cancel") await service.cancel(upload.id);
    if (mode === "close") await service.close();
    const status = await wait(service, upload.id);
    assert.equal(status.stage, "failed"); assert.equal(status.error.code, mode === "timeout" ? "TIMEOUT" : "CANCELLED");
    assert.deepEqual((await readdir(join(directory, upload.id))).sort(), ["metadata.json", "video.mp4"]);
  }
});
test("quota bloqueia publicação e parciais de crash não invalidam o upload", async () => {
  const { uploads, upload, directory } = await fixture({ quotaBytes: 1800 });
  await writeFile(join(directory, upload.id, "transcript.json.part"), "orphan");
  await writeFile(join(directory, upload.id, "audio-asr.wav.part"), "orphan");
  const restarted = createUploadService({ directory, quotaBytes: 1800 }); await restarted.initialize();
  assert.ok(restarted.findUpload(upload.id));
  const service = createTranscriptionService(restarted, directory, { prepareAudio, engine: { async transcribe() { return normalizeTranscript(raw); } } });
  await service.start(upload.id); assert.equal((await wait(service, upload.id)).stage, "failed");
  assert.deepEqual((await readdir(join(directory, upload.id))).sort(), ["metadata.json", "video.mp4"]);
});
test("rotas: 404, status real, 202, GET concluído, reuso 200 e checksum preservado", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clipador-transcription-routes-"));
  const server = createServer({ directory }, {}, { prepareAudio, engine: { async transcribe() { return normalizeTranscript(raw); } } });
  try {
    assert.equal((await server.inject({ method: "POST", url: "/uploads/missing/transcription" })).statusCode, 404);
    const received = await server.inject({ method: "POST", url: "/uploads/video", headers: { "content-type": "video/mp4", "x-file-name": "fixture.mp4" }, payload: Buffer.from("fixture") });
    const upload = received.json(); const id = upload.id;
    assert.ok(id, JSON.stringify(upload));
    assert.equal((await server.inject({ method: "GET", url: `/uploads/${id}/transcription` })).statusCode, 409);
    assert.equal((await server.inject({ method: "POST", url: `/uploads/${id}/transcription` })).statusCode, 202);
    let status;
    for (let i = 0; i < 200; i++) {
      status = (await server.inject({ method: "GET", url: `/uploads/${id}/transcription/status` })).json().status;
      if (["completed", "failed"].includes(status.stage)) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(status.stage, "completed");
    assert.equal((await server.inject({ method: "GET", url: `/uploads/${id}/transcription` })).json().transcript.text, "Olá, mundo!");
    assert.equal((await server.inject({ method: "POST", url: `/uploads/${id}/transcription` })).statusCode, 200);
  } finally { await server.close(); }
});
