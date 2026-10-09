import type { SpeechUnit } from "./speech-units.js";
import { sentenceEnd } from "./speech-units.js";
export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const plain = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
export function localSignals(units: SpeechUnit[], duration: number) {
  const text = units.map(unit => unit.text).join(" "), normalized = plain(text);
  const first = plain(units[0]?.text ?? ""), last = units.at(-1)?.text ?? "";
  const words = units.flatMap(unit => unit.words);
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const substantive = tokens.filter(token => token.length > 3);
  const repetition = substantive.length ? clamp(1 - new Set(substantive).size / substantive.length) : 0;
  let silence = 0, longestPause = 0;
  for (let i = 1; i < words.length; i++) {
    const previous = words[i - 1], current = words[i];
    if (previous && current) {
      const gap = Math.max(0, current.start - previous.end);
      silence += gap; longestPause = Math.max(longestPause, gap);
    }
  }
  const dependentStart = /^(e |mas |entao |por isso |isso |ele |ela |eles |elas |esse |essa |aquele |aquela )/u.test(first);
  const fillerStart = /^(bom[, ]|ahn[, ]|eh[, ]|tipo[, ]|na verdade[, ]|entao[, ])/u.test(first);
  const question = first.includes("?");
  const contrast = /\b(mas|porem|contudo|apesar|na verdade|ao contrario)\b/u.test(normalized);
  const numbers = /\d|\b(primeiro|segundo|terceiro|tres|dois|dez|cem|mil)\b/u.test(normalized);
  const causal = /\b(porque|portanto|por exemplo|significa|precisa|aprendi|resultado)\b/u.test(normalized);
  const story = /\b(eu aprendi|eu comecei|quando eu|um dia|aconteceu|na epoca|anos atras)\b/u.test(normalized);
  const emotion = /\b(medo|sonho|feliz|triste|dor|amo|vergonha|coragem|orgulho|frustracao)\b/u.test(normalized);
  const conclusion = /\b(portanto|conclusao|por isso|assim|o resultado|no fim|aprendi|resumindo)\b/u.test(plain(last));
  return { text, words, dependentStart, fillerStart, question, contrast, numbers, causal, story, emotion, conclusion,
    completeEnding: sentenceEnd(last), repetition, silenceRatio: clamp(silence / Math.max(duration, .01)), longestPause,
    density: words.length / Math.max(duration, .01), firstWordCount: units[0]?.words.length ?? 0 };
}
