import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTranscript } from "../dist/features/transcription/services/normalize-transcript.js";
import { LocalAnalysisProvider } from "../dist/features/analysis/services/local-provider.js";
import { speechUnits, adjustBounds, sentenceEnd } from "../dist/features/analysis/services/speech-units.js";
import { scoreCandidate } from "../dist/features/analysis/services/score-candidate.js";
import { overlap, suppressOverlap, selectCandidates } from "../dist/features/analysis/services/select-candidates.js";
import { persistAnalysis, readAnalysis, digest } from "../dist/features/analysis/services/analysis-persistence.js";
import { ANALYSIS_VERSION } from "../dist/features/analysis/contracts.js";

export function speechFixture(duration = 150) {
  const texts = ["Por que três escolhas mudam o resultado?", "Quando eu comecei, aprendi porque precisava de coragem.", "O primeiro exemplo mostra uma decisão clara.", "Mas o segundo resultado surpreende muita gente.", "Portanto, aprendi a construir um caminho melhor."];
  const segments = [];
  for (let start = 0; start < duration; start += 10) {
    const text = texts[(start / 10) % texts.length], tokens = text.split(" ");
    const end = Math.min(duration, start + 9);
    segments.push({ id: segments.length, start, end, text, words: tokens.map((word, i) => ({ word, start: start + i * (end - start) / tokens.length, end: start + (i + 1) * (end - start) / tokens.length, probability: null })) });
  }
  return normalizeTranscript({ language: "pt", duration, segments });
}
const provider = new LocalAnalysisProvider(), signal = new AbortController().signal;
test("frases, segmentos, pausas e bordas preservam palavras sem divisão fixa", () => {
  const transcript = speechFixture(), units = speechUnits(transcript);
  assert.equal(units.length, 15); assert.deepEqual(units[0].segmentIds, [0]);
  const bound = adjustBounds(units, 1, 5, transcript.duration);
  assert.ok(bound.start <= units[1].start && bound.start > units[0].end);
  assert.ok(bound.end >= units[5].end && bound.end < units[6].start);
  const pause = normalizeTranscript({ language: "pt", duration: 5, segments: [{ id: 0, start: 0, end: 5, text: "Uma ideia outra ideia", words: [
    { word: "Uma", start: 0, end: .5 }, { word: "ideia", start: .5, end: 1 }, { word: "outra", start: 3, end: 4 }, { word: "ideia", start: 4, end: 5 } ] }] });
  assert.equal(speechUnits(pause).length, 2);
  assert.equal(sentenceEnd("Uma ideia..."), false); assert.equal(sentenceEnd("Uma ideia…"), false);
  const overlapping = [ { ...units[0], end: 11 }, { ...units[1], start: 10, end: 20 }, { ...units[2], start: 19 } ];
  assert.deepEqual(adjustBounds(overlapping, 1, 1, 30), { start: 10, end: 20 });
});
test("candidatos limitados, completos, determinísticos e com contrato explicável", async () => {
  const input = { uploadId: "fixture", transcript: speechFixture(1500) };
  const report = await provider.analyze(input, signal);
  assert.deepEqual(await provider.analyze(input, signal), report);
  assert.ok(report.generatedCount <= 120); assert.ok(report.candidates.length > 0); assert.ok(report.deduplicatedCount > 0);
  for (const candidate of report.candidates) {
    assert.ok(candidate.duration >= 30 && candidate.duration <= 90);
    assert.ok(/[.!?]$/.test(candidate.transcript)); assert.equal(candidate.score.dimensions.length, 10); assert.equal(candidate.score.penalties.length, 8);
    assert.ok(candidate.segmentIds.length > 1); assert.equal(candidate.suggestedCTA, undefined);
  }
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(provider.analyze(input, aborted.signal));
});
test("score reproduz a soma documentada e penaliza contexto, repetição, silêncio e fim incompleto", () => {
  const good = scoreCandidate(speechUnits(speechFixture(50)), 49);
  const sum = good.dimensions.reduce((total, item) => total + item.value * item.weight, 0) - good.penalties.reduce((total, item) => total + item.value * item.weight, 0);
  assert.equal(good.value, Math.round(Math.max(0, Math.min(100, sum)) * 100) / 100);
  const units = speechUnits(speechFixture(50));
  const bad = [{ ...units[0], text: "Isso então repetição repetição repetição", words: [{ word: "Isso", start: 0, end: 1 }, { word: "repetição", start: 20, end: 21 }, { word: "repetição", start: 40, end: 41 }] }];
  const score = scoreCandidate(bad, 60);
  for (const name of ["missingContext", "unfinishedThought", "excessiveSilence", "repetition", "weakEnding"]) assert.ok(score.penalties.find(item => item.name === name).value > 0, name);
  assert.ok(score.value < good.value);
  assert.ok(scoreCandidate(units, 10).penalties.find(item => item.name === "tooShort").value > 0);
  assert.ok(scoreCandidate(units, 110).penalties.find(item => item.name === "tooLong").value > 0);
});
test("supressão mantém melhor duplicado; seleção evita sobreposição e limita a três", async () => {
  const report = await provider.analyze({ uploadId: "fixture", transcript: speechFixture() }, signal);
  const base = report.candidates[0];
  const worse = { ...base, id: "worse", score: { ...base.score, value: 0 } };
  assert.equal(overlap(base, worse), 1); assert.deepEqual(suppressOverlap([worse, base]), [base]);
  const selected = selectCandidates(report.candidates, 3); assert.ok(selected.length >= 1 && selected.length <= 3);
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) assert.ok(overlap(selected[i], selected[j]) <= .15);
  assert.throws(() => selectCandidates(report.candidates, 4));
});
test("persistência íntegra, cache por versão, checksum e cleanup do parcial", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clipador-analysis-"));
  const report = await provider.analyze({ uploadId: "fixture", transcript: speechFixture() }, signal);
  let reservation = 0;
  await persistAnalysis(directory, "source", "transcript", report, bytes => { reservation = bytes; }, signal);
  assert.ok(reservation > 0); assert.deepEqual(await readdir(directory), ["analysis.json"]);
  assert.deepEqual(await readAnalysis(directory, "source", "transcript", ANALYSIS_VERSION), report);
  assert.equal(await readAnalysis(directory, "source", "transcript", "new-version"), null);
  const path = join(directory, "analysis.json"), envelope = JSON.parse(await readFile(path, "utf8"));
  envelope.report.candidates[0].score.value = 99;
  await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(readAnalysis(directory, "source", "transcript", ANALYSIS_VERSION), { code: "INVALID_ANALYSIS" });
  envelope.checksum = digest(envelope.report); envelope.report.candidates[0].end = -1; envelope.checksum = digest(envelope.report);
  await writeFile(path, JSON.stringify(envelope)); await assert.rejects(readAnalysis(directory, "source", "transcript", ANALYSIS_VERSION));
});
