import { createHash } from "node:crypto";
import type { AnalysisProvider, AnalysisInput, AnalysisReport } from "../contracts.js";
import { ANALYSIS_VERSION } from "../contracts.js";
import type { CutCandidate } from "../candidate.js";
import { speechUnits, adjustBounds } from "./speech-units.js";
import { scoreCandidate } from "./score-candidate.js";
import { localSignals } from "./local-signals.js";
import { suppressOverlap } from "./select-candidates.js";

export class LocalAnalysisProvider implements AnalysisProvider {
  readonly analysisVersion = ANALYSIS_VERSION;
  async analyze(input: AnalysisInput, signal: AbortSignal): Promise<AnalysisReport> {
    const units = speechUnits(input.transcript);
    const candidates: CutCandidate[] = [];
    let rejectedCount = 0;
    const stride = Math.max(1, Math.ceil(units.length / 40));
    for (let first = 0; first < units.length; first += stride) {
      signal.throwIfAborted();
      const begin = units[first]; if (!begin) continue;
      const endings: { last: number; distance: number }[] = [];
      for (let last = first; last < units.length; last++) {
        const finish = units[last]; if (!finish) continue;
        const duration = finish.end - begin.start;
        if (duration > 89.7) { rejectedCount++; break; }
        if (duration >= 30 || (input.transcript.duration < 30 && first === 0 && last === units.length - 1))
          endings.push({ last, distance: Math.abs(duration - 57.5) });
      }
      // At most three complete/pause-delimited endings per sampled sentence start.
      for (const choice of endings.sort((a, b) => a.distance - b.distance || a.last - b.last).slice(0, 3)) {
        const selected = units.slice(first, choice.last + 1);
        const bounds = adjustBounds(units, first, choice.last, input.transcript.duration);
        const duration = Math.round((bounds.end - bounds.start) * 1000) / 1000;
        if (duration <= 0 || duration > 90) { rejectedCount++; continue; }
        const signals = localSignals(selected, duration);
        const score = scoreCandidate(selected, duration);
        const reasons = score.dimensions.filter(item => item.value >= .65).map(item => item.explanation);
        const id = "c_" + createHash("sha256").update(`${ANALYSIS_VERSION}:${input.uploadId}:${bounds.start}:${bounds.end}`).digest("hex").slice(0, 16);
        candidates.push({ id, ...bounds, duration, title: selected[0]?.text.split(/\s+/u).slice(0, 9).join(" ") ?? "Trecho de fala",
          transcript: signals.text, segmentIds: [...new Set(selected.flatMap(unit => unit.segmentIds))], score,
          reason: reasons.slice(0, 2).join(" ") || "Trecho delimitado por frases e pausas observadas.",
          reasons, hook: selected[0]?.text ?? "", hookType: signals.question ? "question" : signals.contrast ? "contrast" : "statement" });
      }
    }
    const unique = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()];
    const kept = suppressOverlap(unique);
    return { analysisVersion: ANALYSIS_VERSION, generatedCount: unique.length,
      deduplicatedCount: unique.length - kept.length, rejectedCount, candidates: kept };
  }
}
