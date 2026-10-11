import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat, symlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createClipStorage } from "../dist/features/clip-rendering/services/clip-storage.js";
import { createLibraryService } from "../dist/features/library/services/library-service.js";
import { projectFiles, removeProjectFiles } from "../dist/features/library/services/library-files.js";
import { createServer } from "../dist/server/create-server.js";
import { normalizeTranscript } from "../dist/features/transcription/services/normalize-transcript.js";
import { LocalAnalysisProvider } from "../dist/features/analysis/services/local-provider.js";
import { digest } from "../dist/features/analysis/services/analysis-persistence.js";
import { runRenderProcess } from "../dist/features/clip-rendering/services/render-process.js";
import { mediaTool } from "../dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { clipByteBudget } from "../dist/features/editing/rendering/ffmpeg-plan.js";
import { SOCIAL_ARTIFACT_BUDGET } from "../dist/features/social-packages/generate-package.js";
const bytes = text => Readable.from([Buffer.from(text)]);
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "clipador-library-"));
  const uploads = createUploadService({ directory: join(root, "uploads") }); await uploads.initialize();
  const storage = createClipStorage(join(root, "clips"), 1024 ** 2); await storage.initialize();
  return { root, uploads, storage, library: createLibraryService(uploads, storage) };
}
test("Biblioteca vazia e cálculo de uso", async () => {
  const { library } = await setup(); assert.deepEqual(await library.list(), []);
  const usage = await library.usage(); assert.equal(usage.totalBytes, 0); assert.equal(usage.projectCount, 0); assert.ok(usage.freeDiskBytes > 0);
});
test("projetos persistidos antigos aparecem após reinício sem retenção automática", async () => {
  const { uploads, storage, library, root } = await setup();
  const upload = await uploads.receiveVideo(bytes("video"), "saved.mp4", "video/mp4");
  const metadata = { ...upload }; delete metadata.success; delete metadata.message;
  metadata.createdAt = "2020-01-01T00:00:00.000Z";
  await writeFile(join(root, "uploads", upload.id, "metadata.json"), JSON.stringify(metadata));
  const restored = createUploadService({ directory: join(root, "uploads") }); await restored.initialize();
  const second = createLibraryService(restored, storage);
  assert.equal((await second.list())[0].id, upload.id); assert.equal((await second.get(upload.id)).metadata.createdAt, metadata.createdAt);
  assert.ok(restored.findUpload(upload.id)); assert.equal((await library.usage()).originalBytes, 5);
});
test("temporários não aparecem; incompletos e corrompidos ficam identificados", async () => {
  const { root, library } = await setup();
  const temporary = randomUUID(), broken = randomUUID();
  await mkdir(join(root, "uploads", temporary)); await writeFile(join(root, "uploads", temporary, "video.mp4.part"), "partial");
  await mkdir(join(root, "uploads", broken)); await writeFile(join(root, "uploads", broken, "metadata.json"), "{broken");
  const list = await library.list(); assert.equal(list.length, 1); assert.equal(list[0].id, broken); assert.equal(list[0].status, "failed");
  assert.equal((await library.usage()).temporaryBytes, 7);
});
test("exclusão bloqueia traversal e ID inválido", async () => {
  const { library } = await setup();
  for (const id of ["../outside", "..", "a/b", "C:\\outside", randomUUID() + "/.."]) await assert.rejects(library.remove(id, "project"), { code: "INVALID_ID" });
});
test("projeto ativo e exclusão concorrente são bloqueados", async () => {
  const { uploads, library } = await setup(); const project = await uploads.receiveVideo(bytes("video"), "saved.mp4", "video/mp4");
  const release = uploads.holdProject(project.id);
  await assert.rejects(library.remove(project.id, "project"), /Projeto em uso/); release();
  let started, proceed; const entered = new Promise(resolve => started = resolve), pause = new Promise(resolve => proceed = resolve);
  const operation = uploads.manageProject(project.id, async () => { started(); await pause; });
  await entered; assert.throws(() => uploads.holdProject(project.id), /exclusão/); proceed(); await operation;
  assert.ok(uploads.findUpload(project.id));
});
test("exclusão por ID libera bytes e preserva outro projeto", async () => {
  const { uploads, library, root } = await setup();
  const first = await uploads.receiveVideo(bytes("first"), "first.mp4", "video/mp4"), second = await uploads.receiveVideo(bytes("preserve"), "second.mp4", "video/mp4");
  const before = await library.usage(), expected = (await library.get(first.id)).totalBytes;
  const deleted = await library.remove(first.id, "project"); assert.equal(deleted.freedBytes, expected);
  assert.equal(before.totalBytes - (await library.usage()).totalBytes, expected);
  assert.equal(await readFile(join(root, "uploads", second.id, "video.mp4"), "utf8"), "preserve"); assert.equal(uploads.findUpload(first.id), undefined);
});
test("conteúdo desconhecido impede exclusão antes de remover qualquer arquivo", async () => {
  const { uploads, library, root } = await setup(); const project = await uploads.receiveVideo(bytes("video"), "saved.mp4", "video/mp4");
  await writeFile(join(root, "uploads", project.id, "important.txt"), "preserve");
  await assert.rejects(library.remove(project.id, "project"), { code: "UNSAFE_STORAGE" });
  assert.equal(await readFile(join(root, "uploads", project.id, "video.mp4"), "utf8"), "video");
});
test("junction externo bloqueia exclusão e preserva destino", async () => {
  const { root, library } = await setup(), outside = await mkdtemp(join(tmpdir(), "clipador-library-outside-"));
  await writeFile(join(outside, "metadata.json"), "preserve"); const id = randomUUID();
  await symlink(outside, join(root, "uploads", id), "junction");
  await assert.rejects(library.remove(id, "project"), { code: "UNSAFE_STORAGE" }); assert.equal(await readFile(join(outside, "metadata.json"), "utf8"), "preserve");
});
test("falha parcial informa quantos bytes foram removidos", async () => {
  const { root, uploads } = await setup(); const project = await uploads.receiveVideo(bytes("video"), "saved.mp4", "video/mp4");
  const plan = await projectFiles(await uploads.storageRoot(), project.id, false);
  const metadata = plan.files.find(file => file.name === "metadata.json");
  await writeFile(metadata.path, "changed");
  await assert.rejects(removeProjectFiles([plan]), error => error.code === "DELETE_PARTIAL" && error.details.freedBytes === 5);
  assert.equal(await readFile(metadata.path, "utf8"), "changed");
});

