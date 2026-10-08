import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { parseYouTubeUrl } from "../../../config/youtube-url.mjs";
import { selectInput } from "../dist/features/youtube-ingestion/utils/select-input.js";
import { parseVideoInfo } from "../dist/features/youtube-ingestion/utils/parse-video-info.js";
import { mergeVideo } from "../dist/features/youtube-ingestion/services/merge-video.js";
import { validateProbe } from "../dist/features/youtube-ingestion/services/validate-merged-output.js";
import { mergeArguments, probeArguments } from "../dist/features/youtube-ingestion/utils/ffmpeg-command.js";
import { trackArguments } from "../dist/features/youtube-ingestion/services/downloader-command.js";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createYouTubeIngestion } from "../dist/features/youtube-ingestion/services/ingest-youtube.js";
import { UploadValidationError } from "../dist/features/uploads/utils/validate-video.js";

const reference = parseYouTubeUrl("https://youtu.be/jNQXAC9IVRw");
const video = { format_id: "video-dynamic", ext: "mp4", protocol: "https", vcodec: "avc1.42", acodec: "none", height: 720, fps: 30, filesize: 3, url: "https://r1.googlevideo.com/video" };
const audio = { format_id: "audio-dynamic", ext: "m4a", protocol: "https", vcodec: "none", acodec: "mp4a.40.2", abr: 128, filesize: 3 };
const info = { id: reference.videoId, title: "Teste", duration: 19, formats: [video, audio] };
const selection = selectInput(info);
const bytes = (value) => ({ content: Readable.from([Buffer.from(value)], { objectMode: false }) });
const temp = () => mkdtemp(join(tmpdir(), "clipador-merge-"));
function downloader(dependencies, states = [], validateOutput = async () => {}) {
  return { prepare: async (_ref, _signal, onStatus) => ({ name: "youtube.mp4", type: "video/mp4", estimatedSize: 6, workspace: true,
    source: parseVideoInfo(info, reference).source, validateOutput,
    open: (signal, context) => mergeVideo(reference, selection, context, signal, (status) => { states.push(status); onStatus?.(status); }, undefined, undefined, dependencies) }) };
}
const successful = { download: async () => bytes("abc"), merge: async (directory) => {
  assert.equal((await readFile(join(directory, "track-video.part"))).toString(), "abc");
  assert.equal((await readFile(join(directory, "track-audio.part"))).toString(), "abc");
  return bytes("merged-output");
} };

