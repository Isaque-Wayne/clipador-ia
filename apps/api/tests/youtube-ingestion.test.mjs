import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createServer } from "../dist/server/create-server.js";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createYouTubeIngestion } from "../dist/features/youtube-ingestion/services/ingest-youtube.js";
import { UploadValidationError } from "../dist/features/uploads/utils/validate-video.js";
import { UPLOAD_MAX_FILE_BYTES } from "../../../config/upload-limits.mjs";

const url = "https://youtu.be/BaW_jenozKc";
const temporary = () => mkdtemp(join(tmpdir(), "clipador-youtube-test-"));
function prepared(reference, payload = "abc") {
  return { name: `youtube_${reference.videoId}.mp4`, type: "video/mp4", estimatedSize: Buffer.byteLength(payload),
    source: { provider: "youtube", ...reference, title: "Teste público", durationSeconds: 10,
      thumbnailUrl: `https://i.ytimg.com/vi/${reference.videoId}/hqdefault.jpg` },
    open: async () => ({ content: Readable.from([Buffer.from(payload)], { objectMode: false }) }) };
}
const downloader = { prepare: async (reference) => prepared(reference) };
const post = (server, value = url) => server.inject({ method: "POST", url: "/ingestions/youtube", payload: { url: value } });
const local = (server) => server.inject({ method: "POST", url: "/uploads/video", payload: Buffer.from("local"),
  headers: { "content-type": "video/mp4", "x-file-name": "local.mp4" } });

