import { adjustBounds, sentenceEnd } from "../../analysis/services/speech-units.js";
import type { SpeechUnit } from "../../analysis/services/speech-units.js";
import { plain } from "../../analysis/services/local-signals.js";

/** Only isolated fillers are removed. Never discard a causal connective or a content word. */
export function refineSpeechWindow(units: SpeechUnit[], first: number, last: number, duration: number, maxDuration: number) {
  let finish = last;
  const startUnit = units[first];
  if (!startUnit) throw new Error("Missing speech boundary");
  while (finish + 1 < units.length && !sentenceEnd(units[finish]?.text ?? "")) {
    const next = units[finish + 1];
    if (!next || next.end - (units[last]?.end ?? next.end) > 6 || next.end - startUnit.start > maxDuration - .3) break;
    finish++;
  }
  const selected = units.slice(first, finish + 1).map(unit => ({ ...unit, words: [...unit.words] }));
  const opening = selected[0]!;
  while (opening.words.length > 3) {
    const word = opening.words[0]!, next = opening.words[1]!;
    if (!/^(?:ahn|ah|hum|ehh+|eee+|eé+|bom[,!]|olha[,!])[,!.]*$/u.test(plain(word.word)) || next.start - startUnit.start > 3) break;
    opening.words.shift(); opening.start = next.start; opening.text = opening.words.map(item => item.word).join(" ");
  }
  const bounds = adjustBounds(units, first, finish, duration);
  if (opening.start > startUnit.start) bounds.start = Math.round(Math.max(bounds.start, opening.start - .12) * 1000) / 1000;
  return { selected, bounds };
}