test("progressivo tem prioridade; fallback seleciona formatos reais sem IDs fixos e limita qualidade", () => {
  assert.equal(selection.mode, "separate"); assert.equal(selection.video.id, video.format_id); assert.equal(selection.audio.id, audio.format_id);
  const progressive = { ...video, acodec: "aac" };
  assert.equal(selectInput({ ...info, formats: [...info.formats, progressive] }).mode, "progressive");
  assert.equal(selectInput({ ...info, formats: [video, { ...video, format_id: "4k", height: 2160 }, audio] }).video.id, video.format_id);
  assert.equal(selectInput({ ...info, formats: [audio, { ...video, height: 1080 }] }).video.height, 1080);
  assert.throws(() => selectInput({ ...info, formats: [video] }), { statusCode: 422 });
  assert.throws(() => selectInput({ ...info, formats: [{ ...video, format_id: "--exec=x" }, audio] }), { statusCode: 502 });
});
test("comandos não fazem reencode, não recebem URL livre e só leem arquivos internos", () => {
  const args = mergeArguments("C:\\controlled");
  assert.equal(args[args.indexOf("-c") + 1], "copy");
  assert.equal(args.at(-1), "pipe:1"); assert.equal(args[args.indexOf("-protocol_whitelist") + 1], "file");
  assert.deepEqual(trackArguments(reference, video.format_id).slice(-2), ["--", reference.url]);
  assert.throws(() => trackArguments(reference, "../../evil"));
  assert.ok(probeArguments("controlled.mp4.part").includes("json"));
});
test("merge persiste somente final, checksum, metadata e recupera ID/origem após reinício", async () => {
  const directory = await temp(); const uploads = createUploadService({ directory }); await uploads.initialize();
  const states = [];
  const service = createYouTubeIngestion(uploads, downloader(successful, states, async (path) => {
    assert.ok(path.endsWith("video.mp4.part")); assert.equal((await readFile(path)).toString(), "merged-output");
  }));
  const result = await service.ingest(reference.url, new AbortController().signal);
  assert.equal(result.statusCode, 200); const id = result.body.ingestion.id;
  assert.deepEqual(states, ["downloading-video", "downloading-audio", "merging"]);
  assert.deepEqual((await readdir(join(directory, id))).sort(), ["metadata.json", "video.mp4"]);
  const metadata = JSON.parse(await readFile(join(directory, id, "metadata.json"), "utf8"));
  assert.equal(metadata.checksum.value, createHash("sha256").update("merged-output").digest("hex"));
  const restarted = createUploadService({ directory }); await restarted.initialize();
  assert.equal(restarted.findUpload(id).source.url, reference.url);
  assert.deepEqual(restarted.findUpload(id).checksum, metadata.checksum);
});
test("falhas no vídeo, áudio, FFmpeg e validação limpam temporários e liberam vaga/quota", async () => {
  for (const phase of ["video", "audio", "merge", "validation"]) {
    const directory = await temp(); const uploads = createUploadService({ directory, maxConcurrentUploads: 1 }); await uploads.initialize();
    let calls = 0;
    const dependencies = { download: async () => {
      calls++; if ((phase === "video" && calls === 1) || (phase === "audio" && calls === 2)) throw new UploadValidationError(`Falha ${phase}`, 502);
      return bytes("abc");
    }, merge: async () => {
      if (phase === "merge") return { content: Readable.from((async function* () { yield Buffer.from("partial"); throw new UploadValidationError("FFmpeg falhou", 502); })(), { objectMode: false }) };
      return bytes("merged-output");
    } };
    const service = createYouTubeIngestion(uploads, downloader(dependencies, [], async () => {
      if (phase === "validation") throw new UploadValidationError("Saída inválida", 502);
    }));
    const result = await service.ingest(reference.url, new AbortController().signal);
    assert.equal(result.statusCode, 502); const id = result.body.ingestion.id;
    assert.equal(uploads.findUpload(id), undefined); assert.deepEqual(await readdir(join(directory, id)), []);
    assert.equal((await uploads.receiveVideo(Readable.from([Buffer.from("ok")]), "local.mp4", "video/mp4")).status, "uploaded");
  }
});
test("quota conta faixas mais saída final, não apenas o arquivo publicado", async () => {
  const directory = await temp(); const uploads = createUploadService({ directory, quotaBytes: 1200 }); await uploads.initialize();
  const service = createYouTubeIngestion(uploads, downloader({ download: async () => bytes(Buffer.alloc(300)), merge: async () => bytes(Buffer.alloc(700)) }));
  const result = await service.ingest(reference.url, new AbortController().signal);
  assert.equal(result.statusCode, 507); assert.deepEqual(await readdir(join(directory, result.body.ingestion.id)), []);
  assert.equal(uploads.findUpload(result.body.ingestion.id), undefined);
});
test("timeout e cancelamento no merge limpam as duas faixas e liberam recursos", async () => {
  for (const timeout of [true, false]) {
    const directory = await temp(); const uploads = createUploadService({ directory, uploadTimeoutMs: timeout ? 50 : 5000 }); await uploads.initialize();
    let reached; const merging = new Promise((resolve) => { reached = resolve; });
    const service = createYouTubeIngestion(uploads, downloader({ ...successful, merge: async () => {
      const content = new Readable({ read() {} }); content.push(Buffer.from("partial")); reached();
      return { content, dispose: () => { content.destroy(); } };
    } }));
    const abort = new AbortController(); const pending = service.ingest(reference.url, abort.signal);
    if (!timeout) { await merging; abort.abort(); }
    const result = await pending;
    assert.equal(result.body.ingestion.status, "failed"); if (timeout) assert.equal(result.statusCode, 408);
    assert.deepEqual(await readdir(join(directory, result.body.ingestion.id)), []);
    assert.equal((await uploads.receiveVideo(Readable.from([Buffer.from("ok")]), "local.mp4", "video/mp4")).status, "uploaded");
  }
});
test("FFprobe recusa perda de faixa, codec errado, tamanho ou duração divergente", () => {
  const valid = { streams: [{ codec_type: "video", codec_name: "h264" }, { codec_type: "audio", codec_name: "aac" }], format: { size: "100", duration: "19" } };
  validateProbe(valid, 100, 19);
  for (const value of [{ ...valid, streams: valid.streams.slice(0, 1) }, { ...valid, format: { size: "100", duration: "2" } },
    { ...valid, format: { size: "101", duration: "19" } }, { ...valid, streams: [{ codec_type: "video", codec_name: "vp9" }, valid.streams[1]] }]) {
    assert.throws(() => validateProbe(value, 100, 19), { statusCode: 502 });
  }
});
test("faixas órfãs após crash contam quota, não entram no índice e expiram pela retenção", async () => {
  const directory = await temp(); const id = randomUUID(); await mkdir(join(directory, id));
  await writeFile(join(directory, id, "track-video.part"), Buffer.alloc(900));
  let now = Date.now();
  const uploads = createUploadService({ directory, retentionMs: 1000, quotaBytes: 1200, now: () => now }); await uploads.initialize();
  assert.equal(uploads.findUpload(id), undefined);
  await assert.rejects(uploads.receiveVideo(Readable.from([Buffer.alloc(200)]), "local.mp4", "video/mp4", undefined, 200), { statusCode: 507 });
  now += 5000; await uploads.cleanup(); assert.deepEqual(await readdir(directory), []);
});
