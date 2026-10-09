import type { Transcript } from "../../transcription/types/transcript.js";
import type { EditStyle, CaptionGroup, CaptionPlan, TimelineSpan, SafeArea } from "../types.js";
import { outputTime } from "../planning/timeline.js";
export const DEFAULT_SAFE_AREA: SafeArea = { left: .12, right: .18, top: .15, bottom: .24, anchorY: .73 };
export function buildCaptionPlan(transcript: Transcript, timeline: TimelineSpan[], style: EditStyle, safeArea: SafeArea = DEFAULT_SAFE_AREA): CaptionPlan {
  const active = ["DYNAMIC", "EDUCATIONAL", "PODCAST", "EMOTIONAL"].includes(style), groups: CaptionGroup[] = [];
  let words: CaptionGroup["words"] = [];
  function flush() {
    const first = words[0], last = words.at(-1);
    if (first && last && last.end > first.start) groups.push({ start: first.start, end: last.end, words, activeWord: active, emphasis: words.some(word => word.emphasis), position: { x: (safeArea.left + 1 - safeArea.right) / 2, y: safeArea.anchorY }, style: active ? "active" : "clean" });
    words = [];
  }
  for (const word of transcript.segments.flatMap(segment => segment.words)) {
    const start = outputTime(word.start, timeline), end = outputTime(word.end, timeline);
    if (start === null || end === null) continue;
    const previous = words.at(-1);
    if (words.length >= 5 || (previous && start - previous.end > .45) || [...words.map(item => item.text), word.word].join(" ").length > 30) flush();
    words.push({ text: word.word, start, end, emphasis: /\d|\b(nunca|sempre|verdade|primeiro|segundo)\b/iu.test(word.word) });
    if (/[.!?]$/u.test(word.word)) flush();
  }
  flush(); return { version: "caption-plan-1.0.1", safeArea, fontSize: 60, groups };
}
