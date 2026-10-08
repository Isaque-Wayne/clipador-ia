import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { createServer } from "../dist/server/create-server.js";
import { createTemporaryVideoStorage } from "../dist/features/uploads/services/temporary-video-storage.js";
import { UPLOAD_MAX_FILE_BYTES, resolveUploadLimits } from "../../../config/upload-limits.mjs";
import { validateVideoSize } from "../dist/features/uploads/utils/validate-video.js";
const { sizeError: UPLOAD_SIZE_ERROR } = resolveUploadLimits();

test("upload recebe bytes, valida entradas e preserva rotas existentes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clipador-upload-test-"));
  const server = createServer({ directory });
  t.after(() => server.close());
  const send = (payload, type = "video/mp4", name = "vídeo.mp4", extra = {}) => server.inject({
    method: "POST",
    url: "/uploads/video",
    payload,
    headers: { "content-type": type, "x-file-name": encodeURIComponent(name), ...extra },
  });

  for (const [type, extension] of [["video/mp4", "mp4"], ["video/webm", "webm"], ["video/quicktime", "mov"]]) {
    const bytes = Buffer.from([0, 255, 42, 10]);
    const response = await send(bytes, type, `vídeo.${extension}`);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().file, { name: `video.${extension}`, size: bytes.length, type });
    assert.equal(response.json().success, true);
    const metadata = response.json();
    assert.equal(metadata.status, "uploaded");
    assert.equal(metadata.nextStep, "processing");
    assert.ok(Number.isFinite(Date.parse(metadata.createdAt)));
    assert.deepEqual(await readFile(join(directory, metadata.id, `video.${extension}`)), bytes);
    const queried = await server.inject(`/uploads/${metadata.id}`);
    assert.equal(queried.statusCode, 200);
    assert.equal(queried.headers["cache-control"], "no-store");
    assert.deepEqual(queried.json().upload, { id: metadata.id, file: metadata.file,
      status: metadata.status, nextStep: metadata.nextStep, createdAt: metadata.createdAt, extension: metadata.extension,
      checksum: metadata.checksum });
  }
  for (const [payload, type, name, status] of [
    [Buffer.alloc(0), "video/mp4", "empty.mp4", 400],
    [Buffer.from("text"), "text/plain", "text.txt", 415],
    [Buffer.from("text"), "video/mp4", "text.webm", 415],
    [Buffer.from("text"), "video/mp4", "../video.mp4", 400],
    [Buffer.from("text"), "video/mp4", "C:\\video.mp4", 400],
    [Buffer.from("text"), "video/mp4", "bad\u0000.mp4", 400],
    [Buffer.from("text"), "video/mp4", "a".repeat(256) + ".mp4", 400],
  ]) {
    const response = await send(payload, type, name);
    assert.equal(response.statusCode, status);
    assert.equal(response.json().success, false);
    assert.equal(typeof response.json().message, "string");
  }
  const missingName = await server.inject({ method: "POST", url: "/uploads/video",
    headers: { "content-type": "video/mp4" }, payload: Buffer.from("video") });
  assert.equal(missingName.statusCode, 400);
  const invalidName = await send(Buffer.from("video"), "video/mp4", "video.mp4", { "x-file-name": "%ZZ" });
  assert.equal(invalidName.statusCode, 400);
  assert.equal((await readdir(directory)).length, 3, "entradas inválidas não criam arquivos");
  const duplicate = await Promise.all([send(Buffer.from("first")), send(Buffer.from("second"))]);
  const [first, second] = duplicate.map((response) => response.json());
  assert.notEqual(first.id, second.id);
  assert.equal((await readFile(join(directory, first.id, "video.mp4"))).toString(), "first");
  assert.equal((await readFile(join(directory, second.id, "video.mp4"))).toString(), "second");
  const malicious = await send(Buffer.from("video"), "video/mp4", "..CON:<>?.mp4");
  assert.equal(malicious.statusCode, 200);
  assert.match(malicious.json().file.name, /^[a-zA-Z0-9_-]+\.mp4$/);
  const reserved = await send(Buffer.from("video"), "video/mp4", "CON.mp4");
  assert.equal(reserved.json().file.name, "video_CON.mp4");
  assert.equal((await server.inject("/uploads/not-an-id")).statusCode, 400);
  assert.equal((await server.inject(`/uploads/${randomUUID()}`)).statusCode, 404);
  const restarted = createServer({ directory });
  t.after(() => restarted.close());
  assert.equal((await restarted.inject(`/uploads/${first.id}`)).statusCode, 200);
  const oversized = await send(Buffer.from("v"), "video/mp4", "video.mp4",
    { "content-length": String(UPLOAD_MAX_FILE_BYTES + 1) });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.json().success, false);
  assert.equal(oversized.json().message, UPLOAD_SIZE_ERROR);
  assert.equal((await server.inject("/health")).json().status, "ok");
  assert.equal((await server.inject("/about")).statusCode, 200);
});

test("limite central aceita exatamente 4 GiB e rejeita um byte adicional", () => {
  assert.equal(UPLOAD_MAX_FILE_BYTES, 4 * 1024 ** 3);
  assert.doesNotThrow(() => validateVideoSize(UPLOAD_MAX_FILE_BYTES));
  assert.throws(() => validateVideoSize(UPLOAD_MAX_FILE_BYTES + 1),
    { statusCode: 413, message: UPLOAD_SIZE_ERROR });
});

test("storage exclusivo preserva arquivo existente mesmo em colisão de ID", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clipador-storage-test-"));
  const id = randomUUID();
  const storage = createTemporaryVideoStorage(directory);
  const metadata = { id, file: { name: "video.mp4", type: "video/mp4", size: 8 },
    extension: ".mp4", status: "uploaded", nextStep: "processing", createdAt: new Date().toISOString(), checksum: null };
  await storage.save(Readable.from([Buffer.from("original")]), metadata, 1000, new AbortController().signal);
  await assert.rejects(storage.save(Readable.from([Buffer.from("replacement")]), metadata, 1000, new AbortController().signal), { code: "EEXIST" });
  assert.equal((await readFile(join(directory, id, "video.mp4"))).toString(), "original");
  assert.deepEqual(await readdir(join(directory, id)), ["metadata.json", "video.mp4"]);
});

test("filesystem inválido impede inicialização sem modificar arquivo existente", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "clipador-failure-test-"));
  const blocked = join(directory, "not-a-directory");
  await writeFile(blocked, "preserve", { flag: "wx" });
  const server = createServer({ directory: blocked });
  t.after(() => server.close());
  await assert.rejects(server.ready());
  assert.equal((await readFile(blocked)).toString(), "preserve");
});
