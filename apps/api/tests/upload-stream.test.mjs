import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, lstat, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createServer } from "../dist/server/create-server.js";
import { writeVideoStream } from "../dist/features/uploads/services/write-video-stream.js";
import { UPLOAD_MAX_FILE_BYTES, resolveUploadLimits } from "../../../config/upload-limits.mjs";
const { sizeError: UPLOAD_SIZE_ERROR } = resolveUploadLimits();

const temporary = () => mkdtemp(join(tmpdir(), "clipador-stream-test-"));
const bytes = (value) => Readable.from([Buffer.from(value)], { objectMode: false });
const digest = (value) => ({ algorithm: "sha256", value: createHash("sha256").update(value).digest("hex") });

async function assertNoCommittedUpload(directory, service) {
  for (const id of await readdir(directory)) {
    assert.deepEqual(await readdir(join(directory, id)), []);
    assert.equal(service.findUpload(id), undefined);
  }
}

test("hash correto no POST, JSON, GET e recuperação após reinício", async (t) => {
  const directory = await temporary();
  const server = createServer({ directory });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4" }, payload: Buffer.from("abc") });
  assert.equal(response.statusCode, 200);
  const result = response.json();
  assert.deepEqual(result.checksum, digest("abc"));
  assert.deepEqual(JSON.parse(await readFile(join(directory, result.id, "metadata.json"), "utf8")).checksum, digest("abc"));
  assert.deepEqual((await server.inject(`/uploads/${result.id}`)).json().upload.checksum, digest("abc"));
  const restarted = createServer({ directory });
  t.after(() => restarted.close());
  assert.deepEqual((await restarted.inject(`/uploads/${result.id}`)).json().upload.checksum, digest("abc"));
});

test("rota aceita stream sem Content-Length e calcula o mesmo hash", async (t) => {
  const directory = await temporary();
  const server = createServer({ directory });
  t.after(() => server.close());
  const response = await server.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4", "transfer-encoding": "chunked" },
    payload: Readable.from([Buffer.from("a"), Buffer.from("b"), Buffer.from("c")], { objectMode: false }) });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().file.size, 3);
  assert.deepEqual(response.json().checksum, digest("abc"));
});

test("grava chunks antes do fim e mantém leitura sob backpressure", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  const chunk = Buffer.alloc(64 * 1024, 42);
  let release;
  let reachedGate;
  const gated = new Promise((resolve) => { reachedGate = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  async function* generate() {
    yield chunk;
    reachedGate();
    await gate;
    for (let i = 1; i < 64; i++) yield chunk;
  }
  const source = Readable.from(generate(), { objectMode: false, highWaterMark: chunk.length });
  const receiving = service.receiveVideo(source, "video.mp4", "video/mp4");
  await gated;
  const [id] = await readdir(directory);
  const partial = join(directory, id, "video.mp4.part");
  for (let i = 0; i < 100 && (await lstat(partial)).size === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal((await lstat(partial)).size, chunk.length, "o primeiro chunk já chegou ao disco antes do fim da fonte");
  assert.ok(source.readableLength <= chunk.length);
  release();
  const result = await receiving;
  const expectedHash = createHash("sha256");
  for (let i = 0; i < 64; i++) expectedHash.update(chunk);
  assert.equal(result.file.size, chunk.length * 64);
  assert.equal(result.checksum.value, expectedHash.digest("hex"));
  assert.equal((await readdir(join(directory, result.id))).some((name) => name.endsWith(".part")), false);
});

test("vazio sem Content-Length remove parcial e não publica checksum", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  await assert.rejects(service.receiveVideo(Readable.from([]), "empty.mp4", "video/mp4"), /vazio/);
  await assertNoCommittedUpload(directory, service);
});

test("erro da fonte e cancelamento removem apenas parcial da operação", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  const valid = await service.receiveVideo(bytes("preserve"), "video.mp4", "video/mp4");
  async function* interrupted() {
    yield Buffer.from("partial");
    throw new Error("Conexão interrompida");
  }
  await assert.rejects(service.receiveVideo(Readable.from(interrupted()), "video.mp4", "video/mp4"), /interrompida/);
  let started;
  const reading = new Promise((resolve) => { started = resolve; });
  const waiting = new Readable({ read() { this.push(Buffer.from("partial")); started(); this._read = () => {}; } });
  const abort = new AbortController();
  const receive = service.receiveVideo(waiting, "video.mp4", "video/mp4", abort.signal);
  await reading;
  abort.abort();
  await assert.rejects(receive);
  assert.equal((await readFile(join(directory, valid.id, "video.mp4"))).toString(), "preserve");
  for (const id of await readdir(directory)) {
    if (id === valid.id) continue;
    assert.deepEqual(await readdir(join(directory, id)), []);
    assert.equal(service.findUpload(id), undefined);
  }
});

