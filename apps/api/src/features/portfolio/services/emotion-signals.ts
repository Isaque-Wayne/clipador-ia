import type { SpeechUnit } from "../../analysis/services/speech-units.js";
import { plain, clamp, localSignals } from "../../analysis/services/local-signals.js";
import type { AudioSignals, EmotionName, EmotionSignals, EmphasisEvent, HookScore, StoryArc } from "../types.js";
const vocabulary: Record<EmotionName, RegExp> = {
  enthusiasm: /\b(incrivel|fantastico|animado|empolgado)\b/u, surprise: /\b(surpresa|surpreende|inesperado|nao acreditava)\b/u,
  humor: /\b(risos|hahaha|piada|engracado)\b/u, tension: /\b(medo|perigo|risco|tensao)\b/u,
  indignation: /\b(absurdo|injustica|revoltante|indignado)\b/u, inspiration: /\b(sonho|coragem|conquistei|aprendi|superar)\b/u,
  curiosity: /\b(por que|como funciona|descobrir|imagine)\b/u, vulnerability: /\b(sofri|chorei|vergonha|fracassei|perdi)\b/u,
  confidence: /\b(certeza|consegui|domino|acredito|me tornei)\b/u, energy: /\b(vamos la|acao|energia|agora)\b/u,
  urgency: /\b(urgente|agora|imediatamente|antes que|nao espere)\b/u, reflection: /\b(pense|refletir|aprendi|na minha vida|veja so)\b/u,
};
export function emotionSignals(units: SpeechUnit[], duration: number, audio: AudioSignals): EmotionSignals {
  const signals = localSignals(units, duration), text = plain(signals.text);
  const labels = (Object.entries(vocabulary) as [EmotionName, RegExp][]).flatMap(([name, pattern]) => {
    const evidence = units.filter(unit => pattern.test(plain(unit.text))).map(unit => unit.text).slice(0, 3);
    return evidence.length ? [{ name, strength: Math.min(.8, .4 + evidence.length * .1), evidence }] : [];
  });
  const start = units[0]?.start ?? 0, end = units.at(-1)?.end ?? start;
  const windows = audio.windows.filter(window => window.start < end && window.end > start);
  const rms = windows.map(window => window.rmsDb).sort((a, b) => a - b);
  const events: EmphasisEvent[] = [];
  for (const unit of units) {
    const normalized = plain(unit.text);
    const meaningfulQuestion = unit.text.includes("?") && !/\b(ta|ta bom|ne)\??[.!?]*$/u.test(normalized);
    const kinds: [EmphasisEvent["kind"], boolean, string][] = [
      ["question", meaningfulQuestion, "Interrogação de conteúdo observada na frase."], ["contrast", /\b(mas|porem|apesar|ao contrario)\b/u.test(normalized), "Marcador de contraste."],
      ["number", /\d/u.test(normalized), "Número explícito na fala."], ["list", /\b(primeiro|segundo|terceiro)\b/u.test(normalized), "Marcador de lista."],
      ["conclusion", /\b(portanto|por isso|no fim|resumindo)\b/u.test(normalized), "Marcador lexical de conclusão."],
      ["strong-statement", /\b(nunca|sempre|verdade|milionario|mudou)\b/u.test(normalized), "Vocabulário de afirmação forte; inferência lexical."],
      ["emotion", labels.some(label => label.evidence.includes(unit.text)), "Vocabulário emocional explícito; não mede emoção real."],
    ];
    for (const [kind, match, reason] of kinds) if (match) {
      const pattern = kind === "number" ? /\d/u : kind === "strong-statement" ? /\b(nunca|sempre|verdade|milionario|mudou)\b/u
        : kind === "list" ? /\b(primeiro|segundo|terceiro)\b/u : kind === "contrast" ? /\b(mas|porem|apesar|ao contrario)\b/u
          : kind === "conclusion" ? /\b(portanto|por isso|no fim|resumindo)\b/u : kind === "question" ? /\b(por que|como|qual|quem|quando|onde|voce sabe)\b/u : null;
      let cue = unit.words[0], cueEnd = cue?.end ?? unit.end;
      for (let index = 0; index < unit.words.length; index++) {
        const words = unit.words.slice(index, index + 3), excerpt = plain(words.map(word => word.word).join(" "));
        const single = plain(unit.words[index]?.word ?? "");
        if (pattern ? pattern.test(single) || pattern.test(excerpt) && !pattern.test(plain(words.slice(1).map(word => word.word).join(" ")))
          : (Object.values(vocabulary).some(expression => expression.test(single) || expression.test(excerpt) && !expression.test(plain(words.slice(1).map(word => word.word).join(" ")))))) {
          cue = unit.words[index]; cueEnd = pattern?.test(single) ? cue?.end ?? unit.end : words.at(-1)?.end ?? unit.end; break;
        }
      }
      events.push({ start: cue?.start ?? unit.start, end: cueEnd, kind, text: unit.text, strength: kind === "question" || kind === "number" ? .75 : .55, reason });
    }
  }
  return { semantic: { method: "lexical-portuguese", labels }, audio: { available: audio.available && windows.length > 0,
    meanRmsDb: windows.length ? windows.reduce((sum, window) => sum + window.rmsDb, 0) / windows.length : null,
    peakDb: windows.length ? Math.max(...windows.map(window => window.peakDb)) : null,
    dynamicsDb: rms.length ? (rms[Math.floor((rms.length - 1) * .9)] ?? 0) - (rms[Math.floor((rms.length - 1) * .1)] ?? 0) : null,
    speechWordsPerSecond: signals.density, quietRatio: windows.length ? windows.filter(window => window.rmsDb < -38).length / windows.length : null },
    visual: { available: false, reason: "Imagem não analisada; não há detector visual nesta fase." },
    confidence: { semantic: labels.length ? .45 : 0, audio: windows.length ? 1 : 0, note: "Confiança de evidência lexical/disponibilidade de medição, não probabilidade científica de emoção." }, events };
}
export function hookScore(units: SpeechUnit[]): HookScore {
  const first = units[0]; if (!first) return { value: 0, windowSeconds: 3, evidence: [], dimensions: [] };
  const opening = units.flatMap(unit => unit.words).filter(word => word.start < first.start + 3).map(word => word.word).join(" ");
  const text = plain(opening), s = localSignals([first], Math.max(.1, first.end - first.start));
  const dimensions = [
    { name: "clarity", value: s.dependentStart ? .15 : .85, weight: 30 }, { name: "question", value: /\?|\b(por que|como|voce sabe)\b/u.test(text) ? 1 : 0, weight: 20 },
    { name: "curiosity", value: /\b(descobri|aprendi|segredo|imagine)\b/u.test(text) ? 1 : 0, weight: 15 },
    { name: "surpriseConflict", value: /\b(mas|nunca|impossivel|surpresa)\b/u.test(text) ? 1 : 0, weight: 15 },
    { name: "specificity", value: /\d|\b(primeiro|segundo|milionario)\b/u.test(text) ? 1 : 0, weight: 10 },
    { name: "promise", value: /\b(vou explicar|vai aprender|como fazer)\b/u.test(text) ? 1 : 0, weight: 10 },
  ];
  return { value: Math.round(clamp(dimensions.reduce((sum, item) => sum + item.value * item.weight, 0) / 100) * 10000) / 100, windowSeconds: 3,
    evidence: [opening, ...dimensions.filter(item => item.value >= .8).map(item => item.name)], dimensions };
}
export function storyArc(units: SpeechUnit[]): StoryArc {
  const setup = units.find(unit => /\b(quando eu|eu comecei|eu com|um dia|anos|na epoca)\b/u.test(plain(unit.text)));
  const development = setup && units.find(unit => unit.start > setup.start && /\b(entao|porque|fui|comecei|depois)\b/u.test(plain(unit.text)));
  const payoff = development && units.find(unit => unit.start > development.start && /\b(aprendi|consegui|me tornei|resultado|portanto)\b/u.test(plain(unit.text)));
  return { ...(setup ? { setup: setup.start } : {}), ...(development ? { development: development.start } : {}), ...(payoff ? { payoff: payoff.start } : {}),
    confidence: payoff ? .65 : development ? .4 : setup ? .2 : 0, evidence: [setup, development, payoff].flatMap(unit => unit ? [unit.text] : []) };
}