test("HTTP de ingestão persiste no storage comum, calcula hash e recupera origem após reinício", async (t) => {
  const directory = await temporary();
  const server = createServer({ directory }, { downloader });
  t.after(() => server.close());
  const response = await post(server);
  assert.equal(response.statusCode, 200);
  const ingestion = response.json().ingestion;
  assert.equal(ingestion.status, "downloaded");
  assert.equal(ingestion.id, ingestion.upload.id);
  assert.equal(ingestion.upload.status, "uploaded");
  assert.equal(ingestion.upload.checksum.value, createHash("sha256").update("abc").digest("hex"));
  assert.equal((await readFile(join(directory, ingestion.id, "video.mp4"))).toString(), "abc");
  const json = JSON.parse(await readFile(join(directory, ingestion.id, "metadata.json"), "utf8"));
  assert.equal(json.source.title, "Teste público");
  assert.equal(json.source.url, "https://www.youtube.com/watch?v=BaW_jenozKc");
  assert.deepEqual(json.checksum, ingestion.upload.checksum);
  await server.close();
  const restarted = createServer({ directory }, { downloader });
  t.after(() => restarted.close());
  const queried = await restarted.inject(`/ingestions/${ingestion.id}`);
  assert.equal(queried.statusCode, 200);
  assert.equal(queried.json().ingestion.video.title, "Teste público");
  assert.deepEqual(queried.json().ingestion.upload.checksum, json.checksum);
  assert.equal((await restarted.inject(`/uploads/${ingestion.id}`)).json().upload.source.provider, "youtube");
  assert.equal((await local(restarted)).statusCode, 200);
});
test("URL recusada não chama downloader nem cria arquivo", async (t) => {
  const directory = await temporary(); let calls = 0;
  const server = createServer({ directory }, { downloader: { prepare: async () => { calls++; throw new Error("unexpected"); } } });
  t.after(() => server.close());
  assert.equal((await post(server, "https://youtube.com.evil.test/watch?v=BaW_jenozKc")).statusCode, 400);
  assert.equal(calls, 0); assert.deepEqual(await readdir(directory), []);
});
test("vídeo indisponível e erro de downloader retornam falha clara com ID consultável", async (t) => {
  for (const error of [new UploadValidationError("Vídeo indisponível, privado ou restrito no YouTube.", 422), new Error("downloader failure")]) {
    const directory = await temporary();
    const server = createServer({ directory }, { downloader: { prepare: async () => { throw error; } } });
    t.after(() => server.close());
    const response = await post(server);
    assert.equal(response.statusCode, error instanceof UploadValidationError ? 422 : 502);
    const result = response.json(); assert.equal(result.ingestion.status, "failed");
    assert.equal((await server.inject(`/ingestions/${result.ingestion.id}`)).json().ingestion.status, "failed");
    assert.deepEqual(await readdir(directory), []);
    assert.equal((await local(server)).statusCode, 200);
  }
});
test("estimativa excedida impede download; quota comum também bloqueia antes de abrir mídia", async (t) => {
  for (const quota of [undefined, 100]) {
    const directory = await temporary(); let opened = false;
    const server = createServer({ directory, ...(quota ? { quotaBytes: quota } : {}) }, { downloader: {
      prepare: async (reference) => ({ ...prepared(reference), estimatedSize: quota ? 3 : UPLOAD_MAX_FILE_BYTES + 1,
        open: async () => { opened = true; return { content: Readable.from([Buffer.from("abc")]) }; } }),
    } });
    t.after(() => server.close());
    const response = await post(server);
    assert.equal(response.statusCode, quota ? 507 : 413);
    assert.equal(opened, false); assert.deepEqual(await readdir(directory), []);
  }
});
test("erro durante download remove parcial, não cria metadados e libera quota", async (t) => {
  const directory = await temporary();
  const server = createServer({ directory, quotaBytes: 1200 }, { downloader: { prepare: async (reference) => ({ ...prepared(reference),
    open: async () => ({ content: Readable.from((async function* () { yield Buffer.from("a"); throw new Error("download interrupted"); })(), { objectMode: false }) }),
  }) } });
  t.after(() => server.close());
  const response = await post(server); assert.equal(response.statusCode, 502);
  const id = response.json().ingestion.id;
  assert.deepEqual(await readdir(join(directory, id)), []);
  assert.equal((await server.inject(`/uploads/${id}`)).statusCode, 404);
  assert.equal((await local(server)).statusCode, 200);
});
test("YouTube e upload local compartilham concorrência, incluindo busca de metadata", async (t) => {
  const directory = await temporary(); let release; let reached;
  const started = new Promise((resolve) => { reached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const server = createServer({ directory, maxConcurrentUploads: 1 }, { downloader: { prepare: async (reference) => {
    reached(); await gate; return prepared(reference);
  } } });
  t.after(() => server.close());
  const first = post(server); await started;
  assert.equal((await local(server)).statusCode, 429);
  assert.equal((await server.inject({ method: "POST", url: "/uploads/video", payload: Buffer.from("v"),
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4", "content-length": String(UPLOAD_MAX_FILE_BYTES + 1) } })).statusCode, 413);
  assert.equal((await post(server)).statusCode, 429);
  release(); assert.equal((await first).statusCode, 200);
  assert.equal((await local(server)).statusCode, 200);
});
test("timeout de metadata e cancelamento liberam a mesma vaga do upload local", async () => {
  const directory = await temporary();
  const uploads = createUploadService({ directory, maxConcurrentUploads: 1, uploadTimeoutMs: 30 });
  await uploads.initialize();
  const service = createYouTubeIngestion(uploads, { prepare: async (_reference, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) });
  const timedOut = await service.ingest(url, new AbortController().signal);
  assert.equal(timedOut.statusCode, 408); assert.equal(timedOut.body.ingestion.status, "failed");
  const abort = new AbortController();
  const interrupted = service.ingest(url, abort.signal); abort.abort();
  assert.equal((await interrupted).body.ingestion.status, "failed");
  const localUpload = await uploads.receiveVideo(Readable.from([Buffer.from("local")]), "video.mp4", "video/mp4");
  assert.equal(localUpload.status, "uploaded");
});
test("retenção limpa ingestão no storage comum; falhas transitórias expiram", async () => {
  const directory = await temporary(); let now = Date.now();
  const uploads = createUploadService({ directory, now: () => now, retentionMs: 100 });
  await uploads.initialize();
  const service = createYouTubeIngestion(uploads, downloader);
  const response = await service.ingest(url, new AbortController().signal);
  const id = response.body.ingestion.id;
  assert.equal(service.find(id).status, "downloaded");
  const failed = createYouTubeIngestion(uploads, { prepare: async () => { throw new Error("unavailable"); } });
  const failure = await failed.ingest(url, new AbortController().signal);
  now += 101;
  await uploads.cleanup();
  assert.equal(service.find(id), undefined);
  assert.equal(failed.find(failure.body.ingestion.id), undefined);
  assert.deepEqual(await readdir(directory), []);
});

test("timeout durante download remove parcial e libera quota e concorrência", async () => {
  const directory = await temporary();
  const uploads = createUploadService({ directory, maxConcurrentUploads: 1, uploadTimeoutMs: 50, quotaBytes: 1200 });
  await uploads.initialize();
  const service = createYouTubeIngestion(uploads, { prepare: async (reference) => ({ ...prepared(reference),
    open: async () => {
      const content = new Readable({ read() {} });
      content.push(Buffer.from("a"));
      return { content, dispose: () => content.destroy() };
    },
  }) });
  const result = await service.ingest(url, new AbortController().signal);
  assert.equal(result.statusCode, 408);
  assert.deepEqual(await readdir(join(directory, result.body.ingestion.id)), []);
  assert.equal(uploads.findUpload(result.body.ingestion.id), undefined);
  const localUpload = await uploads.receiveVideo(Readable.from([Buffer.from("local")]), "video.mp4", "video/mp4");
  assert.equal(localUpload.status, "uploaded");
});
test("origem persistida maliciosa não é recuperada nem exposta", async () => {
  const directory = await temporary();
  const uploads = createUploadService({ directory }); await uploads.initialize();
  const service = createYouTubeIngestion(uploads, downloader);
  const result = await service.ingest(url, new AbortController().signal);
  const path = join(directory, result.body.ingestion.id, "metadata.json");
  const metadata = JSON.parse(await readFile(path, "utf8"));
  metadata.source.thumbnailUrl = "http://127.0.0.1/private";
  await writeFile(path, JSON.stringify(metadata));
  const restored = createUploadService({ directory }); await restored.initialize();
  assert.equal(restored.findUpload(metadata.id), undefined);
});
