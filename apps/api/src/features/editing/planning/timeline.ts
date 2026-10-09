import type { TimelineSpan } from "../types.js";
export function buildTimeline(start: number, end: number, cuts: { start: number; end: number }[]): TimelineSpan[] {
  const spans: TimelineSpan[] = []; let sourceStart = start, outputStart = 0;
  for (const cut of [...cuts, { start: end, end }]) {
    if (cut.start < sourceStart || cut.end < cut.start || cut.end > end) throw new Error("Corte de silêncio fora de ordem ou limites.");
    if (cut.start > sourceStart) { const outputEnd = outputStart + cut.start - sourceStart; spans.push({ sourceStart, sourceEnd: cut.start, outputStart, outputEnd }); outputStart = outputEnd; }
    sourceStart = cut.end;
  }
  return spans;
}
export function outputTime(time: number, timeline: TimelineSpan[]): number | null {
  const span = timeline.find(item => time >= item.sourceStart - .00001 && time <= item.sourceEnd + .00001);
  return span ? Math.max(span.outputStart, Math.min(span.outputEnd, span.outputStart + time - span.sourceStart)) : null;
}
