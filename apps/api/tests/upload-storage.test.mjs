import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, symlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createServer } from "../dist/server/create-server.js";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createTemporaryVideoStorage } from "../dist/features/uploads/services/temporary-video-storage.js";

const temporary = () => mkdtemp(join(tmpdir(), "clipador-retention-test-"));
const bytes = (value) => Readable.from([Buffer.from(value)]);

test("metadados persistentes recuperam índice e não publicam propriedades locais", async () => {
  const directory = await temporary();
  const first = createUploadService({ directory });
  await first.initialize();
  const result = await first.receiveVideo(bytes("video"), "Vídeo teste.mp4", "video/mp4");
  const metadataPath = join(directory, result.id, "metadata.json");
  const stored = JSON.parse(await readFile(metadataPath, "utf8"));
  assert.equal(stored.id, result.id);
  assert.equal(stored.file.name, "Video_teste.mp4");
  assert.equal(stored.file.type, "video/mp4");
  assert.equal(stored.file.size, 5);
  assert.equal(stored.extension, ".mp4");
  assert.equal(stored.status, "uploaded");
  assert.equal(stored.createdAt, result.createdAt);
  assert.deepEqual(await readdir(join(directory, result.id)), ["metadata.json", "video.mp4"]);
  await writeFile(metadataPath, JSON.stringify({ ...stored, internalPath: "secret", file: { ...stored.file, path: "secret" } }));
  const restarted = createUploadService({ directory });
  await restarted.initialize();
  assert.deepEqual(restarted.findUpload(result.id), stored);
});

test("expiração deixa de consultar imediatamente e limpeza libera quota", async () => {
  const directory = await temporary();
  let now = Date.now();
  const service = createUploadService({ directory, now: () => now, retentionMs: 1000, quotaBytes: 1000 });
  await service.initialize();
  const result = await service.receiveVideo(bytes("video"), "video.mp4", "video/mp4");
  now += 1000;
  assert.equal(service.findUpload(result.id), undefined);
  await service.cleanup();
  assert.deepEqual(await readdir(directory), []);
  assert.equal((await service.receiveVideo(bytes("new"), "new.mp4", "video/mp4")).success, true);
});

test("quota conta vídeo e JSON e coordena reservas de envios simultâneos", async (t) => {
  const directory = await temporary();
  const server = createServer({ directory, quotaBytes: 650 });
  t.after(() => server.close());
  const send = () => server.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4" }, payload: Buffer.alloc(150) });
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 507]);
  const error = results.find((result) => result.statusCode === 507).json();
  assert.equal(error.success, false);
  assert.match(error.message, /Armazenamento de vídeos cheio/);
  assert.equal(error.code, "UPLOAD_STORAGE_QUOTA");
  assert.equal((await readdir(directory)).length, 1);
  const restarted = createServer({ directory, quotaBytes: 650 });
  t.after(() => restarted.close());
  const rejected = await restarted.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4" }, payload: Buffer.alloc(150) });
  assert.equal(rejected.statusCode, 507);
});

test("parciais e vídeos sem commit não entram no índice; antigos são limpos", async () => {
  const directory = await temporary();
  const id = randomUUID();
  const folder = join(directory, id);
  await mkdir(folder);
  await writeFile(join(folder, "video.mp4.part"), "unfinished");
  await writeFile(join(folder, "video.mp4"), "without-metadata");
  const service = createUploadService({ directory, retentionMs: 1000 });
  await service.initialize();
  assert.equal(service.findUpload(id), undefined);
  assert.equal((await readdir(directory)).length, 1);
  const old = new Date(Date.now() - 5000);
  await utimes(join(folder, "video.mp4.part"), old, old);
  await utimes(join(folder, "video.mp4"), old, old);
  await utimes(folder, old, old);
  await service.cleanup();
  assert.deepEqual(await readdir(directory), []);
});

test("limpeza periódica funciona sem novo upload e encerra com a API", async (t) => {
  const directory = await temporary();
  let now = Date.now();
  const server = createServer({ directory, now: () => now, retentionMs: 1000, cleanupIntervalMs: 20 });
  t.after(() => server.close());
  const result = await server.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4" }, payload: Buffer.from("v") });
  now += 1000;
  assert.equal((await server.inject(`/uploads/${result.json().id}`)).statusCode, 404);
  for (let attempt = 0; attempt < 50 && (await readdir(directory)).length; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual(await readdir(directory), []);
});

test("metadados malformados, tamanho divergente e caminho malicioso não são recuperados", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  const result = await service.receiveVideo(bytes("video"), "video.mp4", "video/mp4");
  const path = join(directory, result.id, "metadata.json");
  const original = JSON.parse(await readFile(path, "utf8"));
  for (const altered of ["{broken", JSON.stringify({ ...original, extension: "../../outside" }),
    JSON.stringify({ ...original, file: { ...original.file, size: 999 } })]) {
    await writeFile(path, altered);
    const restarted = createUploadService({ directory });
    await restarted.initialize();
    assert.equal(restarted.findUpload(result.id), undefined);
  }
});

test("caminhos externos e links não podem ser gravados ou limpos", async () => {
  const directory = await temporary();
  const outside = await temporary();
  await writeFile(join(outside, "video.mp4"), "preserve");
  const storage = createTemporaryVideoStorage(directory);
  await assert.rejects(storage.save(bytes("bad"), { id: "../outside", file: { type: "video/mp4" } }, 1000, new AbortController().signal));
  await symlink(outside, join(directory, randomUUID()), "junction");
  const service = createUploadService({ directory });
  await assert.rejects(service.initialize(), /Link simbólico/);
  await assert.rejects(service.cleanup(), /Link simbólico/);
  assert.equal((await readFile(join(outside, "video.mp4"))).toString(), "preserve");
  const linkedRoot = join(await temporary(), "root-link");
  await symlink(outside, linkedRoot, "junction");
  await assert.rejects(createUploadService({ directory: linkedRoot }).initialize(), /inseguro/);
});

test("conteúdo desconhecido é contado e preservado na limpeza", async () => {
  const directory = await temporary();
  const folder = join(directory, randomUUID());
  await mkdir(folder);
  await writeFile(join(folder, "important.txt"), Buffer.alloc(1200));
  const old = new Date(Date.now() - 5000);
  await utimes(join(folder, "important.txt"), old, old);
  await utimes(folder, old, old);
  const service = createUploadService({ directory, quotaBytes: 1000, retentionMs: 1000 });
  await service.initialize();
  await assert.rejects(service.receiveVideo(bytes("v"), "video.mp4", "video/mp4"), /cheio/);
  assert.equal((await lstat(join(folder, "important.txt"))).size, 1200);
});
