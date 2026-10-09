import type { CutCandidate } from "../candidate.js";
export function overlap(a: Pick<CutCandidate, "start" | "end">, b: Pick<CutCandidate, "start" | "end">): number {
  const intersection = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  return intersection / Math.min(a.end - a.start, b.end - b.start);
}
export function ranked(candidates: CutCandidate[]) {
  return [...candidates].sort((a, b) => b.score.value - a.score.value || a.start - b.start || a.id.localeCompare(b.id));
}
export function suppressOverlap(candidates: CutCandidate[], threshold = .7): CutCandidate[] {
  const kept: CutCandidate[] = [];
  for (const candidate of ranked(candidates)) if (!kept.some(previous => overlap(candidate, previous) >= threshold)) kept.push(candidate);
  return kept;
}
export function selectCandidates(candidates: CutCandidate[], limit = 3): CutCandidate[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error("Selecione de um a três cortes.");
  const kept: CutCandidate[] = [];
  for (const candidate of ranked(candidates)) {
    if (!kept.some(previous => overlap(candidate, previous) > .15)) kept.push(candidate);
    if (kept.length >= limit) break;
  }
  return kept;
}
