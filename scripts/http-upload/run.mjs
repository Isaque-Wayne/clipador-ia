import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { upload } from "./http-client.mjs";
import { startApi, stopApi, startWeb } from "./processes.mjs";
import { observeStorage, waitStorage } from "./storage-observation.mjs";
import { resolveUploadLimits } from "../../config/upload-limits.mjs";

const { maxFileBytes: UPLOAD_MAX_FILE_BYTES } = resolveUploadLimits(process.env);

const workspace = resolve(import.meta.dirname, "../..");
const run = join(workspace, "apps/api/.data/http-runs", new Date().toISOString().replace(/[:.]/g, "-"));
const directory = join(run, "uploads");
await mkdir(directory, { recursive: true });
const samples = [];
const results = [];
let api;
let web;
// Quota só do teste: permite atingir a validação de tamanho, independentemente da quota padrão.
const options = { directory, maxConcurrentUploads: 2, uploadTimeoutMs: 90_000,
  quotaBytes: UPLOAD_MAX_FILE_BYTES * 2 };
const source = await readFile(join(workspace, "apps/api/.data/http-flower.mp4"));
const MiB = 1024 * 1024;

function fixture(size) {
  if (size === source.length) return source;
  const free = Buffer.alloc(8);
  free.writeUInt32BE(size - source.length); free.write("free", 4);
  return Buffer.concat([source, free]); // Só o pequeno prefixo; o cliente gera padding por chunk.
}
function checksum(size, prefix) {
  const hash = createHash("sha256");
  hash.update(prefix);
  const chunk = Buffer.alloc(64 * 1024);
  for (let remaining = size - prefix.length; remaining > 0; remaining -= chunk.length) hash.update(chunk.subarray(0, Math.min(remaining, chunk.length)));
  return hash.digest("hex");
}
async function scenario(name, action) {
  const start = Date.now();
  const before = await observeStorage(directory);
  try {
    const detail = await action();
    const after = await observeStorage(directory);
    const measurements = samples.filter((sample) => sample.at >= start);
    const memory = measurements.length ? { rssMin: Math.min(...measurements.map((s) => s.rss)), rssMax: Math.max(...measurements.map((s) => s.rss)),
      arrayBuffersMax: Math.max(...measurements.map((s) => s.arrayBuffers)), externalMax: Math.max(...measurements.map((s) => s.external)) } : null;
    results.push({ name, pass: true, elapsedMs: Date.now() - start, diskBefore: before.bytes, diskAfter: after.bytes, memory, detail });
    console.log(JSON.stringify(results.at(-1)));
  } catch (error) {
    results.push({ name, pass: false, error: error.stack, elapsedMs: Date.now() - start });
    console.log(JSON.stringify(results.at(-1)));
  }
}
const send = (size, extra = {}) => upload({ size, prefix: fixture(size), ...extra });
async function launchApi() { api = startApi(workspace, options, join(run, "api.log"), samples); await api.ready; }

