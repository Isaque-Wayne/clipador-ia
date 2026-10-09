import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readdir, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTranscript } from "../dist/features/transcription/services/normalize-transcript.js";
import { buildEditPlan } from "../dist/features/editing/planning/edit-plan.js";
import { buildTimeline, outputTime } from "../dist/features/editing/planning/timeline.js";
import { planPacing } from "../dist/features/editing/pacing/pacing-plan.js";
import { validateEditPlan } from "../dist/features/editing/planning/validate-edit-plan.js";
import { renderCaptionAss } from "../dist/features/editing/captions/render-ass.js";
import { createRenderPlan } from "../dist/features/editing/rendering/render-plan.js";
import { planFilterGraph, plannedRenderArguments } from "../dist/features/editing/rendering/ffmpeg-plan.js";
import { LocalMusicProvider } from "../dist/features/editing/music/music-provider.js";
import { SourceBRollProvider } from "../dist/features/editing/broll/broll-provider.js";
import { resolveAssets } from "../dist/features/editing/assets/asset-resolver.js";
import { createServer } from "../dist/server/create-server.js";
import { mediaTool, runMediaTool } from "../dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { runRenderProcess } from "../dist/features/clip-rendering/services/render-process.js";
import { fileChecksum } from "../dist/features/clip-rendering/services/clip-storage.js";
import { UploadValidationError } from "../dist/features/uploads/utils/validate-video.js";

