import type { CutCandidate } from "../analysis/candidate.js";
import { escapeAss } from "../clip-rendering/subtitles/ass.js";
export function shortHeadline(candidate: CutCandidate) {
  const choices = [candidate.title, candidate.hook, candidate.transcript];
  const text = choices.find(value => value && escapeAss(value).split(/\s+/).length >= 2) ?? candidate.transcript;
  const clean = escapeAss(text).replace(/^(?:já que|então|olha só)[, ]+/iu, "");
  const clause = clean.split(/[,;:]/u)[0] ?? clean;
  const selected = (clause.split(/\s+/).length >= 2 ? clause : clean).split(/\s+/).slice(0, 6);
  while (selected.length > 2 && /^(?:e|mas|ou|de|do|da|dos|das|o|a|um|uma|que|na|no|para|com|por)$/iu.test(selected.at(-1) ?? "")) selected.pop();
  return selected.join(" ").slice(0, 64).trim();
}
export function fitHeadline(text: string, width: number, preferred = 82) {
  const words = text.split(/\s+/).filter(Boolean);
  for (let fontSize = preferred; fontSize >= 64; fontSize -= 2) {
    const lines: string[] = []; let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (next.length * fontSize * .58 > width && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    const estimatedTextWidth = Math.max(...lines.map(value => value.length * fontSize * .58), 0);
    if (lines.length <= 3 && estimatedTextWidth <= width) return { text, lines, fontSize, estimatedTextWidth };
  }
  throw new Error("Headline não cabe na área segura; é necessário texto mais curto.");
}
