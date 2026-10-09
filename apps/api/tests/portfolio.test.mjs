import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTranscript } from "../dist/features/transcription/services/normalize-transcript.js";
import { speechUnits } from "../dist/features/analysis/services/speech-units.js";
import { PortfolioAnalysisProvider, PORTFOLIO_VERSION, selectPortfolio, textSimilarity } from "../dist/features/portfolio/services/portfolio-provider.js";
import { emotionSignals, hookScore, storyArc } from "../dist/features/portfolio/services/emotion-signals.js";
import { parseAudioSignals } from "../dist/features/portfolio/services/audio-signals.js";
import { parseReport, parseCandidate, persistAnalysis, readAnalysis } from "../dist/features/analysis/services/analysis-persistence.js";
import { overlap } from "../dist/features/analysis/services/select-candidates.js";

const signal = new AbortController().signal;
function fixture(duration = 240) {
  const lines = ["Por que 3 escolhas mudam o resultado?", "Quando eu comecei, aprendi porque precisava de coragem.", "O primeiro exemplo mostra uma decisão clara.", "Mas o segundo resultado surpreende muita gente.", "Portanto, aprendi a construir um caminho melhor.", "A bicicleta elétrica oferece transporte eficiente para cidades.", "A receita mistura vegetais frescos e sabor natural.", "A astronomia explica estrelas distantes com medidas precisas."];
  const segments = [];
  for (let start = 0; start < duration; start += 10) {
    const text = lines[segments.length % lines.length], tokens = text.split(" "), end = Math.min(duration, start + 9);
    segments.push({ start, end, text, words: tokens.map((word, index) => ({ word, start: start + index * (end - start) / tokens.length, end: start + (index + 1) * (end - start) / tokens.length })) });
  }
  return normalizeTranscript({ language: "pt", duration, segments });
}
const provider = new PortfolioAnalysisProvider();
test("portfólio cobre durações, preserva famílias entre perfis e audita cada decisão", async () => {
  const input = { uploadId: "fixture", transcript: fixture() }, report = await provider.analyze(input, signal);
  assert.deepEqual(parseReport(report), report);
  const other = await provider.analyze(input, signal);
  assert.deepEqual(other.candidates, report.candidates);
  assert.ok(report.candidates.length > 3);
  for (const profile of ["micro", "short", "standard", "extended"]) assert.ok(report.portfolio[profile].length > 0, profile);
  assert.ok(report.portfolio.families.some(family => family.profiles.length > 1));
  assert.equal(report.portfolio.metrics.raw, report.generatedCount);
  assert.equal(report.generatedCount, report.rejectedCount + report.deduplicatedCount + report.candidates.length);
  assert.ok(report.portfolio.audit.some(entry => entry.decision === "duplicate" && entry.overlap >= .82));
  for (const entry of report.candidates) {
    assert.ok(/[.!?]$/u.test(entry.transcript)); assert.ok(entry.duration <= 180);
    assert.equal(entry.potentialScore, entry.score.value);
  }
  for (let i = 0; i < report.candidates.length; i++) for (let j = i + 1; j < report.candidates.length; j++) {
    const a = report.candidates[i], b = report.candidates[j]; if (a.profile === b.profile) assert.ok(overlap(a, b) < .82);
  }
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(provider.analyze(input, aborted.signal));
});
test("quantidade e diversidade respeitam qualidade; máximo mantém variações úteis", async () => {
  const report = await provider.analyze({ uploadId: "fixture", transcript: fixture() }, signal);
  const auto = selectPortfolio(report), few = selectPortfolio(report, "few"), maximum = selectPortfolio(report, "maximum");
  assert.ok(auto.length > 3); assert.ok(few.length <= auto.length);
  assert.ok(new Set(auto.map(candidate => candidate.profile)).size >= 3);
  assert.ok(auto.every(candidate => candidate.score.value >= 46));
  assert.equal(maximum.length, report.candidates.length);
  assert.equal(textSimilarity(["one", "two"], ["two", "three"]), 1 / 3);
  const poor = structuredClone(report); poor.candidates.forEach(candidate => { candidate.score.value = 39; });
  assert.deepEqual(selectPortfolio(poor, "maximum"), []);
});
test("não aprova pool composto apenas por CTAs, transições ou fala sem fechamento", async () => {
  const transcript = fixture(100);
  for (const segment of transcript.segments) {
    segment.words.forEach((word, index) => { word.word = index === 0 ? "Inscreva-se" : index === segment.words.length - 1 ? "canal." : "like"; });
    segment.text = segment.words.map(word => word.word).join(" ");
  }
  const report = await provider.analyze({ uploadId: "promo", transcript }, signal);
  assert.equal(report.candidates.length, 0);
  assert.ok(report.portfolio.audit.some(entry => entry.reasons.some(reason => reason.includes("CTA"))));
  assert.deepEqual(report.portfolio.rankings.funniest, []);
});
test("emoção lexical tem evidência; energia é medição separada; hook usa primeiros 3 segundos", () => {
  const units = speechUnits(fixture(50)), audio = { available: true, method: "ffmpeg-astats-0.5s", windows: [{ start: 0, end: .5, rmsDb: -20, peakDb: -5 }, { start: .5, end: 1, rmsDb: -40, peakDb: -25 }] };
  const result = emotionSignals(units, 50, audio);
  assert.ok(result.semantic.labels.some(label => label.name === "inspiration" && label.evidence.length));
  assert.equal(result.confidence.semantic, .45); assert.equal(result.audio.meanRmsDb, -30); assert.equal(result.audio.peakDb, -5); assert.equal(result.audio.quietRatio, .5); assert.equal(result.visual.available, false);
  const number = result.events.find(event => event.kind === "number"); assert.equal(number.start, units[0].words[2].start);
  assert.ok(hookScore(units).value > hookScore([{ ...units[0], text: "Isso", words: [{ word: "Isso", start: 0, end: 1 }] }]).value);
  assert.equal(storyArc(units).confidence, .2);
  assert.equal(storyArc([units[1], { ...units[2], text: "Depois fui entender o resultado." }, units[4]]).confidence, .65);
  const unavailable = emotionSignals(units, 50, { available: false, method: audio.method, windows: [] }); assert.equal(unavailable.audio.meanRmsDb, null);
});
test("astats aceita silêncio real, rejeita métricas inválidas e delimita última janela", () => {
  const audio = parseAudioSignals("frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=-inf\nlavfi.astats.Overall.Peak_level=-inf\nframe:1 pts:8000 pts_time:0.5\nlavfi.astats.Overall.RMS_level=-20\nlavfi.astats.Overall.Peak_level=-3", .8);
  assert.equal(audio.windows[0].rmsDb, -120); assert.equal(audio.windows[1].end, .8);
  assert.throws(() => parseAudioSignals("frame:0 pts:0 pts_time:0\nlavfi.astats.Overall.RMS_level=NaN", 1));
});
test("persistência de portfólio é independente, versionada e recusa extras inválidos", async () => {
  const report = await provider.analyze({ uploadId: "fixture", transcript: fixture() }, signal);
  const directory = await mkdtemp(join(tmpdir(), "clipador-portfolio-"));
  await writeFile(join(directory, "analysis.json"), "preserve legacy");
  await persistAnalysis(directory, "source", "transcript", report, () => {}, signal, "portfolio.json");
  assert.deepEqual(await readAnalysis(directory, "source", "transcript", PORTFOLIO_VERSION, "portfolio.json"), report);
  assert.equal(await readAnalysis(directory, "source", "transcript", "new", "portfolio.json"), null);
  assert.equal(await readFile(join(directory, "analysis.json"), "utf8"), "preserve legacy");
  assert.ok(!(await readdir(directory)).some(name => name.endsWith(".part")));
  const invalid = structuredClone(report.candidates[0]); delete invalid.profile; assert.throws(() => parseCandidate(invalid));
  const corrupt = structuredClone(report); corrupt.portfolio.micro.push("c_0000000000000000"); assert.throws(() => parseReport(corrupt));
});