const signal = new AbortController().signal;
const segments = [
  { start: .2, end: 4, text: "Hoje mostro 3 caminhos para uma decisão melhor.", words: ["Hoje", "mostro", "3", "caminhos", "para", "uma", "decisão", "melhor."].map((word, index) => ({ word, start: .2 + index * .475, end: .2 + (index + 1) * .475 })) },
  { start: 6, end: 11.6, text: "Uma ideia clara oferece contexto e ajuda cada pessoa.", words: ["Uma", "ideia", "clara", "oferece", "contexto", "e", "ajuda", "cada", "pessoa."].map((word, index) => ({ word, start: 6 + index * 5.6 / 9, end: 6 + (index + 1) * 5.6 / 9 })) },
];
const transcript = normalizeTranscript({ language: "pt", duration: 12, segments });
const candidate = { id: "c_0123456789abcdef", start: .08, end: 11.78, duration: 11.7, profile: "micro", score: { method: "test" }, emotion: { semantic: { labels: [] }, events: [{ start: 1.15, end: 1.625, kind: "number", text: "3 caminhos", strength: .75, reason: "Número" }] } };
const inspection = { width: 320, height: 180 };
const audio = { available: true, method: "ffmpeg-astats-0.5s", windows: Array.from({ length: 24 }, (_, index) => ({ start: index * .5, end: (index + 1) * .5, rmsDb: index >= 7 && index <= 12 ? -120 : -20, peakDb: index >= 7 && index <= 12 ? -120 : -5 })) };
test("timeline sincroniza vídeo, áudio e palavras após corte; preserva fonte e ordem", () => {
  const timeline = buildTimeline(0, 12, [{ start: 4.22, end: 5.78, reason: "quiet" }]);
  assert.ok(Math.abs(timeline.at(-1).outputEnd - 10.44) < 1e-9); assert.equal(outputTime(5, timeline), null); assert.ok(Math.abs(outputTime(6, timeline) - 4.44) < 1e-9);
  assert.throws(() => buildTimeline(0, 10, [{ start: 11, end: 12 }]));
});
test("pacing preserva narrativa, eventos e pausas incertas; trims só com cobertura de silêncio", () => {
  assert.equal(planPacing(candidate, transcript, audio, "DYNAMIC").pauses[0].action, "trim");
  for (const style of ["CLEAN", "STORY", "EMOTIONAL"]) assert.equal(planPacing(candidate, transcript, audio, style).pauses[0].action, "preserve");
  assert.equal(planPacing(candidate, transcript, undefined, "DYNAMIC").pauses[0].action, "preserve");
  const noisy = structuredClone(audio); noisy.windows[8].rmsDb = -10; assert.equal(planPacing(candidate, transcript, noisy, "DYNAMIC").pauses[0].action, "preserve");
  const uncovered = { ...audio, windows: audio.windows.filter(window => window.start !== 4) }; assert.equal(planPacing(candidate, transcript, uncovered, "DYNAMIC").pauses[0].action, "preserve");
  const emotional = structuredClone(candidate); emotional.emotion.events.push({ start: 4, end: 6, kind: "emotion" }); assert.equal(planPacing(emotional, transcript, audio, "DYNAMIC").pauses[0].action, "preserve");
});
test("planos determinam presets, safe area, palavra ativa, zoom de evento e comando limitado", () => {
  const plan = buildEditPlan(candidate, transcript, inspection, audio);
  assert.equal(plan.style, "DYNAMIC"); assert.equal(plan.silenceCuts.length, 1); assert.ok(Math.abs(plan.outputDuration - 10.14) < .001);
  assert.equal(plan.zoomEvents.length, 1); assert.ok(Math.abs(plan.zoomEvents[0].start - 1.07) < 1e-9); assert.equal(plan.framing.mode, "padding");
  assert.deepEqual(validateEditPlan(plan), plan);
  assert.ok(plan.captions.groups.every(group => group.words.length <= 5 && group.position.y < 1 - plan.captions.safeArea.bottom));
  assert.ok(Math.abs(plan.captions.groups[0].position.x - .47) < 1e-9);
  const previousVersion = structuredClone(plan); previousVersion.version = "social-edit-1.0.0"; previousVersion.captions.version = "caption-plan-1.0.0"; previousVersion.captions.groups.forEach(group => { group.position.x = .5; });
  assert.deepEqual(validateEditPlan(previousVersion), previousVersion, "Lotes existentes continuam legíveis");
  const ass = renderCaptionAss(plan); assert.match(ass, /Dialogue: 1,/); assert.match(ass, /\\c&H00E9D7A0&/); assert.match(ass, /\\fs64/);
  const injected = structuredClone(plan); injected.captions.groups[0].words[0].text = "{\\pos(0,0)}bad\\N";
  assert.ok(!renderCaptionAss(injected).includes("{\\pos(0,0)}"));
  const render = createRenderPlan(plan, { warnings: [] }), graph = planFilterGraph(render), args = plannedRenderArguments(render);
  assert.match(graph, /concat=n=2:v=1:a=1/); assert.match(graph, /eval=frame/); assert.ok(args.includes("-/filter_complex")); assert.ok(args.includes("-fs"));
  const invalid = structuredClone(plan); invalid.zoomEvents[0].intensity = 5; assert.throws(() => createRenderPlan(invalid, { warnings: [] }));
});
test("assets opcionais degradam sem falhar; source B-roll exige cena aprovada e contextual", async () => {
  const plan = buildEditPlan(candidate, transcript, inspection, audio, "EMOTIONAL");
  plan.bRollEvents = [{ start: 1, end: 2, query: "bicicleta elétrica", purpose: "illustrate", importance: .5 }];
  const missing = await resolveAssets(plan, new LocalMusicProvider(), new SourceBRollProvider(), signal);
  assert.equal(missing.music, undefined); assert.equal(missing.warnings.length, 2);
  const broken = { async resolve() { throw new Error("optional unavailable"); } };
  assert.equal((await resolveAssets(plan, broken, broken, signal)).warnings.length, 2);
  const source = new SourceBRollProvider([{ id: "scene", start: 20, end: 23, description: "bicicleta elétrica numa cidade" }], { start: 0, end: 12 });
  assert.equal((await source.resolve(plan.bRollEvents[0], signal)).source, "original-video");
  assert.equal(await source.resolve({ ...plan.bRollEvents[0], query: "avião" }, signal), null);
});
async function bytes(args) {
  const process = await runMediaTool("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], signal, { mapFailure: stderr => new UploadValidationError(stderr, 500) }), chunks = [];
  try { for await (const chunk of process.content) chunks.push(chunk); return Buffer.concat(chunks); } finally { await process.dispose?.(); }
}
async function frame(path, at) { return bytes(["-ss", String(at), "-i", path, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]); }
function pixels(buffer, predicate) { let count = 0; for (let index = 0; index < buffer.length; index += 3) if (predicate(buffer[index], buffer[index + 1], buffer[index + 2])) count++; return count; }
async function tonePower(path, at) {
  const buffer = await bytes(["-ss", String(at), "-i", path, "-t", "0.5", "-vn", "-ac", "1", "-ar", "8000", "-f", "f32le", "pipe:1"]);
  let real = 0, imaginary = 0, count = buffer.length / 4;
  for (let index = 0; index < count; index++) { const sample = buffer.readFloatLE(index * 4), phase = index * 2 * Math.PI * 880 / 8000; real += sample * Math.cos(phase); imaginary += sample * Math.sin(phase); }
  return (real * real + imaginary * imaginary) / (count * count);
}
test("FFmpeg real: palavra ativa, zoom mensurável, silêncio sincronizado, música licenciada com ducking e recovery", { timeout: 90000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "clipador-editing-real-")), directory = join(root, "uploads"), outputs = join(root, "clips"), musicDirectory = join(root, "music");
  const ffmpeg = await mediaTool("ffmpeg");
  await runRenderProcess({ executable: ffmpeg, args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=white:s=320x180:r=30:d=12,drawbox=x=60:y=40:w=20:h=30:color=red:t=fill", "-f", "lavfi", "-i", "sine=frequency=440:duration=12", "-af", "volume=0:enable='between(t,3.5,6.5)'", "-c:v", "libopenh264", "-b:v", "300k", "-c:a", "aac", "-shortest", "fixture.mp4"], cwd: root, timeoutMs: 15000 }, signal);
  const { mkdir } = await import("node:fs/promises"); await mkdir(musicDirectory);
  await runRenderProcess({ executable: ffmpeg, args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=12", "-c:a", "pcm_s16le", "original-test-tone.wav"], cwd: musicDirectory, timeoutMs: 15000 }, signal);
  const checksum = await fileChecksum(join(musicDirectory, "original-test-tone.wav"));
  const musicEntry = { id: "original-test-tone", extension: ".wav", mood: "emotional", approved: false, checksum, license: "Sinal original sintetizado exclusivamente para este teste; sem gravação comercial." };
  await writeFile(join(musicDirectory, "catalog.json"), JSON.stringify({ schemaVersion: 1, music: [musicEntry] }));
  assert.equal(await new LocalMusicProvider(musicDirectory).resolve("emotional", signal), null);
  musicEntry.approved = true; await writeFile(join(musicDirectory, "catalog.json"), JSON.stringify({ schemaVersion: 1, music: [musicEntry] }));
  const options = { directory: outputs, musicDirectory }, server = createServer({ directory }, {}, { engine: { async transcribe() { return transcript; } } }, options); server.log.level = "silent";
  let id, batch, musical;
  async function complete(service, style) {
    const response = await service.inject({ method: "POST", url: `/uploads/${id}/portfolio/process`, payload: { style } }); assert.equal(response.statusCode, 202, response.body);
    assert.equal((await service.inject({ method: "POST", url: `/uploads/${id}/process` })).statusCode, 429);
    let status;
    for (let index = 0; index < 500; index++) { status = (await service.inject(`/uploads/${id}/portfolio/process/status`)).json().status; if (["completed", "failed"].includes(status.stage)) break; await new Promise(resolve => setTimeout(resolve, 50)); }
    assert.equal(status.stage, "completed", JSON.stringify(status));
    return (await service.inject(`/uploads/${id}/portfolio/clips`)).json().batch;
  }
  try {
    const uploaded = await server.inject({ method: "POST", url: "/uploads/video", headers: { "content-type": "video/mp4", "x-file-name": "fixture.mp4" }, payload: createReadStream(join(root, "fixture.mp4")) }); assert.equal(uploaded.statusCode, 200, uploaded.body); id = uploaded.json().id;
    assert.equal((await server.inject({ method: "POST", url: `/uploads/${id}/portfolio/process`, payload: { quantity: "bad" } })).statusCode, 400);
    batch = await complete(server, "DYNAMIC"); const clip = batch.clips[0], path = join(outputs, id, batch.batchId, clip.file);
    assert.equal(clip.editPlan.silenceCuts.length, 1); assert.ok(Math.abs(clip.duration - clip.editPlan.outputDuration) < .3); assert.ok(clip.metadata.editsApplied.includes("active-word-captions"));
    const zoom = clip.editPlan.zoomEvents[0], zoomFrame = await frame(path, (zoom.start + zoom.end) / 2), normalFrame = await frame(path, zoom.end + .5);
    const red = (r, g, b) => r > 150 && g < 60 && b < 60;
    assert.ok(pixels(zoomFrame, red) > pixels(normalFrame, red) * 1.1, "zoom aumenta área do alvo estático em pixels");
    const firstWord = clip.editPlan.captions.groups[0].words[0], captionFrame = await frame(path, (firstWord.start + firstWord.end) / 2);
    assert.ok(pixels(captionFrame, (r, g, b) => r > 120 && r < 200 && g > r + 25 && b > g + 5) > 50, "palavra atual tem cor ativa renderizada no MP4");
    musical = await complete(server, "EMOTIONAL"); const musicClip = musical.clips[0], musicPath = join(outputs, id, musical.batchId, musicClip.file);
    assert.equal(musicClip.editPlan.silenceCuts.length, 0); assert.ok(musicClip.metadata.editsApplied.includes("voice-ducking")); assert.equal(musicClip.assets.musicId, musicEntry.id);
    const speechPower = await tonePower(musicPath, 1), quietPower = await tonePower(musicPath, 5); assert.ok(speechPower < quietPower * .8, `ducking medido: ${speechPower}/${quietPower}`);
    assert.equal(await fileChecksum(path), clip.checksum); assert.equal(await fileChecksum(musicPath), musicClip.checksum);
    assert.deepEqual(await readdir(join(outputs, ".work")), []); assert.ok(!(await readdir(join(directory, id))).some(name => name.endsWith(".part")));
  } finally { await server.close(); }
  const restored = createServer({ directory }, {}, { engine: { async transcribe() { assert.fail("No ASR repeat"); } } }, options); restored.log.level = "silent";
  try {
    assert.deepEqual((await restored.inject(`/uploads/${id}/portfolio/clips`)).json().batch, musical);
    assert.equal((await restored.inject({ method: "POST", url: `/uploads/${id}/portfolio/process`, payload: { style: "EMOTIONAL" } })).json().reused, true);
    assert.equal((await restored.inject({ method: "POST", url: `/uploads/${id}/portfolio/process`, payload: { style: "DYNAMIC" } })).json().reused, true, "Reutiliza também um lote anterior com preferências iguais");
    assert.deepEqual((await restored.inject(`/uploads/${id}/portfolio/clips`)).json().batch, batch, "Consulta acompanha o lote reutilizado, mesmo quando há outro mais recente");
    assert.equal((await restored.inject(`/uploads/${id}/clips`)).statusCode, 409);
    const file = `/uploads/${id}/clips/${batch.batchId}/${batch.clips[0].id}/file`; assert.equal((await restored.inject({ url: file, headers: { range: "bytes=0-31" } })).statusCode, 206);
    const unsafe = structuredClone(batch.clips[0].editPlan); unsafe.timeline[0].outputEnd = 900; assert.throws(() => validateEditPlan(unsafe));
  } finally { await restored.close(); }
  assert.ok((await lstat(join(outputs, id, batch.batchId, batch.clips[0].file))).isFile());
});
