import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { resolvePipelineTimeouts, PIPELINE_TIMEOUT_DEFAULTS } from "../../../config/pipeline-timeouts.mjs";
import { withStageDeadline, PipelineTimeoutError } from "../dist/features/pipeline/services/stage-deadline.js";
import { createServer } from "../dist/server/create-server.js";
import { createUploadService } from "../dist/features/uploads/services/receive-video.js";
import { createTranscriptionService } from "../dist/features/transcription/services/transcription-service.js";
import { createYtdlpStream } from "../dist/features/youtube-ingestion/services/stream-ytdlp.js";
import { runPython } from "../dist/features/transcription/services/python-runner.js";
import { createAnalysisService } from "../dist/features/analysis/services/analysis-service.js";
import { runRenderProcess } from "../dist/features/clip-rendering/services/render-process.js";
import { runMediaTool } from "../dist/features/youtube-ingestion/services/ffmpeg-runner.js";

const url = "https://youtu.be/BaW_jenozKc";
const signal = () => new AbortController().signal;
const waitAbort = signal => new Promise((_, reject) => {
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  if (signal.aborted) reject(signal.reason);
});
async function until(query, terminal = value => ["completed", "failed", "downloaded"].includes(value.stage ?? value.status)) {
  for (let i = 0; i < 300; i++) { const value = await query(); if (terminal(value)) return value; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail("Job did not reach expected status");
}
function prepared(reference, open = async () => ({ content: Readable.from([Buffer.from("video")]) })) {
  return { name: "fixture.mp4", type: "video/mp4", source: { ...reference, provider: "youtube", title: "Fixture", durationSeconds: 3600, thumbnailUrl: null }, open };
}
function environment(t, values) {
  for (const [key, value] of Object.entries(values)) { const old = process.env[key]; process.env[key] = String(value); t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; }); }
}
test("defaults independentes para 1h e env estritamente validada", () => {
  assert.deepEqual(resolvePipelineTimeouts({}), PIPELINE_TIMEOUT_DEFAULTS);
  const expected = { metadata: 120000, download: 3600000, ffmpeg: 1200000, ffprobe: 120000, transcription: 3600000, analysis: 900000, render: 3600000, renderClip: 300000, preparation: 1200000, storage: 300000, upload: 1800000, request: 15000 };
  assert.deepEqual(PIPELINE_TIMEOUT_DEFAULTS, expected);
  for (const name of ["METADATA_TIMEOUT_MS", "DOWNLOAD_TIMEOUT_MS", "FFMPEG_TIMEOUT_MS", "FFPROBE_TIMEOUT_MS", "TRANSCRIPTION_TIMEOUT_MS", "ANALYSIS_TIMEOUT_MS", "RENDER_TIMEOUT_MS", "RENDER_CLIP_TIMEOUT_MS", "VIDEO_PREPARATION_TIMEOUT_MS", "STORAGE_TIMEOUT_MS", "UPLOAD_TIMEOUT_MS", "API_REQUEST_TIMEOUT_MS"]) {
    assert.ok(Object.values(resolvePipelineTimeouts({ [name]: "1234" })).includes(1234));
    for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "2147483648", " 5 "]) assert.throws(() => resolvePipelineTimeouts({ [name]: value }), new RegExp(name));
  }
});
test("cada etapa expira com causa, orçamento e duração; pai/cancelamento permanece independente", async () => {
  for (const stage of Object.keys(PIPELINE_TIMEOUT_DEFAULTS)) {
    await assert.rejects(withStageDeadline(stage, signal(), waitAbort, 12), error => error instanceof PipelineTimeoutError
      && error.stage === stage && error.timeoutMs === 12 && error.elapsedMs >= 8 && error.statusCode === 408);
  }
  const abort = new AbortController(), reason = new Error("explicit cancellation");
  const pending = withStageDeadline("download", abort.signal, waitAbort, 1000); abort.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(await withStageDeadline("metadata", signal(), async () => "short", 1000), "short");
});
test("job retorna 202 antes da mídia, sobrevive ao fim da request e publica status/GET íntegro", async t => {
  const directory = await mkdtemp(join(tmpdir(), "clipador-long-job-"));
  let release, reached;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { reached = resolve; });
  const server = createServer({ directory, uploadTimeoutMs: 10 }, { downloader: { async prepare(reference) {
    reached(); await gate; return prepared(reference);
  } } }); server.log.level = "silent"; t.after(() => server.close());
  const post = await server.inject({ method: "POST", url: "/ingestions/youtube/jobs", payload: { url } });
  assert.equal(post.statusCode, 202); const id = post.json().ingestion.id;
  await started; await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal((await server.inject(`/ingestions/${id}`)).json().ingestion.status, "fetching-metadata");
  release(); const result = await until(async () => (await server.inject(`/ingestions/${id}`)).json().ingestion);
  assert.equal(result.status, "downloaded"); assert.match(result.upload.checksum.value, /^[a-f0-9]{64}$/);
  assert.equal((await server.inject(`/uploads/${id}`)).statusCode, 200);
  assert.deepEqual((await readdir(join(directory, id))).sort(), ["metadata.json", "video.mp4"]);
  await server.close(); const restored = createServer({ directory }); restored.log.level = "silent"; t.after(() => restored.close());
  assert.equal((await restored.inject(`/ingestions/${id}`)).json().ingestion.status, "downloaded");
});
test("metadata e download do job usam budgets separados e deixam quota/concorrência livres", async t => {
  environment(t, { METADATA_TIMEOUT_MS: 40, DOWNLOAD_TIMEOUT_MS: 50 });
  for (const stage of ["metadata", "download"]) {
    const directory = await mkdtemp(join(tmpdir(), "clipador-long-timeout-"));
    const server = createServer({ directory, maxConcurrentUploads: 1 }, { downloader: { async prepare(reference, signal) {
      if (stage === "metadata") await waitAbort(signal);
      return prepared(reference, async () => { const content = new Readable({ read() {} }); content.push(Buffer.from("a")); return { content, dispose: () => content.destroy() }; });
    } } }); server.log.level = "silent"; t.after(() => server.close());
    const start = await server.inject({ method: "POST", url: "/ingestions/youtube/jobs", payload: { url } });
    const id = start.json().ingestion.id, result = await until(async () => (await server.inject(`/ingestions/${id}`)).json().ingestion);
    assert.equal(result.status, "failed"); assert.equal(result.code, "TIMEOUT"); assert.equal(result.error.stage, stage);
    assert.equal((await server.inject(`/uploads/${id}`)).statusCode, 404);
    assert.ok(!(await readdir(directory)).includes(id) || (await readdir(join(directory, id))).length === 0);
    assert.equal((await server.inject({ method: "POST", url: "/uploads/video", payload: Buffer.from("local"), headers: { "content-type": "video/mp4", "x-file-name": "local.mp4" } })).statusCode, 200);
  }
});
test("cancelamento explícito/shutdown matam downloader filho e removem parciais antes da resposta", async t => {
  for (const mode of ["cancel", "shutdown"]) {
    let child;
    const directory = await mkdtemp(join(tmpdir(), "clipador-long-cancel-"));
    const open = createYtdlpStream({ verify: async () => {}, launch(_exe, _args, settings) {
      child = spawn(process.execPath, ["-e", 'process.stdout.write("video");setInterval(()=>{},1000)'], settings); return child;
    } });
    const server = createServer({ directory, maxConcurrentUploads: 1 }, { downloader: { async prepare(reference, _signal, _status, progress) {
      return prepared(reference, async signal => {
        const result = await open(reference, "mp4", signal);
        result.content.on("data", chunk => progress?.(chunk.length)); // Fixture bytes, no fabricated percent.
        return result;
      });
    } } }); server.log.level = "silent"; t.after(() => server.close());
    const id = (await server.inject({ method: "POST", url: "/ingestions/youtube/jobs", payload: { url } })).json().ingestion.id;
    await until(async () => (await server.inject(`/ingestions/${id}`)).json().ingestion, () => child?.stdout.bytesRead > 0);
    if (mode === "cancel") {
      const response = await server.inject({ method: "DELETE", url: `/ingestions/${id}` });
      assert.equal(response.statusCode, 200); assert.equal(response.json().ingestion.code, "CANCELLED");
    } else await server.close();
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.deepEqual(await readdir(join(directory, id)), []);
  }
});
test("Whisper não herda timeout da preparação e progresso real é consultável", async t => {
  environment(t, { VIDEO_PREPARATION_TIMEOUT_MS: 15 });
  const directory = await mkdtemp(join(tmpdir(), "clipador-long-asr-")), uploads = createUploadService({ directory }); await uploads.initialize();
  const upload = await uploads.receiveVideo(Readable.from([Buffer.from("video")]), "fixture.mp4", "video/mp4");
  const raw = { language: "pt", duration: 3600, segments: [{ id: 0, start: 3598, end: 3600, text: "Vídeo longo.", words: [{ word: "Vídeo", start: 3598, end: 3599 }, { word: "longo.", start: 3599, end: 3600 }] }] };
  const service = createTranscriptionService(uploads, directory, { timeoutMs: 500, async prepareAudio(context, consume) {
    const audio = join(context.directory, "audio-asr.wav.part"); await writeFile(audio, "audio");
    try { await consume(audio); } finally { const { removePartial } = await import("../dist/features/transcription/services/transcript-persistence.js"); await removePartial(context.directory, "audio-asr.wav.part"); }
  }, engine: { async transcribe(_path, _signal, progress) {
    progress({ segmentsProcessed: 1, processedThroughSeconds: 3600 }); await new Promise(resolve => setTimeout(resolve, 70)); return raw;
  } } }); t.after(() => service.close());
  await service.start(upload.id);
  const running = await until(() => service.status(upload.id), status => status.progress !== undefined);
  assert.equal(running.progress.segmentsProcessed, 1);
  assert.equal((await until(() => service.status(upload.id))).stage, "completed");
  assert.equal((await service.result(upload.id)).duration, 3600);
  assert.ok(!(await readdir(join(directory, upload.id))).some(name => name.endsWith(".part")));
});
test("Python publica segmentos antes do resultado e seu timeout encerra o PID", async () => {
  const root = await mkdtemp(join(tmpdir(), "clipador-long-python-")), pidFile = join(root, "pid");
  const progress = [];
  const result = await runPython({ executable: process.execPath, timeoutMs: 1000, args: ["-e", 'process.stderr.write(\'CLIPADOR_PROGRESS {"segmentsProcessed":1,"processedThroughSeconds":23.5}\\n\');setTimeout(()=>process.stdout.write("{}"),80)'], onProgress: value => progress.push(value) }, signal());
  assert.deepEqual(result, {}); assert.deepEqual(progress, [{ segmentsProcessed: 1, processedThroughSeconds: 23.5 }]);
  await assert.rejects(runPython({ executable: process.execPath, timeoutMs: 150, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`] }, signal()), { code: "TIMEOUT", stage: "transcription" });
  const { readFile } = await import("node:fs/promises"), pid = Number(await readFile(pidFile, "utf8"));
  assert.throws(() => process.kill(pid, 0));
});
test("análise e lote expiram por suas próprias etapas e encerram processo FFmpeg simulado", async t => {
  environment(t, { ANALYSIS_TIMEOUT_MS: 25 });
  const directory = await mkdtemp(join(tmpdir(), "clipador-long-analysis-")), uploads = createUploadService({ directory }); await uploads.initialize();
  const upload = await uploads.receiveVideo(Readable.from([Buffer.from("video")]), "fixture.mp4", "video/mp4");
  const transcript = { language: "pt", languageProbability: null, duration: 3600, text: "", segments: [] };
  const analysis = createAnalysisService(uploads, { result: async () => transcript }, directory, { analysisVersion: "test", analyze: (_input, signal) => waitAbort(signal) });
  await assert.rejects(analysis.start(upload.id), { code: "TIMEOUT", stage: "analysis" });
  assert.deepEqual((await readdir(join(directory, upload.id))).sort(), ["metadata.json", "video.mp4"]);
  await assert.rejects(withStageDeadline("render", signal(), signal => runRenderProcess({ executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: directory, timeoutMs: 1000 }, signal), 35), { code: "TIMEOUT", stage: "render" });
});
test("FFmpeg e FFprobe aplicam seus prazos ao stream e aguardam encerramento do filho", async t => {
  environment(t, { FFMPEG_TIMEOUT_MS: 1000, FFPROBE_TIMEOUT_MS: 1000 });
  for (const stage of ["ffmpeg", "ffprobe"]) {
    let child;
    const opened = await runMediaTool(stage, [], signal(), { launch(_executable, _args, options) {
      child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], options); return child;
    } });
    try { await assert.rejects(async () => { for await (const _chunk of opened.content) { /* Wait for the tool deadline. */ } }, { code: "TIMEOUT", stage }); }
    finally { await opened.dispose(); }
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  }
});
test("cancelamento Python termina também o descendente do launcher Windows", { timeout: 10000 }, async () => {
  const { readFile } = await import("node:fs/promises");
  const directory = await mkdtemp(join(tmpdir(), "clipador-process-tree-")), childFile = join(directory, "child-pid");
  const code = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',windowsHide:true});require('node:fs').writeFileSync(${JSON.stringify(childFile)},String(child.pid));setInterval(()=>{},1000);`;
  await assert.rejects(runPython({ executable: process.execPath, args: ["-e", code], timeoutMs: 300 }, signal()), { code: "TIMEOUT" });
  const pid = Number(await readFile(childFile, "utf8")); assert.throws(() => process.kill(pid, 0), "Descendant must not remain alive");
});
test("launcher real da venv encerra o Python descendente no timeout", { skip: process.platform !== "win32", timeout: 10000 }, async () => {
  const { readFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "clipador-venv-cancel-")), pidFile = join(root, "python-pid");
  const executable = new URL("../../../tools/transcription/venv/Scripts/python.exe", import.meta.url);
  const { fileURLToPath } = await import("node:url");
  const code = `import os,time;open(${JSON.stringify(pidFile)},'w').write(str(os.getpid()));time.sleep(100)`;
  await assert.rejects(runPython({ executable: fileURLToPath(executable), args: ["-I", "-X", "utf8", "-c", code], timeoutMs: 500 }, signal()), { code: "TIMEOUT" });
  const pid = Number(await readFile(pidFile, "utf8")); assert.throws(() => process.kill(pid, 0));
});
test("5, 15, 30, 45 e 60 minutos preservam timestamps finais e reuso sem limites de vídeos curtos", async t => {
  for (const duration of [300, 900, 1800, 2700, 3600]) {
    const directory = await mkdtemp(join(tmpdir(), "clipador-duration-profile-")), uploads = createUploadService({ directory }); await uploads.initialize();
    const upload = await uploads.receiveVideo(Readable.from([Buffer.from("video")]), "fixture.mp4", "video/mp4");
    let calls = 0;
    const service = createTranscriptionService(uploads, directory, { async prepareAudio(context, consume) {
      const path = join(context.directory, "audio-asr.wav.part"); await writeFile(path, "audio");
      try { await consume(path); } finally { const { removePartial } = await import("../dist/features/transcription/services/transcript-persistence.js"); await removePartial(context.directory, "audio-asr.wav.part"); }
    }, engine: { async transcribe() { calls++; return { language: "pt", duration, segments: [{ id: 0, start: duration - 2, end: duration, text: "Final real.", words: [{ word: "Final", start: duration - 2, end: duration - 1 }, { word: "real.", start: duration - 1, end: duration }] }] }; } } });
    t.after(() => service.close()); await service.start(upload.id);
    assert.equal((await until(() => service.status(upload.id))).stage, "completed");
    assert.equal((await service.result(upload.id)).segments[0].words.at(-1).end, duration);
    assert.equal((await service.start(upload.id)).reused, true); assert.equal(calls, 1);
  }
});
