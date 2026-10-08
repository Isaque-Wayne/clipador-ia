import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { parseProbe } from "../dist/features/video-preparation/utils/parse-probe.js";
import { parseInspection } from "../dist/features/video-preparation/utils/parse-inspection.js";
import { audioArguments, inspectionArguments, descriptorInspectionArguments } from "../dist/features/video-preparation/utils/media-commands.js";
import { validateAudioProbe } from "../dist/features/video-preparation/services/validate-prepared-audio.js";
import { readProbeJson } from "../dist/features/video-preparation/services/read-probe-json.js";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { scanUploadStorage } from "../dist/features/uploads/services/scan-upload-storage.js";
import { normalizeTranscript } from "../dist/features/transcription/services/normalize-transcript.js";
import { openMediaInput } from "../dist/features/video-preparation/services/open-media-input.js";
import { withPreparedAudio } from "../dist/features/video-preparation/services/prepare-audio.js";

const probe = { streams: [
  { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001", display_aspect_ratio: "16:9" },
  { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
], format: { duration: "60.5", format_name: "mov,mp4,m4a,3gp,3g2,mj2", bit_rate: "1000000" } };
const inspection = parseProbe(probe);
async function uploaded(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "clipador-preparation-"));
  const uploads = createUploadService({ directory, ...options }); await uploads.initialize();
  const upload = await uploads.receiveVideo(Readable.from([Buffer.from("fixture")]), "video.mp4", "video/mp4");
  return { uploads, directory, upload };
}