test("4 GiB é imposto durante o stream, sem Content-Length; parcial é removido", async (t) => {
  const directory = await temporary();
  const service = createUploadService({ directory, quotaBytes: UPLOAD_MAX_FILE_BYTES * 2 });
  await service.initialize();
  // Escrita simulada evita ocupar 4 GiB em disco, mantendo contagem, hash e limpeza reais.
  const probe = await open(join(directory, "probe"), "wx");
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  // A sentinela está fora dos diretórios UUID e não deve ser removida pelo storage.
  t.mock.method(prototype, "write", async (_chunk, _offset, length) => ({ bytesWritten: length }));
  const chunk = Buffer.alloc(1024 * 1024);
  let emitted = 0;
  async function* oversized() {
    for (let size = 0; size < UPLOAD_MAX_FILE_BYTES; size += chunk.length) { emitted++; yield chunk; }
    emitted++; yield Buffer.alloc(1);
  }
  const source = Readable.from(oversized(), { objectMode: false, highWaterMark: chunk.length });
  await assert.rejects(service.receiveVideo(source, "video.mp4", "video/mp4"),
    { statusCode: 413, message: UPLOAD_SIZE_ERROR });
  source.destroy();
  assert.ok(emitted <= UPLOAD_MAX_FILE_BYTES / chunk.length + 1);
  for (const id of await readdir(directory)) {
    if (id === "probe") continue;
    assert.deepEqual(await readdir(join(directory, id)), []);
    assert.equal(service.findUpload(id), undefined);
  }
  assert.equal((await lstat(join(directory, "probe"))).size, 0);
});

test("stream de exatamente 4 GiB conclui com checksum sem Buffer integral", async () => {
  const chunk = Buffer.alloc(1024 * 1024, 42);
  const expected = createHash("sha256");
  let written = 0;
  let synced = false;
  async function* generate() {
    for (let size = 0; size < UPLOAD_MAX_FILE_BYTES; size += chunk.length) {
      expected.update(chunk); yield chunk;
    }
  }
  const file = { async write(_chunk, _offset, length) { written += length; return { bytesWritten: length }; },
    async sync() { synced = true; } };
  const source = Readable.from(generate(), { objectMode: false, highWaterMark: chunk.length });
  const result = await writeVideoStream(source, file, UPLOAD_MAX_FILE_BYTES, new AbortController().signal);
  assert.equal(result.size, UPLOAD_MAX_FILE_BYTES);
  assert.equal(written, UPLOAD_MAX_FILE_BYTES);
  assert.equal(synced, true);
  assert.deepEqual(result.checksum, { algorithm: "sha256", value: expected.digest("hex") });
});

test("quota excedida durante stream desconhecido não deixa parcial", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory, quotaBytes: 1000 });
  await service.initialize();
  const source = Readable.from([Buffer.alloc(300), Buffer.alloc(600)], { objectMode: false });
  await assert.rejects(service.receiveVideo(source, "video.mp4", "video/mp4"), { statusCode: 507 });
  source.destroy();
  await assertNoCommittedUpload(directory, service);
});

test("tamanho declarado divergente impede commit", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  await assert.rejects(service.receiveVideo(bytes("abc"), "video.mp4", "video/mp4", new AbortController().signal, 4), /tamanho recebido/);
  await assertNoCommittedUpload(directory, service);
});

test("falha de escrita não produz checksum completo e gravações curtas são tratadas", async () => {
  let written = "";
  const shortFile = {
    async write(chunk, offset) { written += chunk.subarray(offset, offset + 1).toString(); return { bytesWritten: 1 }; },
    async sync() {},
  };
  const result = await writeVideoStream(bytes("abc"), shortFile, 1000, new AbortController().signal);
  assert.equal(written, "abc");
  assert.deepEqual(result.checksum, digest("abc"));
  const failedFile = { async write() { throw new Error("EIO: disk failure"); }, async sync() { assert.fail("não sincronizar após falha"); } };
  await assert.rejects(writeVideoStream(bytes("abc"), failedFile, 1000, new AbortController().signal), /EIO/);
});

test("falha de filesystem durante sync remove parcial e não registra upload", async (t) => {
  const parent = await temporary();
  const handle = await open(join(parent, "probe"), "wx");
  const prototype = Object.getPrototypeOf(handle);
  await handle.close();
  t.mock.method(prototype, "sync", async () => { throw new Error("EIO: sync failure"); });
  const directory = join(parent, "uploads");
  const service = createUploadService({ directory });
  await service.initialize();
  await assert.rejects(service.receiveVideo(bytes("abc"), "video.mp4", "video/mp4"), /EIO/);
  await assertNoCommittedUpload(directory, service);
});

test("metadados antigos são recuperados sem hash inventado; hash inválido é rejeitado", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  const result = await service.receiveVideo(bytes("abc"), "video.mp4", "video/mp4");
  const path = join(directory, result.id, "metadata.json");
  const metadata = JSON.parse(await readFile(path, "utf8"));
  const { checksum, ...legacy } = metadata;
  await writeFile(path, JSON.stringify(legacy));
  const restored = createUploadService({ directory });
  await restored.initialize();
  assert.equal(restored.findUpload(result.id).checksum, null);
  await writeFile(path, JSON.stringify({ ...metadata, checksum: { algorithm: "sha256", value: "incomplete" } }));
  await restored.cleanup();
  assert.equal(restored.findUpload(result.id), undefined);
});
