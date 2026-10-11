import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { AnalysisInput, AnalysisProvider, AnalysisReport } from "../../analysis/contracts.js";
import { speechUnits } from "../../analysis/services/speech-units.js";
import { localSignals, plain } from "../../analysis/services/local-signals.js";
import { scoreCandidate } from "../../analysis/services/score-candidate.js";
import { overlap } from "../../analysis/services/select-candidates.js";
import { emotionSignals, hookScore, storyArc } from "./emotion-signals.js";
import { selectFinalPortfolio } from "./final-selection.js";
import { refineSpeechWindow } from "./refine-boundaries.js";
import { DURATION_PROFILES } from "../types.js";
import type { DurationProfile, PortfolioCandidate, ClipPortfolio, QuantityMode } from "../types.js";
export const PORTFOLIO_VERSION = "portfolio-local-1.1.1";
const id = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
export function textSimilarity(a: string[], b: string[]) { const first = new Set(a), second = new Set(b); const union = new Set([...first, ...second]); return union.size ? [...first].filter(token => second.has(token)).length / union.size : 0; }
export class PortfolioAnalysisProvider implements AnalysisProvider {
  readonly analysisVersion = PORTFOLIO_VERSION;
  async analyze(input: AnalysisInput, signal: AbortSignal): Promise<AnalysisReport> {
    const started = performance.now(), units = speechUnits(input.transcript), candidates: PortfolioCandidate[] = [], audit: ClipPortfolio["audit"] = [];
    const audio = input.audio ?? { available: false, method: "ffmpeg-astats-0.5s" as const, windows: [], reason: "Medição de áudio não disponível." };
    const stride = Math.max(1, Math.ceil(units.length / 160));
    for (let first = 0; first < units.length; first += stride) {
      signal.throwIfAborted(); const begin = units[first]; if (!begin) continue;
      const familyId = `f_${id(`${input.uploadId}:${begin.start}`)}`;
      for (const profile of Object.keys(DURATION_PROFILES) as DurationProfile[]) {
        const range = DURATION_PROFILES[profile], endings: { last: number; distance: number }[] = [];
        for (let last = first; last < units.length; last++) {
          const end = units[last]; if (!end) continue;
          const duration = end.end - begin.start;
          if (duration > Math.min(179.7, range.max * 1.15)) break;
          if (duration >= range.min * .85) endings.push({ last, distance: Math.abs(duration - range.target) });
        }
        for (const ending of endings.sort((a, b) => a.distance - b.distance).slice(0, 2)) {
          const { selected, bounds } = refineSpeechWindow(units, first, ending.last, input.transcript.duration, range.max);
          const duration = Math.round((bounds.end - bounds.start) * 1000) / 1000;
          if (duration < range.min || duration > range.max) continue;
          const signals = localSignals(selected, duration), score = scoreCandidate(selected, duration, range); score.method = PORTFOLIO_VERSION;
          const hook = hookScore(selected), emotion = emotionSignals(selected, duration, audio), arc = storyArc(selected);
          const clarity = score.dimensions.find(item => item.name === "standaloneClarity")?.value ?? 0;
          const reasons = score.dimensions.filter(item => item.value >= .65).map(item => item.explanation);
          const candidate: PortfolioCandidate = { id: `c_${id(`${PORTFOLIO_VERSION}:${input.uploadId}:${profile}:${bounds.start}:${bounds.end}`)}`, ...bounds, duration,
            familyId, profile, objective: range.objective, potentialScore: score.value, score, hookScore: hook, emotion, storyArc: arc,
            standaloneQuality: clarity * 100, topicTokens: [...new Set(plain(signals.text).match(/[\p{L}\p{N}]{5,}/gu) ?? [])].slice(0, 50),
            title: selected[0]?.text.split(/\s+/u).slice(0, 9).join(" ") ?? "Trecho", transcript: signals.text, segmentIds: [...new Set(selected.flatMap(unit => unit.segmentIds))],
            hook: selected[0]?.text ?? "", hookType: signals.question ? "question" : signals.contrast ? "contrast" : "statement",
            reason: `${range.objective}. ${reasons.slice(0, 2).join(" ")}`, reasons };
          const promotionalWords = selected.filter(unit => /\b(canal|inscrev\w*|like\w*|seguidor|rede social|arroba\w*)\b/u.test(plain(unit.text))).reduce((sum, unit) => sum + unit.words.length, 0);
          const weakOpening = /^(ta bom|entao vamos la|vamos la)(?:\b|$)/u.test(plain(selected[0]?.text ?? ""));
          const rejection = [...(!signals.completeEnding ? ["Fechamento sem pontuação conclusiva."] : []), ...(clarity < .6 ? ["Abertura dependente de contexto anterior."] : []),
            ...(weakOpening ? ["Abertura de transição/acknowledgement sem ideia autônoma."] : []), ...(promotionalWords / Math.max(1, signals.words.length) >= .5 ? ["Predomínio de promoção do canal/CTA, sem conteúdo suficiente para um clip autônomo."] : []),
            ...(score.value < 40 ? ["Score abaixo do piso de qualidade local (40)."] : []), ...(signals.words.length < (profile === "micro" ? 6 : 15) ? ["Pouca fala útil para este objetivo."] : [])];
          audit.push({ candidateId: candidate.id, profile, start: bounds.start, end: bounds.end, score: score.value, decision: rejection.length ? "rejected" : "approved", reasons: rejection.length ? rejection : ["Frases completas e critérios mínimos locais atendidos."] });
          if (!rejection.length) candidates.push(candidate);
        }
      }
    }
    const kept: PortfolioCandidate[] = [];
    for (const candidate of candidates.sort((a, b) => b.score.value - a.score.value || b.hookScore.value - a.hookScore.value || a.start - b.start
      || Math.abs(a.duration - DURATION_PROFILES[a.profile].target) - Math.abs(b.duration - DURATION_PROFILES[b.profile].target)
      || a.end - b.end || a.profile.localeCompare(b.profile) || a.id.localeCompare(b.id))) {
      const duplicate = kept.find(previous => previous.profile === candidate.profile && overlap(previous, candidate) >= .82);
      if (duplicate) {
        const entry = audit.find(item => item.candidateId === candidate.id && item.decision === "approved");
        if (entry) { entry.decision = "duplicate"; entry.overlapWith = duplicate.id; entry.overlap = overlap(duplicate, candidate); entry.reasons = ["Sobreposição alta dentro do mesmo perfil/objetivo; mantida a melhor versão."]; }
      } else kept.push(candidate);
    }
    const buckets = Object.fromEntries((Object.keys(DURATION_PROFILES) as DurationProfile[]).map(profile => [profile, kept.filter(item => item.profile === profile).map(item => item.id)])) as Record<DurationProfile, string[]>;
    const families = [...new Set(kept.map(item => item.familyId))].map(familyId => { const members = kept.filter(item => item.familyId === familyId); return { id: familyId, anchor: members[0]?.start ?? 0, candidateIds: members.map(item => item.id), profiles: [...new Set(members.map(item => item.profile))] }; });
    const ranked = (filter: (item: PortfolioCandidate) => boolean, value: (item: PortfolioCandidate) => number) => kept.filter(filter).sort((a, b) => value(b) - value(a) || a.start - b.start).map(item => item.id);
    const portfolio: ClipPortfolio = { version: PORTFOLIO_VERSION, sourceDuration: input.transcript.duration, ...buckets, families,
      highlights: ranked(item => item.hookScore.value >= 50, item => item.hookScore.value), bestOverall: kept.map(item => item.id),
      rankings: { strongestHook: ranked(item => item.hookScore.value >= 40, item => item.hookScore.value),
        mostEmotional: ranked(item => item.emotion.semantic.labels.length > 0, item => Math.max(...item.emotion.semantic.labels.map(label => label.strength))),
        mostEducational: ranked(item => item.score.dimensions.some(dimension => dimension.name === "informationValue" && dimension.value >= .65), item => item.score.value),
        funniest: ranked(item => item.emotion.semantic.labels.some(label => label.name === "humor"), item => item.score.value),
        mostShareable: ranked(item => item.hookScore.value >= 50 && item.standaloneQuality >= 80, item => item.score.value), bestMicro: buckets.micro, bestLongForm: buckets.extended },
      audit, audio, metrics: { raw: audit.length, valid: candidates.length, approved: kept.length, rejected: audit.filter(item => item.decision === "rejected").length, duplicates: candidates.length - kept.length, families: families.length, analysisSeconds: (performance.now() - started) / 1000 } };
    return { analysisVersion: PORTFOLIO_VERSION, generatedCount: audit.length, deduplicatedCount: portfolio.metrics.duplicates, rejectedCount: portfolio.metrics.rejected, candidates: kept, portfolio };
  }
}
export function selectPortfolio(report: AnalysisReport, quantity: QuantityMode = "auto"): PortfolioCandidate[] {
  return selectFinalPortfolio(report, quantity).candidates;
}