test("FFprobe JSON preserva duração, dimensões, FPS racional, áudio, DAR e bitrate", () => {
  assert.equal(inspection.durationSeconds, 60.5); assert.equal(inspection.fps, 30000 / 1001);
  assert.equal(inspection.aspectRatio, 16 / 9); assert.deepEqual(inspection.audio, { codec: "aac", sampleRate: 48000, channels: 2 });
  assert.equal(inspection.bitrate, 1000000); assert.deepEqual(parseInspection(inspection), inspection);
  assert.equal(parseProbe({ ...probe, streams: [probe.streams[0]], format: { ...probe.format, bit_rate: "N/A" } }).audio, null);
  assert.equal(parseProbe({ ...probe, streams: [{ ...probe.streams[0], avg_frame_rate: "0/0", r_frame_rate: "25/1" }] }).fps, 25);
  assert.throws(() => parseProbe({ ...probe, streams: [probe.streams[1]] }), { statusCode: 422 });
  assert.throws(() => parseProbe({ ...probe, format: { ...probe.format, duration: "Infinity" } }), { statusCode: 422 });
  assert.equal(parseInspection({ ...inspection, width: -1 }), undefined);
});
test("áudio mono 16 kHz e comandos restritos a arquivos, sem reencode do vídeo", () => {
  const path = "C:\\controlled\\video.mp4"; const args = audioArguments();
  assert.equal(args[args.indexOf("-i") + 1], "fd:"); assert.equal(args.at(-1), "pipe:1");
  assert.equal(descriptorInspectionArguments()[3], "fd");
  assert.ok(args.includes("-vn")); assert.equal(args[args.indexOf("-ac") + 1], "1");
  assert.equal(args[args.indexOf("-ar") + 1], "16000"); assert.ok(args.includes("pcm_s16le"));
  assert.equal(inspectionArguments(path)[3], "file");
  assert.ok(args.includes("mov,matroska,webm")); assert.ok(inspectionArguments(path, "audio").includes("wav"));
  const valid = { streams: [{ codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "16000", channels: 1 }], format: { format_name: "wav", duration: "60.5" } };
  validateAudioProbe(valid, 60.5);
  for (const changes of [{ channels: 2 }, { sample_rate: "48000" }, { codec_name: "aac" }])
    assert.throws(() => validateAudioProbe({ ...valid, streams: [{ ...valid.streams[0], ...changes }] }, 60.5), { statusCode: 422 });
  validateAudioProbe({ ...valid, format: { ...valid.format, duration: "2" } }, 60.5);
  assert.throws(() => validateAudioProbe({ ...valid, format: { ...valid.format, duration: "120" } }, 60.5), { statusCode: 422 });
});
test("JSON do probe é limitado e sempre encerra o processo, inclusive após falha", async () => {
  for (const data of ["not-json", " ".repeat(524289)]) {
    let disposed = false;
    await assert.rejects(readProbeJson({ content: Readable.from([Buffer.from(data)]), dispose: () => { disposed = true; } }), { statusCode: 422 });
    assert.equal(disposed, true);
  }
});
test("inspeção é persistida no metadata, consulta e recuperação sem expor caminhos", async () => {
  const { uploads, directory, upload } = await uploaded();
  await uploads.prepareUpload(upload.id, async (context) => { await context.persistInspection(inspection); });
  assert.deepEqual(uploads.findUpload(upload.id).inspection, inspection);
  const disk = JSON.parse(await readFile(join(directory, upload.id, "metadata.json"), "utf8"));
  assert.deepEqual(disk.inspection, inspection); assert.equal(disk.path, undefined);
  const restarted = createUploadService({ directory }); await restarted.initialize();
  assert.deepEqual(restarted.findUpload(upload.id).inspection, inspection);
  assert.deepEqual(restarted.findUpload(upload.id).checksum, upload.checksum);
});
test("reserva de preparação conta quota, refresh não conta áudio duas vezes e crash preserva upload original", async () => {
  const { uploads, directory, upload } = await uploaded({ quotaBytes: 2000 });
  await uploads.prepareUpload(upload.id, async (context) => {
    context.reserve(1000);
    const path = join(context.directory, "audio-asr.wav.part"); await writeFile(path, Buffer.alloc(1000));
    await uploads.cleanup();
    context.reserve(1100); // Deve caber mesmo com áudio já em disco.
  });
  const restarted = createUploadService({ directory, quotaBytes: 2000 }); await restarted.initialize();
  assert.ok(restarted.findUpload(upload.id));
  await assert.rejects(restarted.prepareUpload(upload.id, async (context) => context.reserve(1000)), { statusCode: 507 });
  const snapshot = await scanUploadStorage(await realpath(directory)); assert.ok(snapshot.bytes >= 1007);
});
test("preparação compartilha concorrência com uploads e libera vaga após falha", async () => {
  const { uploads, upload } = await uploaded({ maxConcurrentUploads: 1 });
  let enter; const entered = new Promise(resolve => { enter = resolve; });
  let exit; const blocked = new Promise(resolve => { exit = resolve; });
  const pending = uploads.prepareUpload(upload.id, async () => { enter(); await blocked; throw new Error("falha de etapa"); });
  await entered;
  await assert.rejects(uploads.receiveVideo(Readable.from([Buffer.from("x")]), "next.mp4", "video/mp4"), { statusCode: 429 });
  exit(); await assert.rejects(pending, /falha de etapa/);
  assert.ok(uploads.findUpload(upload.id));
  assert.equal((await uploads.receiveVideo(Readable.from([Buffer.from("x")]), "next.mp4", "video/mp4")).status, "uploaded");
});
test("timeout e cancelamento propagam sinal e liberam a operação", async () => {
  const previous = process.env.VIDEO_PREPARATION_TIMEOUT_MS;
  try {
    process.env.VIDEO_PREPARATION_TIMEOUT_MS = "30";
    const { uploads, upload } = await uploaded({ maxConcurrentUploads: 1 });
    const wait = context => new Promise((_, reject) => {
      context.signal.throwIfAborted(); context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
    });
    await assert.rejects(uploads.prepareUpload(upload.id, wait), { statusCode: 408 });
    const abort = new AbortController(); abort.abort(new Error("cancelado"));
    await assert.rejects(uploads.prepareUpload(upload.id, wait, abort.signal), /cancelado/);
    assert.equal((await uploads.receiveVideo(Readable.from([Buffer.from("x")]), "next.mp4", "video/mp4")).status, "uploaded");
  } finally {
    if (previous === undefined) delete process.env.VIDEO_PREPARATION_TIMEOUT_MS;
    else process.env.VIDEO_PREPARATION_TIMEOUT_MS = previous;
  }
});
test("áudio órfão é gerenciado e removido com o upload expirado", async () => {
  let now = Date.now(); const { uploads, directory, upload } = await uploaded({ retentionMs: 1000, now: () => now });
  await writeFile(join(directory, upload.id, "audio-asr.wav.part"), "orphan");
  await uploads.cleanup(); assert.ok(uploads.findUpload(upload.id));
  now += 5000; await uploads.cleanup(); assert.deepEqual(await readdir(directory), []);
});
test("normalização mantém pontuação, tempos e probabilidade sem fabricar palavras", () => {
  const transcript = { language: " PT ", duration: 2, segments: [{ start: 0, end: 2, text: " Olá,   mundo! ", words: [
    { word: " Olá,", start: 0, end: .8, probability: .9 }, { word: " mundo! ", start: .8, end: 2, probability: null },
  ] }] };
  const normalized = normalizeTranscript(transcript);
  assert.equal(normalized.language, "pt"); assert.equal(normalized.segments[0].text, "Olá, mundo!");
  assert.equal(normalized.segments[0].words[0].word, "Olá,"); assert.equal(normalized.segments[0].words[0].end, .8);
  assert.throws(() => normalizeTranscript({ ...transcript, segments: [{ ...transcript.segments[0], words: [] }] }), /timestamps por palavra/);
  assert.throws(() => normalizeTranscript({ ...transcript, segments: [{ ...transcript.segments[0], end: 3 }] }));
  assert.throws(() => normalizeTranscript({ ...transcript, segments: [{ ...transcript.segments[0], words: [{ word: "x", start: 0, end: 1, probability: 2 }] }] }));
});
test("arquivo corrompido e paths maliciosos são bloqueados antes da preparação", async () => {
  const { uploads, directory, upload } = await uploaded();
  await writeFile(join(directory, upload.id, "video.mp4"), "changed");
  let called = false;
  await assert.rejects(uploads.prepareUpload(upload.id, async () => { called = true; }), { statusCode: 409 });
  assert.equal(called, false);
  await assert.rejects(uploads.prepareUpload("../../escape", async () => { called = true; }), { statusCode: 404 });
  assert.equal(called, false);
});
test("descritor reaberto deve corresponder à identidade verificada; áudio alheio não é removido", async () => {
  const { uploads, directory, upload } = await uploaded();
  await uploads.prepareUpload(upload.id, async context => {
    await assert.rejects(openMediaInput({ ...context.input, identity: { ...context.input.identity, ino: context.input.identity.ino + 1n } }), { statusCode: 409 });
    const source = await openMediaInput(context.input); await source.close();
    const audio = join(directory, upload.id, "audio-asr.wav.part"); await writeFile(audio, "preexisting");
    await assert.rejects(withPreparedAudio(context.input, context.directory, inspection, context.signal, () => {}, async () => assert.fail()), { code: "EEXIST" });
    assert.equal(await readFile(audio, "utf8"), "preexisting");
    await assert.rejects(withPreparedAudio(context.input, context.directory, { ...inspection, audio: null }, context.signal,
      () => assert.fail("Sem áudio não deve reservar"), async () => assert.fail()), { statusCode: 422 });
  });
});
