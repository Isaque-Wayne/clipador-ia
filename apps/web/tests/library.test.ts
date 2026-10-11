import assert from "node:assert/strict";
import test from "node:test";
import { parseProjects, parseDetail, parseUsage, formatBytes } from "../src/features/library/services/library-api";
const id = "11111111-1111-4111-8111-111111111111", batch = "22222222-2222-4222-8222-222222222222";
const project = { id, title: "Projeto salvo", origin: "YouTube", thumbnail: null, duration: 3600, createdAt: "2026-10-09T12:00:00.000Z", status: "completed", active: false, originalBytes: 100, outputBytes: 200, totalBytes: 300, clipCount: 24, hasTranscript: true, hasAnalysis: true, warnings: [] };
test("lista aceita projetos persistidos e rejeita IDs/contagens/status malformados", () => {
  assert.equal(parseProjects([project])[0]?.id, id);
  for (const altered of [{ id: "../outside" }, { totalBytes: -1 }, { clipCount: NaN }, { status: "invented" }, { thumbnail: "javascript:alert(1)" }]) assert.throws(() => parseProjects([{ ...project, ...altered }]));
});
test("24 cortes históricos mantêm lote e URL interna; path externo é rejeitado", () => {
  const clips = Array.from({ length: 24 }, (_, index) => { const candidate = `c_${index.toString(16).padStart(16, "0")}`; return { id: candidate, batchId: batch, title: `Corte ${index + 1}`, duration: 15, score: 60, profile: "micro", family: null, style: "CLEAN", status: "completed", size: 100, checksum: "a".repeat(64), createdAt: project.createdAt, url: `/api/uploads/${id}/clips/${batch}/${candidate}/file` }; });
  const detail = { ...project, originalUrl: `/api/projects/${id}/original`, metadata: {}, clips, candidates: [], transcript: { language: "pt", text: "Fala salva.", segments: [] } };
  assert.equal(parseDetail(detail).clips.length, 24);
  assert.throws(() => parseDetail({ ...detail, clips: [{ ...clips[0], url: "../../outside.mp4" }] }));
});
test("quota oferece dados reais e números inválidos são rejeitados", () => {
  const error = { code: "OUTPUT_QUOTA", message: "Não há espaço reservado suficiente.", usedBytes: 200, limitBytes: 300, requiredBytes: 150, projectCount: 4 };
  assert.equal(parseProjects([{ ...project, error }])[0]?.error?.requiredBytes, 150);
  assert.throws(() => parseProjects([{ ...project, error: { ...error, requiredBytes: -1 } }]));
  const usage = { originalBytes: 100, artifactBytes: 5, temporaryBytes: 0, outputBytes: 200, totalBytes: 305, uploadUsedBytes: 105, outputUsedBytes: 200, uploadLimitBytes: 1000, outputLimitBytes: 500, freeDiskBytes: 9999, unclassifiedBytes: 0, projectCount: 1, warnings: [] };
  assert.equal(parseUsage(usage).totalBytes, 305); assert.throws(() => parseUsage({ ...usage, outputLimitBytes: NaN })); assert.equal(formatBytes(1024 ** 3), "1 GiB");
});
