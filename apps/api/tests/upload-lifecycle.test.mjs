import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createServer } from "../dist/server/create-server.js";

const temporary = () => mkdtemp(join(tmpdir(), "clipador-lifecycle-test-"));
const bytes = (value) => Readable.from([Buffer.from(value)], { objectMode: false });

function pausedUpload() {
  const source = new Readable({ read() {} });
  source.push(Buffer.from("abc"));
  return { source, finish: () => source.push(null) };
}

async function waitForPartials(directory, count) {
  for (let i = 0; i < 100; i++) {
    const ids = await readdir(directory);
    const folders = await Promise.all(ids.map((id) => readdir(join(directory, id))));
    if (folders.filter((files) => files.includes("video.mp4.part")).length === count) return ids;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("os uploads não começaram a gravar simultaneamente");
}

test("dois uploads gravam ao mesmo tempo; excesso retorna 429 e slot é liberado", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory, maxConcurrentUploads: 2 });
  await service.initialize();
  const first = pausedUpload();
  const second = pausedUpload();
  const one = service.receiveVideo(first.source, "one.mp4", "video/mp4");
  const two = service.receiveVideo(second.source, "two.mp4", "video/mp4");
  await waitForPartials(directory, 2);
  await assert.rejects(service.receiveVideo(bytes("third"), "third.mp4", "video/mp4"), { statusCode: 429 });
  assert.equal((await readdir(directory)).length, 2);
  first.finish(); second.finish();
  const results = await Promise.all([one, two]);
  assert.notEqual(results[0].id, results[1].id);
  assert.equal((await service.receiveVideo(bytes("third"), "third.mp4", "video/mp4")).success, true);
});

test("rota retorna erro claro quando limite de concorrência está ocupado", async (t) => {
  const directory = await temporary();
  const server = createServer({ directory, maxConcurrentUploads: 1 });
  t.after(() => server.close());
  await server.ready();
  const first = pausedUpload();
  const pending = server.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4" }, payload: first.source });
  await waitForPartials(directory, 1);
  const busy = await server.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4" }, payload: Buffer.from("v") });
  assert.equal(busy.statusCode, 429);
  assert.match(busy.json().message, /simultâneos/);
  first.finish();
  assert.equal((await pending).statusCode, 200);
});

test("timeout remove parcial, não registra no índice e libera concorrência", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory, maxConcurrentUploads: 1, uploadTimeoutMs: 100 });
  await service.initialize();
  const paused = pausedUpload();
  const pending = service.receiveVideo(paused.source, "video.mp4", "video/mp4");
  const failed = assert.rejects(pending, { statusCode: 408 });
  const ids = await waitForPartials(directory, 1);
  await failed;
  for (const id of ids) {
    assert.deepEqual(await readdir(join(directory, id)), []);
    assert.equal(service.findUpload(id), undefined);
  }
  paused.source.destroy();
  assert.equal((await service.receiveVideo(bytes("v"), "video.mp4", "video/mp4")).success, true);
});

test("timeout HTTP responde 408 sem destruir o stream antes da resposta", async (t) => {
  const directory = await temporary();
  const server = createServer({ directory, uploadTimeoutMs: 100 });
  t.after(() => server.close());
  const paused = pausedUpload();
  const response = await server.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4", "x-file-name": "video.mp4" }, payload: paused.source });
  assert.equal(response.statusCode, 408);
  assert.match(response.json().message, /Tempo máximo/);
  paused.source.destroy();
});

test("limpeza preserva gravações ativas e quota é compartilhada entre streams", async () => {
  const directory = await temporary();
  let now = Date.now();
  const service = createUploadService({ directory, now: () => now, retentionMs: 1, quotaBytes: 1300, maxConcurrentUploads: 2 });
  await service.initialize();
  const first = pausedUpload();
  const one = service.receiveVideo(first.source, "one.mp4", "video/mp4");
  const ids = await waitForPartials(directory, 1);
  now += 10000;
  await service.cleanup();
  assert.ok((await readdir(join(directory, ids[0]))).includes("video.mp4.part"));
  await assert.rejects(service.receiveVideo(bytes(Buffer.alloc(1000)), "two.mp4", "video/mp4"), { statusCode: 507 });
  first.finish(); await one;
});