test("fixture nativa: OUTPUT_QUOTA, restart, exclusão, retry só dos pendentes e galeria", { timeout: 120000 }, async () => {
  const root = resolve("apps/api/.data/library-validation", new Date().toISOString().replaceAll(":", "-")); await mkdir(root, { recursive: true });
  const directory = join(root, "uploads"), outputs = join(root, "clips"), signal = new AbortController().signal;
  const ffmpeg = await mediaTool("ffmpeg");
  await runRenderProcess({ executable: ffmpeg, cwd: root, timeoutMs: 15000, args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=navy:s=320x180:r=15:d=6", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libopenh264", "-b:v", "300k", "-c:a", "aac", "-shortest", "fixture.mp4"] }, signal);
  const words = ["Olá,", "este", "é", "um", "corte", "real."];
  const transcript = normalizeTranscript({ language: "pt", duration: 6, segments: [0, 1].map(i => ({ id: i, start: i * 3 + .2, end: i * 3 + 2.8, text: words.join(" "), words: words.map((word, j) => ({ word, start: i * 3 + .2 + j * .4, end: i * 3 + .6 + j * .4 })) })) });
  const template = (await new LocalAnalysisProvider().analyze({ uploadId: randomUUID(), transcript }, signal)).candidates[0]; assert.ok(template);
  const candidates = [0, 1].map(i => ({ ...template, id: `c_${String(i + 1).repeat(16)}`, start: i * 3, end: i * 3 + 3, duration: 3, segmentIds: [i] }));
  const report = { analysisVersion: "library-fixture-1", generatedCount: 2, deduplicatedCount: 0, rejectedCount: 0, candidates };
  const provider = { analysisVersion: report.analysisVersion, async analyze() { return report; } };
  const uploads = createUploadService({ directory }); await uploads.initialize(); const blocker = await uploads.receiveVideo(bytes("quota-blocker"), "fixture-blocker.mp4", "video/mp4");
  const store = createClipStorage(outputs); await store.initialize(); const blockerBatchId = randomUUID(), work = await store.work(blockerBatchId, true), blockerData = Buffer.alloc(1024 ** 2, 1);
  await writeFile(join(work, `${candidates[0].id}.mp4`), blockerData);
  const blockerBatch = { schemaVersion: 1, uploadId: blocker.id, batchId: blockerBatchId, createdAt: new Date().toISOString(), analysisVersion: report.analysisVersion, renderVersion: "fixture", sourceHash: blocker.checksum.value, analysisHash: digest(report), report,
    clips: [{ id: candidates[0].id, file: `${candidates[0].id}.mp4`, start: 0, end: 3, duration: 3, width: 1080, height: 1920, checksum: createHash("sha256").update(blockerData).digest("hex"), size: blockerData.length, status: "completed", candidate: candidates[0], metadata: { videoCodec: "h264", audioCodec: "aac", subtitlesBurned: true, cueCount: 1, layout: "padding", renderSeconds: 0 } }] };
  await store.publish(blockerBatch);
  const blockerSize = (await store.usage()).bytes, quotaBytes = clipByteBudget(3) + 16 * 1024 ** 2 + SOCIAL_ARTIFACT_BUDGET + blockerSize + 1;
  let engineCalls = 0;
  const options = { directory: outputs, analysisProvider: provider, quotaBytes };
  let server = createServer({ directory }, {}, { engine: { async transcribe() { engineCalls++; return transcript; } } }, options); server.log.level = "silent";
  let id, before, partial, oldStat;
  async function wait() { for (let i = 0; i < 600; i++) { const status = (await server.inject(`/uploads/${id}/process/status`)).json().status; if (["failed", "completed"].includes(status.stage)) return status; await new Promise(resolve => setTimeout(resolve, 50)); } assert.fail("Job did not complete"); }
  try {
    const received = await server.inject({ method: "POST", url: "/uploads/video", headers: { "content-type": "video/mp4", "x-file-name": "fixture.mp4" }, payload: await readFile(join(root, "fixture.mp4")) }); id = received.json().id;
    assert.equal((await server.inject({ method: "POST", url: `/uploads/${id}/process` })).statusCode, 202);
    // Default selection retains both disjoint candidates from this fixture.
    const status = await wait(); assert.equal(status.stage, "failed", JSON.stringify(status)); assert.equal(status.error.code, "OUTPUT_QUOTA"); assert.ok(status.error.requiredBytes > 0);
    partial = (await server.inject(`/uploads/${id}/clips`)).json().batch; assert.equal(partial.clips.length, 1); assert.equal(partial.requestedIds.length, 2);
    oldStat = await stat(join(outputs, id, partial.batchId, partial.clips[0].file));
    before = (await server.inject("/storage/usage")).json().usage;
    assert.equal((await server.inject({ method: "DELETE", url: `/projects/${blocker.id}`, payload: {} })).statusCode, 400);
  } finally { await server.close(); }
  server = createServer({ directory }, {}, { engine: { async transcribe() { assert.fail("Should reuse transcript"); } } }, options); server.log.level = "silent";
  try {
    const restored = (await server.inject(`/projects/${id}`)).json().project; assert.equal(restored.clips.length, 1); assert.equal(restored.status, "failed"); assert.equal(restored.error.code, "OUTPUT_QUOTA"); assert.ok(restored.error.requiredBytes > 0);
    const response = await server.inject({ method: "DELETE", url: `/projects/${blocker.id}`, payload: { confirm: true } }); assert.equal(response.statusCode, 200, response.body);
    const after = (await server.inject("/storage/usage")).json().usage;
    assert.equal(before.totalBytes - after.totalBytes, response.json().deletion.freedBytes); assert.ok(response.json().deletion.freedBytes > blockerData.length);
    const retry = await server.inject({ method: "POST", url: `/projects/${id}/retry` }); assert.equal(retry.statusCode, 200, retry.body);
    assert.equal((await server.inject({ method: "DELETE", url: `/projects/${id}`, payload: { confirm: true } })).statusCode, 409);
    const done = await wait(); assert.equal(done.stage, "completed", JSON.stringify(done));
    const final = (await server.inject(`/projects/${id}`)).json().project; assert.equal(final.clips.length, 2); assert.equal(final.clips[0].batchId, partial.batchId);
    const completed = (await server.inject(`/uploads/${id}/clips`)).json().batch;
    assert.deepEqual(completed.clips[0], partial.clips[0]); assert.equal((await stat(join(outputs, id, partial.batchId, partial.clips[0].file))).mtimeMs, oldStat.mtimeMs);
    assert.equal(engineCalls, 1);
    assert.equal((await server.inject({ method: "POST", url: `/projects/${id}/retry` })).json().reused, true);
    const saved = JSON.parse(await readFile(join(directory, id, "processing-legacy.json"), "utf8"));
    assert.deepEqual(saved.state.selectedIds, completed.requestedIds);
    const range = await server.inject({ url: final.clips[0].url.replace("/api", ""), headers: { range: "bytes=0-31" } }); assert.equal(range.statusCode, 206);
    const original = await server.inject({ url: `/projects/${id}/original`, headers: { range: "bytes=0-31" } }); assert.equal(original.statusCode, 206);
    const firstPath = join(outputs, id, partial.batchId, partial.clips[0].file), preservedBytes = await readFile(firstPath);
    const changedBytes = Buffer.from(preservedBytes); changedBytes[changedBytes.length - 1] ^= 1;
    await writeFile(firstPath, changedBytes);
    assert.equal((await server.inject({ url: final.clips[0].url.replace("/api", ""), headers: { range: "bytes=0-31" } })).statusCode, 409);
    assert.equal((await server.inject({ url: final.clips[1].url.replace("/api", ""), headers: { range: "bytes=0-31" } })).statusCode, 206);
    await writeFile(firstPath, preservedBytes);
    const usageBeforeOutputs = (await server.inject("/storage/usage")).json().usage;
    const deletedOutputs = await server.inject({ method: "DELETE", url: `/projects/${id}/outputs`, payload: { confirm: true } }); assert.equal(deletedOutputs.statusCode, 200);
    const remaining = (await server.inject(`/projects/${id}`)).json().project; assert.equal(remaining.clipCount, 0); assert.equal(remaining.hasTranscript, true); assert.equal(remaining.hasAnalysis, true); assert.ok(remaining.originalUrl);
    assert.equal((await server.inject(`/uploads/${id}`)).statusCode, 200);
    assert.deepEqual(await readdir(join(outputs, ".work")), []);
    await writeFile(join(root, "result.json"), JSON.stringify({ fixtureRoot: root, uploadId: id, blockerId: blocker.id, initialUsage: before, afterDeletionUsage: after, quotaBytes, partialBatch: partial.batchId, retainedClipChecksum: partial.clips[0].checksum, resumedCount: completed.clips.length, engineCalls, blockerDeletion: response.json(), outputDeletion: deletedOutputs.json(), completedUsage: usageBeforeOutputs, finalUsage: (await server.inject("/storage/usage")).json().usage, passed: true }, null, 2));
  } finally { await server.close(); }
});
