import { createHash } from "node:crypto";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AnalysisReport } from "../contracts.js";
import type { CutCandidate } from "../candidate.js";
import { SCORE_WEIGHTS, PENALTY_WEIGHTS } from "../scoring.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
import { validatePortfolio, validatePortfolioCandidate } from "../../portfolio/services/validate-portfolio.js";
export const MAX_ANALYSIS_BYTES = 16 * 1024 * 1024;
export type AnalysisFile = "analysis.json" | "portfolio.json";

export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const isCandidateId = (value: string) => /^c_[a-f0-9]{16}$/.test(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function parseCandidate(value: unknown): CutCandidate {
  if (!record(value) || typeof value["id"] !== "string" || !isCandidateId(value["id"])
    || !number(value["start"]) || !number(value["end"]) || !number(value["duration"])
    || value["start"] < 0 || value["end"] <= value["start"] || value["duration"] > 180
    || Math.abs(value["end"] - value["start"] - value["duration"]) > .002
    || !Array.isArray(value["segmentIds"]) || !value["segmentIds"].every(id => Number.isSafeInteger(id) && id >= 0)
    || !Array.isArray(value["reasons"]) || !value["reasons"].every(reason => typeof reason === "string")
    || !["title", "transcript", "reason"].every(key => typeof value[key] === "string") || !record(value["score"])) throw new Error("Invalid candidate");
  const score = value["score"];
  if (!number(score["value"]) || score["value"] < 0 || score["value"] > 100 || score["maximum"] !== 100 || typeof score["method"] !== "string") throw new Error("Invalid score");
  for (const [key, weights] of [["dimensions", SCORE_WEIGHTS], ["penalties", PENALTY_WEIGHTS]] as const) {
    const list = score[key];
    if (!Array.isArray(list) || list.length !== Object.keys(weights).length) throw new Error("Invalid dimensions");
    const names = new Set<string>();
    for (const item of list) {
      if (!record(item) || typeof item["name"] !== "string" || !Object.hasOwn(weights, item["name"])
        || names.has(item["name"]) || !number(item["value"]) || item["value"] < 0 || item["value"] > 1
        || !number(item["weight"]) || item["weight"] <= 0 || typeof item["explanation"] !== "string") throw new Error("Invalid dimension");
      names.add(item["name"]);
    }
  }
  for (const field of ["hook", "topic", "description", "suggestedCTA"] as const) if (value[field] !== undefined && typeof value[field] !== "string") throw new Error("Invalid optional text");
  if (value["hookType"] !== undefined && !["question", "contrast", "statement"].includes(String(value["hookType"]))) throw new Error("Invalid hook");
  if (value["hashtags"] !== undefined && (!Array.isArray(value["hashtags"]) || !value["hashtags"].every(tag => typeof tag === "string"))) throw new Error("Invalid hashtags");
  if (["profile", "familyId", "objective", "potentialScore", "hookScore", "emotion", "storyArc", "standaloneQuality", "topicTokens"].some(key => value[key] !== undefined)) validatePortfolioCandidate(value);
  // All fields in this boundary have been checked; no unvalidated object is exposed to the service.
  return value as unknown as CutCandidate;
}
export function parseReport(value: unknown): AnalysisReport {
  if (!record(value) || typeof value["analysisVersion"] !== "string" || !Array.isArray(value["candidates"]) || value["candidates"].length > 1280
    || !["generatedCount", "deduplicatedCount", "rejectedCount"].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) >= 0)) throw new Error("Invalid analysis report");
  const candidates = value["candidates"].map(parseCandidate);
  if (new Set(candidates.map(item => item.id)).size !== candidates.length) throw new Error("Duplicate candidate");
  return { analysisVersion: value["analysisVersion"], generatedCount: Number(value["generatedCount"]), deduplicatedCount: Number(value["deduplicatedCount"]), rejectedCount: Number(value["rejectedCount"]), candidates,
    ...(value["portfolio"] !== undefined ? { portfolio: validatePortfolio(value["portfolio"], candidates) } : {}) };
}
export async function removeAnalysisPartial(directory: string, name: AnalysisFile = "analysis.json") {
  const path = join(directory, `${name}.part`);
  try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe analysis partial"); await unlink(path); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
}
export async function readAnalysis(directory: string, sourceHash: string, transcriptHash: string, version: string, name: AnalysisFile = "analysis.json"): Promise<AnalysisReport | null> {
  try {
    const path = join(directory, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_ANALYSIS_BYTES) throw new Error("Unsafe analysis");
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!record(value) || value["schemaVersion"] !== 1 || value["sourceHash"] !== sourceHash || value["transcriptHash"] !== transcriptHash || digest(value["report"]) !== value["checksum"]) throw new Error("Corrupt analysis");
    const report = parseReport(value["report"]);
    return report.analysisVersion === version ? report : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw new ProcessingError("INVALID_ANALYSIS", "Análise persistida inválida ou corrompida.", 409);
  }
}
export async function persistAnalysis(directory: string, sourceHash: string, transcriptHash: string, report: AnalysisReport, reserve: (bytes: number) => void, signal: AbortSignal, name: AnalysisFile = "analysis.json") {
  parseReport(report);
  const data = JSON.stringify({ schemaVersion: 1, sourceHash, transcriptHash, checksum: digest(report), report });
  if (Buffer.byteLength(data) > MAX_ANALYSIS_BYTES) throw new ProcessingError("ANALYSIS_TOO_LARGE", "Análise excedeu o limite de armazenamento.");
  reserve(Buffer.byteLength(data) * 2);
  await removeAnalysisPartial(directory, name);
  const partial = join(directory, `${name}.part`), file = await open(partial, "wx", 0o600);
  try { await file.writeFile(data); await file.sync(); await file.close(); signal.throwIfAborted(); await rename(partial, join(directory, name)); }
  finally { await file.close(); await removeAnalysisPartial(directory, name); }
}
