import assert from "node:assert/strict";
import test from "node:test";
import { processingRequest, parseProcessingStatus, parseClipCards } from "../src/features/processing/services/processing-api.ts";
const id = "d980f6a4-4f49-4a89-8974-bdf95a27c7bb";
test("processamento distingue falha do backend de indisponibilidade da API", async t => {
  const signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: false, code: "NO_AUDIO", message: "Vídeo sem áudio." }, { status: 422 }));
  await assert.rejects(processingRequest(id, "process", "POST", signal), { code: "NO_AUDIO", message: "Vídeo sem áudio." });
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(processingRequest(id, "process", "POST", signal), { code: "API_UNAVAILABLE" });
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => new Response("proxy offline", { status: 502 }));
  await assert.rejects(processingRequest(id, "process", "POST", signal), { code: "API_UNAVAILABLE" });
});
test("status valida estágio e progresso; cards constroem URLs locais e recusam dados inválidos", () => {
  assert.equal(parseProcessingStatus({ uploadId: id, stage: "rendering-clips", renderedCount: 1, selectedCount: 2 }, id).renderedCount, 1);
  assert.throws(() => parseProcessingStatus({ uploadId: id, stage: "fake", renderedCount: 100 }, id));
  const value = { uploadId: id, batchId: id, clips: [{ id: "c_0123456789abcdef", status: "completed", duration: 45, url: "https://evil.test", candidate: { title: "Trecho", reason: "Explicação", score: { value: 65 } } }] };
  const cards = parseClipCards(value, id); assert.match(cards[0]!.url, /^\/api\/uploads\//); assert.ok(!cards[0]!.url.includes("evil"));
  assert.throws(() => parseClipCards({ ...value, batchId: "../escape" }, id));
  assert.throws(() => parseClipCards({ ...value, clips: [{ ...value.clips[0], candidate: { title: "x", reason: "x", score: { value: NaN } } }] }, id));
});
test("portfólio aceita muitos clips, novos estágios e scores distintos com limites seguros", () => {
  assert.equal(parseProcessingStatus({ uploadId: id, stage: "planning-edits", selectedCount: 16 }, id).selectedCount, 16);
  assert.equal(parseProcessingStatus({ uploadId: id, stage: "resolving-assets" }, id).stage, "resolving-assets");
  assert.throws(() => parseProcessingStatus({ uploadId: id, stage: "rendering-clips", selectedCount: 1281 }, id));
  const clips = Array.from({ length: 16 }, (_, index) => ({ id: `c_${index.toString(16).padStart(16, "0")}`, status: "completed", duration: 14, editPlan: { style: "DYNAMIC" }, candidate: { title: "Trecho", reason: "Explicação", score: { value: 65, dimensions: [{ name: "informationValue", value: .7 }] }, profile: "micro", familyId: "f_0123456789abcdef", hookScore: { value: 45 }, emotion: { semantic: { labels: [{ name: "curiosity", strength: .5 }] } } } }));
  const batch = { uploadId: id, batchId: id, clips }, cards = parseClipCards(batch, id);
  assert.equal(cards.length, 16); assert.equal(cards[0]!.profile, "micro"); assert.equal(cards[0]!.hookScore, 45); assert.equal(cards[0]!.emotionalStrength, .5); assert.equal(cards[0]!.educationalScore, .7); assert.equal(cards[0]!.editStyle, "DYNAMIC");
  const corrupt = structuredClone(batch); corrupt.clips[0]!.candidate.hookScore.value = Infinity; assert.throws(() => parseClipCards(corrupt, id));
});