try {
  await launchApi();
  web = await startWeb(workspace, join(run, "web.log"));
  console.log(`HTTP_RUN ${run}`);
  let valid;
  await scenario("MP4 válido + GET + metadata", async () => {
    valid = await send(source.length).result;
    assert.equal(valid.status, 200);
    assert.equal(valid.data.checksum.value, checksum(source.length, source));
    const queried = await fetch(`http://127.0.0.1:3010/api/uploads/${valid.data.id}`).then((r) => r.json());
    assert.equal(queried.upload.checksum.value, valid.data.checksum.value);
    assert.equal((await observeStorage(directory)).partials.length, 0);
    return valid;
  });
  await scenario("MIME e extensão inválidos", async () => {
    const result = await upload({ size: 3, type: "text/plain", name: "invalid.txt" }).result;
    assert.equal(result.status, 415); return result;
  });
  await scenario("arquivo vazio", async () => {
    const result = await upload({ size: 0 }).result;
    assert.equal(result.status, 400); return result;
  });
  await scenario("próximo do limite / um upload", async () => {
    const size = UPLOAD_MAX_FILE_BYTES - 0.5 * MiB;
    const result = await send(size).result;
    assert.equal(result.status, 200);
    assert.equal(result.data.checksum.value, checksum(size, fixture(size)));
    return result;
  });
  await scenario("acima do limite com Content-Length", async () => {
    const result = await send(UPLOAD_MAX_FILE_BYTES + 1).result;
    assert.equal(result.status, 413); return result;
  });
  await scenario("acima do limite chunked", async () => {
    const result = await send(UPLOAD_MAX_FILE_BYTES + 1, { contentLength: false }).result;
    assert.equal(result.status, 413);
    await waitStorage(directory, (s) => s.partials.length === 0); return result;
  });
  await scenario("reinício recupera ID e SHA-256", async () => {
    await stopApi(api.child); await launchApi();
    const response = await fetch(`http://127.0.0.1:3010/api/uploads/${valid.data.id}`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).upload.checksum.value, valid.data.checksum.value);
    return { id: valid.data.id, checksum: valid.data.checksum };
  });
  await scenario("dois streams ativos, terceiro 429, liberação", async () => {
    const one = send(48 * MiB, { pauseAfter: MiB, delayMs: 10 });
    const two = send(48 * MiB, { pauseAfter: MiB, delayMs: 10 });
    await waitStorage(directory, (s) => s.partials.length === 2);
    const third = await send(source.length).result;
    one.release(); two.release();
    assert.equal(third.status, 429);
    const completed = await Promise.all([one.result, two.result]);
    assert.deepEqual(completed.map((r) => r.status), [200, 200]);
    for (const result of completed) assert.equal(result.data.checksum.value, checksum(48 * MiB, fixture(48 * MiB)));
    assert.equal((await send(source.length).result).status, 200);
    assert.equal((await observeStorage(directory)).partials.length, 0);
    return { third, completed };
  });
  await scenario("cliente desconecta no meio / proxy cancela API", async () => {
    const before = await observeStorage(directory);
    const pending = send(49.5 * MiB, { pauseAfter: MiB, delayMs: 10 });
    const active = await waitStorage(directory, (s) => s.partials.length === 1);
    const id = active.partials[0].id;
    pending.abort(); await pending.result;
    await waitStorage(directory, (s) => s.partials.length === 0, 10_000);
    const after = await observeStorage(directory);
    assert.equal(after.uploads.length, before.uploads.length);
    assert.equal(after.bytes, before.bytes);
    assert.equal((await fetch(`http://127.0.0.1:3010/api/uploads/${id}`)).status, 404);
    assert.equal((await send(source.length).result).status, 200);
    return { id, before: before.bytes, after: after.bytes };
  });
  await scenario("timeout real de 90 segundos e liberação", async () => {
    const before = await observeStorage(directory);
    const pending = send(49.5 * MiB, { pauseAfter: MiB, delayMs: 10 });
    const result = await pending.result;
    assert.equal(result.status, 408);
    assert.ok(result.elapsedMs >= 89_000 && result.elapsedMs < 100_000);
    await waitStorage(directory, (s) => s.partials.length === 0);
    const after = await observeStorage(directory);
    assert.equal(after.bytes, before.bytes);
    assert.equal(after.uploads.length, before.uploads.length);
    assert.equal((await send(source.length).result).status, 200);
    return result;
  });
  await scenario("quota HTTP após recuperação, sem arquivo extra", async () => {
    await stopApi(api.child);
    const snapshot = await observeStorage(directory);
    options.quotaBytes = snapshot.bytes + 100;
    await launchApi();
    const result = await send(source.length).result;
    assert.equal(result.status, 507);
    assert.equal((await observeStorage(directory)).bytes, snapshot.bytes);
    return result;
  });
} finally {
  if (api?.child.exitCode === null) await stopApi(api.child);
  web?.kill();
  await writeFile(join(run, "results.json"), JSON.stringify({ runtime: process.version, sourceBytes: source.length, results, samples }, null, 2));
  console.log(`RESULTS ${join(run, "results.json")}`);
}
process.exitCode = results.some((r) => !r.pass) ? 1 : 0;

