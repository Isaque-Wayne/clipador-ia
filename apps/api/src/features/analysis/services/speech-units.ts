import type { Transcript, TranscriptWord } from "../../transcription/types/transcript.js";
export interface SpeechUnit { start: number; end: number; text: string; segmentIds: number[]; words: TranscriptWord[] }
export const sentenceEnd = (text: string) => !/(?:\.{2,}|…)[\x22\x27”’)]?$/u.test(text.trim()) && /[.!?][\x22\x27”’)]?$/u.test(text.trim());
export function speechUnits(transcript: Transcript): SpeechUnit[] {
  const units: SpeechUnit[] = [];
  let words: TranscriptWord[] = [], ids = new Set<number>();
  function flush() {
    const first = words[0], last = words.at(-1);
    if (first && last && last.end > first.start) units.push({
      start: first.start, end: last.end, text: words.map(word => word.word).join(" "),
      segmentIds: [...ids], words,
    });
    words = []; ids = new Set();
  }
  for (const segment of transcript.segments) {
    for (const word of segment.words) {
      const previous = words.at(-1);
      // A pause is an observed boundary, not a fixed time window.
      if (previous && word.start - previous.end >= 1.2) flush();
      words.push(word); ids.add(segment.id);
      if (sentenceEnd(word.word)) flush();
    }
  }
  flush();
  return units;
}
export function adjustBounds(units: SpeechUnit[], first: number, last: number, duration: number) {
  const begin = units[first], finish = units[last];
  if (!begin || !finish) throw new Error("Bordas sem unidades de fala.");
  const previous = units[first - 1], next = units[last + 1];
  const before = previous ? (previous.end <= begin.start ? (previous.end + begin.start) / 2 : begin.start) : 0;
  const after = next ? (next.start >= finish.end ? (finish.end + next.start) / 2 : finish.end) : duration;
  const start = Math.max(0, begin.start - .12, before);
  const end = Math.min(duration, finish.end + .18, after);
  return { start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 };
}
