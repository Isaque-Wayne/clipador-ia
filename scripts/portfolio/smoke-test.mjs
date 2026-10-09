import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { createServer } from "../../apps/api/dist/server/create-server.js";
import { fileChecksum } from "../../apps/api/dist/features/clip-rendering/services/clip-storage.js";
import { runMediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { inspectionArguments } from "../../apps/api/dist/features/video-preparation/utils/media-commands.js";
import { readProbeJson } from "../../apps/api/dist/features/video-preparation/services/read-probe-json.js";
import { selectPortfolio } from "../../apps/api/dist/features/portfolio/services/portfolio-provider.js";

const workspace = resolve(import.meta.dirname, "../..");
const directory = resolve(process.argv[2] ?? join(workspace, "apps/api/.data/processing-smoke/2026-10-08T18-10-13-205Z/uploads"));
const id = process.argv[3] ?? "1f5397b6-c4a3-4654-916f-1f7cb07ee477";
const quantity = process.argv[4] ?? "many";
assert.ok(["auto", "few", "normal", "many", "maximum"].includes(quantity));
assert.match(id, /^[a-f0-9-]{36}$/);
const root = join(workspace, "apps/api/.data/portfolio-smoke", new Date().toISOString().replace(/[:.]/gu, "-"));
const outputs = join(root, "clips"), signal = new AbortController().signal;
await mkdir(root, { recursive: true });
const source = join(directory, id, "video.mp4"), sourceBefore = await fileChecksum(source), transcriptBefore = await fileChecksum(join(directory, id, "transcript.json"));
const evidence = { uploadId: id, quantity, root, source, originalFullVideoDuration: 960.689297, sourceBefore, transcriptBefore, stages: [], clips: [], diagnostics: [], engineCalls: 0 };
const engine = { async transcribe() { evidence.engineCalls++; assert.fail("A transcrição existente deve ser reutilizada"); } };
const server = createServer({ directory }, {}, { engine }, { directory: outputs }); server.log.level = "error";
let peakNodeRss = process.memoryUsage().rss;
const sampler = setInterval(() => { peakNodeRss = Math.max(peakNodeRss, process.memoryUsage().rss); }, 200);
const started = performance.now();
try {
  assert.equal((await server.inject("/health")).statusCode, 200);
  const uploaded = await server.inject(`/uploads/${id}`); assert.equal(uploaded.statusCode, 200, uploaded.body);
  const analysisStarted = performance.now();
  const analysis = await server.inject({ method: "POST", url: `/uploads/${id}/portfolio` }); assert.equal(analysis.statusCode, 200, analysis.body);
  const report = analysis.json().report;
  evidence.analysisWallSeconds = (performance.now() - analysisStarted) / 1000; evidence.analysisReused = analysis.json().reused;
  evidence.testedDuration = report.portfolio.sourceDuration; evidence.metrics = report.portfolio.metrics;
  evidence.poolDistribution = Object.fromEntries(["micro", "short", "standard", "extended"].map(profile => [profile, report.portfolio[profile].length]));
  evidence.selection = selectPortfolio(report, quantity).map(item => ({ id: item.id, profile: item.profile, start: item.start, end: item.end, score: item.score.value }));
  console.log(JSON.stringify({ metrics: evidence.metrics, pool: evidence.poolDistribution, selected: evidence.selection }));
  const renderStarted = performance.now();
  const initiated = await server.inject({ method: "POST", url: `/uploads/${id}/portfolio/process`, payload: { quantity } }); assert.equal(initiated.statusCode, 202, initiated.body);
  let status;
  do {
    status = (await server.inject(`/uploads/${id}/portfolio/process/status`)).json().status;
    if (evidence.stages.at(-1) !== status.stage) { evidence.stages.push(status.stage); console.log(`STAGE ${status.stage} ${status.renderedCount ?? 0}/${status.selectedCount ?? "?"}`); }
    if (["completed", "failed"].includes(status.stage)) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  } while (performance.now() - renderStarted < 600000);
  assert.equal(status.stage, "completed", JSON.stringify(status));
  evidence.renderWallSeconds = (performance.now() - renderStarted) / 1000;
  const result = await server.inject(`/uploads/${id}/portfolio/clips`); assert.equal(result.statusCode, 200, result.body); const batch = result.json().batch;
  evidence.batchId = batch.batchId;
  evidence.finalDistribution = Object.fromEntries(["micro", "short", "standard", "extended"].map(profile => [profile, batch.clips.filter(clip => clip.candidate.profile === profile).length]));
  for (const clip of batch.clips) {
    const path = join(outputs, id, batch.batchId, clip.file);
    assert.equal(await fileChecksum(path), clip.checksum);
    const probe = await readProbeJson(await runMediaTool("ffprobe", inspectionArguments(path), signal));
    const firstWord = clip.editPlan.captions.groups[0].words[0];
    const frameTime = (firstWord.start + firstWord.end) / 2;
    const preview = join(root, `${clip.id}-preview.png`);
    const frame = await runMediaTool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", String(frameTime), "-i", path, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"], signal);
    try { await pipeline(frame.content, createWriteStream(preview, { flags: "wx" })); } finally { await frame.dispose?.(); }
    const url = `/uploads/${id}/clips/${batch.batchId}/${clip.id}/file`;
    const served = await server.inject({ url, headers: { range: "bytes=0-63" } }); assert.equal(served.statusCode, 206); assert.equal(served.rawPayload.length, 64);
    assert.equal((await server.inject(`/uploads/${id}/portfolio/candidates/${clip.id}`)).statusCode, 200);
    evidence.clips.push({ ...clip, path, preview, probe, previewTime: frameTime });
  }
  evidence.uploadFiles = await readdir(join(directory, id)); evidence.workFiles = await readdir(join(outputs, ".work"));
  assert.ok(!evidence.uploadFiles.some(file => file.endsWith(".part"))); assert.deepEqual(evidence.workFiles, []);
  assert.equal(await fileChecksum(source), sourceBefore); assert.equal(await fileChecksum(join(directory, id, "transcript.json")), transcriptBefore);
  evidence.sourcePreserved = true; evidence.transcriptPreserved = true; evidence.cleanup = true;
  await server.close();
  const restored = createServer({ directory }, {}, { engine }, { directory: outputs }); restored.log.level = "error";
  try {
    assert.deepEqual((await restored.inject(`/uploads/${id}/portfolio/clips`)).json().batch, batch);
    assert.equal((await restored.inject({ method: "POST", url: `/uploads/${id}/portfolio` })).json().reused, true);
    assert.equal((await restored.inject({ method: "POST", url: `/uploads/${id}/portfolio/process`, payload: { quantity } })).json().reused, true);
    assert.equal((await restored.inject(`/uploads/${id}/clips`)).statusCode, 409, "Resultado do fluxo legado não pode ser confundido com portfólio");
    evidence.recovery = true;
  } finally { await restored.close(); }
  evidence.finalClipBytes = batch.clips.reduce((sum, clip) => sum + clip.size, 0);
  evidence.manifestBytes = (await stat(join(outputs, id, batch.batchId, "manifest.json"))).size;
  evidence.renderCpuWallSum = batch.clips.reduce((sum, clip) => sum + clip.metadata.renderSeconds, 0);
} catch (error) { evidence.error = error.stack ?? error.message; process.exitCode = 1; }
finally {
  clearInterval(sampler); await server.close(); evidence.totalSeconds = (performance.now() - started) / 1000;
  evidence.peakNodeRssBytes = peakNodeRss; evidence.ramNote = "RSS do processo Node observado; memória dos filhos FFmpeg não medida.";
  const path = join(root, "result.json"); await writeFile(path, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ root, error: evidence.error, metrics: evidence.metrics, pool: evidence.poolDistribution, final: evidence.finalDistribution, totalSeconds: evidence.totalSeconds, renderWallSeconds: evidence.renderWallSeconds, bytes: evidence.finalClipBytes, peakNodeRss }));
  console.log(`EVIDENCE ${path}`);
}
