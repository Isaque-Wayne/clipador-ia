import type { AnalysisReport } from "../../analysis/contracts.js";
import { overlap } from "../../analysis/services/select-candidates.js";
import type { DurationProfile, PortfolioCandidate, QuantityMode } from "../types.js";
import { evaluateFinalCandidate, FINAL_SELECTION_VERSION, maxFinalClips } from "./final-quality.js";
import type { FinalQuality } from "./final-quality.js";

export interface FinalSelectionSummary {
  version: typeof FINAL_SELECTION_VERSION; limit: number; analyzed: number; evaluated: number;
  qualityPassed: number; duplicatesRemoved: number; selected: number;
  distribution: Record<DurationProfile, number>;
}
export interface SelectionAudit extends FinalQuality { decision: "quality-rejected" | "duplicate" | "selected" | "budget"; overlapWith?: string }
const PROFILES: DurationProfile[] = ["micro", "short", "standard", "extended"];
const SHARE = { micro: .225, short: .275, standard: .325, extended: .175 };
function similarity(a: string[], b: string[]) {
  const first = new Set(a), second = new Set(b), union = new Set([...first, ...second]);
  return union.size ? [...first].filter(token => second.has(token)).length / union.size : 0;
}
function distinctUses(a: PortfolioCandidate, b: PortfolioCandidate) {
  const small = a.duration < b.duration ? a : b, large = small === a ? b : a;
  return small.profile === "micro" && small.duration <= 20.5 && large.duration >= 40 && large.duration >= small.duration * 2.2
    && overlap(a, b) >= .8 && large.end - small.end >= 15;
}
function conflicting(candidate: PortfolioCandidate, previous: PortfolioCandidate[]) {
  const moments = previous.filter(item => item.familyId === candidate.familyId || overlap(item, candidate) >= .5);
  if (moments.length >= 2) return moments[0];
  return moments.find(item => !distinctUses(item, candidate))
    ?? previous.find(item => overlap(item, candidate) > .25 && similarity(item.topicTokens, candidate.topicTokens) >= .8);
}
export function selectFinalPortfolio(report: AnalysisReport, quantity: QuantityMode = "auto", limit = maxFinalClips()) {
  if (!report.portfolio || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid final selection input");
  const budget = Math.min(limit, quantity === "few" ? 6 : quantity === "normal" ? 12 : quantity === "auto" ? Math.max(1, Math.ceil(report.portfolio.sourceDuration / 45)) : limit);
  const audit: SelectionAudit[] = report.candidates.map(candidate => ({ ...evaluateFinalCandidate(candidate), decision: "quality-rejected" }));
  const lookup = new Map(audit.map(entry => [entry.candidateId, entry]));
  const quality = report.candidates.filter((candidate): candidate is PortfolioCandidate => candidate.profile !== undefined && Boolean(lookup.get(candidate.id)?.renderEligible))
    .sort((a, b) => (lookup.get(b.id)?.finalScore ?? 0) - (lookup.get(a.id)?.finalScore ?? 0) || b.hookScore.value - a.hookScore.value || a.start - b.start || a.end - b.end || a.profile.localeCompare(b.profile) || a.id.localeCompare(b.id));
  // Deduplicate the entire eligible pool first, so the audit does not conflate duplicates with the cap.
  const unique: PortfolioCandidate[] = [];
  for (const candidate of quality) {
    const entry = lookup.get(candidate.id)!;
    const duplicate = conflicting(candidate, unique);
    if (duplicate) { entry.decision = "duplicate"; entry.renderEligible = false; entry.overlap = overlap(candidate, duplicate); entry.overlapWith = duplicate.id; entry.reasons.push("Mesmo momento/fala; mantida a melhor versão, no máximo micro + ideia desenvolvida."); }
    else { unique.push(candidate); entry.decision = "budget"; }
  }
  const selected: PortfolioCandidate[] = [], distribution = { micro: 0, short: 0, standard: 0, extended: 0 };
  const remaining = new Set(unique), topics = new Set<string>(), emotions = new Set<string>(), hooks = new Set<string>(), temporal = new Set<number>();
  while (selected.length < budget && remaining.size) {
    let best: PortfolioCandidate | undefined, bestValue = -Infinity;
    for (const candidate of remaining) {
      const bucket = Math.min(9, Math.floor(candidate.start / report.portfolio.sourceDuration * 10));
      const mostOverlap = Math.max(0, ...selected.map(item => overlap(candidate, item)));
      const topicOverlap = Math.max(0, ...selected.map(item => similarity(candidate.topicTokens, item.topicTokens)));
      const novelTopic = candidate.topicTokens.some(token => !topics.has(token));
      const value = lookup.get(candidate.id)!.finalScore + (distribution[candidate.profile] < budget * SHARE[candidate.profile] ? 6 : 0)
        + (temporal.has(bucket) ? 0 : 5) + (hooks.has(candidate.hookType ?? "statement") ? 0 : 2)
        + (candidate.emotion.semantic.labels.some(label => !emotions.has(label.name)) ? 2 : 0) + (novelTopic ? 1 : 0)
        - mostOverlap * 18 - topicOverlap * 8;
      if (!best || value > bestValue) { best = candidate; bestValue = value; }
    }
    if (!best) break;
    remaining.delete(best); selected.push(best); distribution[best.profile]++;
    lookup.get(best.id)!.decision = "selected";
    temporal.add(Math.min(9, Math.floor(best.start / report.portfolio.sourceDuration * 10)));
    best.topicTokens.forEach(token => topics.add(token)); best.emotion.semantic.labels.forEach(label => emotions.add(label.name)); hooks.add(best.hookType ?? "statement");
  }
  const summary: FinalSelectionSummary = { version: FINAL_SELECTION_VERSION, limit, analyzed: report.generatedCount, evaluated: report.candidates.length,
    qualityPassed: quality.length, duplicatesRemoved: audit.filter(entry => entry.decision === "duplicate").length, selected: selected.length, distribution };
  return { candidates: selected, summary, audit };
}
export function validateSelectionSummary(value: unknown): FinalSelectionSummary {
  if (typeof value !== "object" || value === null) throw new Error("Invalid selection summary");
  const summary = value as FinalSelectionSummary;
  if (summary.version !== FINAL_SELECTION_VERSION || ![summary.limit, summary.analyzed, summary.evaluated, summary.qualityPassed, summary.duplicatesRemoved, summary.selected, ...PROFILES.map(profile => summary.distribution?.[profile])].every(number => Number.isSafeInteger(number) && number >= 0)
    || summary.limit < 1 || summary.limit > 100 || summary.analyzed < summary.evaluated || summary.evaluated < summary.qualityPassed || summary.duplicatesRemoved > summary.qualityPassed
    || summary.selected > summary.limit || summary.selected > summary.qualityPassed - summary.duplicatesRemoved || PROFILES.reduce((sum, profile) => sum + summary.distribution[profile], 0) !== summary.selected) throw new Error("Invalid selection counts");
  return summary;
}
