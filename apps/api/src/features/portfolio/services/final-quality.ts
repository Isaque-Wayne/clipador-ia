import type { CutCandidate } from "../../analysis/candidate.js";
import { plain } from "../../analysis/services/local-signals.js";
import { sentenceEnd } from "../../analysis/services/speech-units.js";

export const FINAL_SELECTION_VERSION = "final-quality-1.0.0";
export const MAX_FINAL_CLIPS = 20;
export function maxFinalClips(environment: NodeJS.ProcessEnv = process.env): number {
  const raw = environment["MAX_FINAL_CLIPS"];
  if (raw === undefined) return MAX_FINAL_CLIPS;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error("MAX_FINAL_CLIPS deve ser um inteiro entre 1 e 100.");
  return value;
}
export interface FinalQuality {
  candidateId: string; renderEligible: boolean; finalScore: number; hookScore: number;
  standaloneClarity: number; endingQuality: number; contextDependency: number; repetition: number;
  overlap: number; reasons: string[];
}
export function parseFinalQuality(value: unknown): FinalQuality {
  if (typeof value !== "object" || value === null) throw new Error("Invalid final quality");
  const quality = value as FinalQuality;
  if (!/^c_[a-f0-9]{16}$/.test(quality.candidateId) || typeof quality.renderEligible !== "boolean"
    || ![quality.finalScore, quality.hookScore, quality.standaloneClarity, quality.endingQuality].every(number => Number.isFinite(number) && number >= 0 && number <= 100)
    || ![quality.contextDependency, quality.repetition, quality.overlap].every(number => Number.isFinite(number) && number >= 0 && number <= 1)
    || !Array.isArray(quality.reasons) || !quality.reasons.every(reason => typeof reason === "string" && reason.length <= 1000)) throw new Error("Invalid quality metrics");
  return quality;
}
/** Auditable local signals, not semantic certainty or a prediction of virality. */
export function evaluateFinalCandidate(candidate: CutCandidate): FinalQuality {
  const dimension = (name: string) => candidate.score.dimensions.find(item => item.name === name)?.value ?? 0;
  const penalty = (name: string) => candidate.score.penalties.find(item => item.name === name)?.value ?? 0;
  const hook = candidate.hookScore?.value ?? dimension("hookStrength") * 100;
  const clarity = dimension("standaloneClarity") * 100, ending = dimension("conclusionQuality") * 100;
  const context = penalty("missingContext"), repetition = penalty("repetition");
  const text = plain(candidate.transcript.trim());
  const opening = plain((candidate.hook ?? candidate.transcript.split(/(?<=[!?])\s+|(?<=\.)\s+(?=\p{L})/u)[0] ?? "").trim());
  const openingWords = opening.match(/[\p{L}\p{N}]+/gu) ?? [];
  const contextualOpening = openingWords.length < 4 || /^(?:qual\??|o que e isso|porque e isso|as minhas|os meus|sao de|ai |montinho aqui|fala[, ]|oi[, ]|ola[, ]|que eu |so que |isso[, ]|ele[, ]|ela[, ]|esse[, ]|essa[, ]|entao[, ])/u.test(opening);
  const deadOpening = /^(?:ta bom|entao vamos la|vamos la|ahn|ehh+|eee+)(?:\b|$)/u.test(text);
  const incomplete = !sentenceEnd(candidate.transcript) || /(?:\bporque|\bmas|\bentao|\be)\s*[.!?]?$/u.test(text);
  const finalScore = Math.round(Math.max(0, .21 * hook + .20 * clarity + .17 * ending
    + 13 * dimension("retentionPotential") + 12 * dimension("informationValue")
    + 8 * dimension("emotion") + 9 * (1 - context)
    - 20 * penalty("slowStart") - 28 * context - 18 * repetition
    - 24 * penalty("unfinishedThought") - 18 * penalty("weakEnding") - (deadOpening ? 20 : 0) - (incomplete ? 25 : 0)) * 100) / 100;
  const reasons = [
    ...(candidate.score.value < 50 || finalScore < 58 ? ["Score final insuficiente para render (original ≥50 e final ≥58)."] : []),
    ...(hook < 35 ? ["Hook insuficiente nos primeiros três segundos (mínimo 35)."] : []),
    ...(clarity < 75 || context > .25 || contextualOpening ? ["Abertura dependente de contexto, fragmentária ou pouco clara."] : []),
    ...(ending < 70 || incomplete ? ["Fechamento incompleto ou insatisfatório."] : []),
    ...(repetition > .5 ? ["Repetição excessiva."] : []),
    ...(dimension("informationValue") < .5 ? ["Pouca evidência local de valor informativo."] : []),
    ...(deadOpening ? ["Introdução de transição sem hook autônomo."] : []),
  ];
  return { candidateId: candidate.id, renderEligible: !reasons.length, finalScore, hookScore: hook,
    standaloneClarity: clarity, endingQuality: ending, contextDependency: context, repetition, overlap: 0, reasons };
}
