import type { Transcript } from "../../transcription/types/transcript.js";
import type { CutCandidate } from "../../analysis/candidate.js";
export interface SubtitleCue { start: number; end: number; text: string }
export function buildCues(transcript: Transcript, candidate: Pick<CutCandidate, "start" | "end">): SubtitleCue[] {
  const words = transcript.segments.flatMap(segment => segment.words).filter(word => word.end > candidate.start && word.start < candidate.end);
  const cues: SubtitleCue[] = [];
  let group: typeof words = [];
  function flush() {
    const first = group[0], last = group.at(-1);
    if (first && last) {
      const start = Math.max(0, first.start - candidate.start), end = Math.min(candidate.end - candidate.start, last.end - candidate.start);
      if (end > start) cues.push({ start, end, text: group.map(word => word.word).join(" ") });
    }
    group = [];
  }
  for (const word of words) {
    const previous = group.at(-1);
    if (group.length >= 5 || (previous && word.start - previous.end > .5) || (group.length && [...group.map(item => item.word), word.word].join(" ").length > 32)) flush();
    group.push(word);
    if (/[.!?]$/u.test(word.word)) flush();
  }
  flush();
  return cues;
}
