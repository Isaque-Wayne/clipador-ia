import { SCORE_WEIGHTS, PENALTY_WEIGHTS } from "../scoring.js";
import type { CandidateScore, CriterionName, PenaltyName } from "../scoring.js";
import { ANALYSIS_VERSION } from "../contracts.js";
import type { SpeechUnit } from "./speech-units.js";
import { clamp, localSignals } from "./local-signals.js";

export function scoreCandidate(units: SpeechUnit[], duration: number, range = { min: 30, max: 90 }): CandidateScore {
  const s = localSignals(units, duration);
  const density = clamp(s.density / 2.5);
  const hook = clamp(.25 + Number(s.question) * .35 + Number(s.contrast) * .2 + Number(s.numbers) * .2);
  const clarity = s.dependentStart ? .25 : .85;
  const conclusion = s.completeEnding ? (s.conclusion ? 1 : .7) : .1;
  const values: Record<CriterionName, [number, string]> = {
    hookStrength: [hook, "Interrogação na abertura, contraste e números são sinais textuais de atenção."],
    standaloneClarity: [clarity, s.dependentStart ? "A abertura contém referência dependente de contexto." : "Não foi detectada referência dependente na abertura."],
    informationValue: [clamp(.25 + Number(s.causal) * .4 + Number(s.numbers) * .35), "Conectivos causais, exemplos e números observados."],
    curiosity: [s.question ? 1 : s.contrast ? .5 : .15, "Interrogação e contraste; não representa compreensão semântica."],
    emotion: [s.emotion ? .85 : .1, "Presença de vocabulário emocional da lista documentada."],
    storytelling: [s.story ? .9 : .15, "Expressões locais de experiência passada ou sequência narrativa."],
    surprise: [s.contrast ? .75 : .1, "Marcadores de contraste observados no texto."],
    retentionPotential: [(hook + clarity + density + conclusion) / 4, "Média dos sinais de abertura, clareza, densidade e fechamento."],
    conclusionQuality: [conclusion, "Pontuação final e marcador de conclusão na última frase."],
    speechDensity: [density, "Palavras por segundo divididas por 2,5, limitadas a 1."],
  };
  const penalties: Record<PenaltyName, [number, string]> = {
    slowStart: [s.fillerStart || s.firstWordCount > 45 ? .6 : 0, "Abertura com preenchimento ou frase inicial muito longa."],
    missingContext: [s.dependentStart ? 1 : 0, "Pronome ou conectivo dependente no começo."],
    unfinishedThought: [s.completeEnding ? 0 : .8, "Ausência de pontuação conclusiva no fechamento."],
    excessiveSilence: [clamp((s.silenceRatio - .3) / .4), "Proporção de lacunas observadas entre palavras acima de 30%."],
    repetition: [clamp((s.repetition - .3) / .4), "Repetição de tokens com mais de três caracteres acima de 30%."],
    weakEnding: [conclusion < .5 ? .7 : 0, "Fechamento sem sinal de conclusão ou pontuação."],
    tooShort: [clamp((range.min - duration) / Math.max(1, range.min * 2 / 3)), `Duração abaixo da orientação de ${range.min} segundos.`],
    tooLong: [clamp((duration - range.max) / Math.max(1, range.max / 3)), `Duração acima da orientação de ${range.max} segundos.`],
  };
  const dimensions = (Object.keys(SCORE_WEIGHTS) as CriterionName[]).map(name => ({
    name, value: Math.round(values[name][0] * 1000) / 1000, weight: SCORE_WEIGHTS[name], explanation: values[name][1],
  }));
  const deductions = (Object.keys(PENALTY_WEIGHTS) as PenaltyName[]).map(name => ({
    name, value: Math.round(penalties[name][0] * 1000) / 1000, weight: PENALTY_WEIGHTS[name], explanation: penalties[name][1],
  }));
  const sum = dimensions.reduce((total, item) => total + item.value * item.weight, 0)
    - deductions.reduce((total, item) => total + item.value * item.weight, 0);
  return { value: Math.round(Math.max(0, Math.min(100, sum)) * 100) / 100, maximum: 100,
    dimensions, penalties: deductions, method: ANALYSIS_VERSION };
}