test("consumo válido usa o mesmo handle e não altera status automaticamente", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  const result = await service.receiveVideo(bytes("abc"), "video.mp4", "video/mp4");
  const value = await service.consumeUpload(result.id, async ({ file, metadata }) => {
    assert.deepEqual(metadata.checksum, result.checksum);
    return file.readFile("utf8");
  });
  assert.equal(value, "abc");
  assert.equal(service.findUpload(result.id).status, "uploaded");
});

test("vídeo corrompido de mesmo tamanho é bloqueado e persiste failed", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  const result = await service.receiveVideo(bytes("abc"), "video.mp4", "video/mp4");
  await writeFile(join(directory, result.id, "video.mp4"), "xyz");
  let called = false;
  await assert.rejects(service.consumeUpload(result.id, async () => { called = true; }), { statusCode: 409 });
  assert.equal(called, false);
  assert.equal(service.findUpload(result.id).status, "failed");
  assert.equal(JSON.parse(await readFile(join(directory, result.id, "metadata.json"), "utf8")).status, "failed");
  const restarted = createUploadService({ directory });
  await restarted.initialize();
  assert.equal(restarted.findUpload(result.id).status, "failed");
  await assert.rejects(restarted.consumeUpload(result.id, async () => assert.fail()), { statusCode: 409 });
});

test("transições válidas são persistidas e saltos inválidos retornam 409", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  const result = await service.receiveVideo(bytes("abc"), "video.mp4", "video/mp4");
  await assert.rejects(service.transitionUpload(result.id, "completed"), { statusCode: 409 });
  for (const state of ["queued", "processing", "completed"]) {
    assert.equal((await service.transitionUpload(result.id, state)).status, state);
  }
  const restarted = createUploadService({ directory });
  await restarted.initialize();
  assert.equal(restarted.findUpload(result.id).status, "completed");
  await assert.rejects(restarted.transitionUpload(result.id, "queued"), { statusCode: 409 });
  const snapshot = restarted.findUpload(result.id);
  snapshot.status = "failed";
  assert.equal(restarted.findUpload(result.id).status, "completed", "consulta não permite mutar o índice");
});

test("consumo protege arquivo da retenção e bloqueia transição concorrente", async () => {
  const directory = await temporary();
  let now = Date.now();
  const service = createUploadService({ directory, now: () => now, retentionMs: 1000 });
  await service.initialize();
  const result = await service.receiveVideo(bytes("abc"), "video.mp4", "video/mp4");
  await service.consumeUpload(result.id, async ({ file }) => {
    await assert.rejects(service.transitionUpload(result.id, "queued"), { statusCode: 409 });
    now += 1000;
    await service.cleanup();
    assert.equal(await file.readFile("utf8"), "abc");
  });
  await service.cleanup();
  assert.deepEqual(await readdir(directory), []);
});

test("upload legado sem checksum não é consumido nem recebe hash inventado", async () => {
  const directory = await temporary();
  const service = createUploadService({ directory });
  await service.initialize();
  const result = await service.receiveVideo(bytes("abc"), "video.mp4", "video/mp4");
  const path = join(directory, result.id, "metadata.json");
  const metadata = JSON.parse(await readFile(path, "utf8"));
  metadata.checksum = null;
  await writeFile(path, JSON.stringify(metadata));
  const restored = createUploadService({ directory });
  await restored.initialize();
  await assert.rejects(restored.consumeUpload(result.id, async () => assert.fail()), /sem checksum/);
  assert.equal(restored.findUpload(result.id).status, "uploaded");
});

test("configurações inválidas de concorrência e timeout são rejeitadas", () => {
  assert.throws(() => createUploadService({ maxConcurrentUploads: 0 }), /inteiros positivos/);
  assert.throws(() => createUploadService({ uploadTimeoutMs: 0 }), /inteiros positivos/);
  assert.throws(() => createUploadService({ uploadTimeoutMs: 2_147_483_648 }), /Timeout excede/);
});
