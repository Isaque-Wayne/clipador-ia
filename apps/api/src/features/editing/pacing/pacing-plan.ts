import type { CutCandidate } from "../../analysis/candidate.js";
import type { Transcript } from "../../transcription/types/transcript.js";
import type { AudioSignals } from "../../portfolio/types.js";
import type { EditStyle, PacingPlan } from "../types.js";
export function planPacing(candidate: CutCandidate, transcript: Transcript, audio: AudioSignals | undefined, style: EditStyle): PacingPlan {
  const calm = ["STORY", "EMOTIONAL", "CLEAN"].includes(style);
  const plan: PacingPlan = { visualTempo: calm ? "calm" : style === "DYNAMIC" ? "brisk" : "balanced", maxEffectsPerMinute: calm ? 2 : 4, minZoomGap: calm ? 15 : 8, minShotDuration: calm ? 3 : 2, pauses: [] };
  const words = transcript.segments.flatMap(segment => segment.words).filter(word => word.start >= candidate.start && word.end <= candidate.end);
  let removed = 0, previousCutEnd = candidate.start;
  for (let index = 1; index < words.length; index++) {
    const previous = words[index - 1]!, next = words[index]!;
    if (next.start - previous.end < .8) continue;
    const start = previous.end + .22, end = next.start - .22;
    const measured = audio?.windows.filter(window => window.start < end && window.end > start) ?? [];
    const quiet = audio?.available === true && measured.length > 0 && measured[0]!.start <= start && measured.at(-1)!.end >= end
      && measured.every((window, index) => window.rmsDb <= -38 && (index === 0 || window.start <= measured[index - 1]!.end + .001));
    const emotional = candidate.emotion?.events.some(event => ["emotion", "question", "conclusion"].includes(event.kind) && event.start < next.start && event.end >= previous.start) ?? false;
    const trim = !calm && !emotional && quiet && end - start >= .6 && removed + end - start <= candidate.duration * .2
      && start - previousCutEnd >= plan.minShotDuration && candidate.end - end >= plan.minShotDuration;
    plan.pauses.push({ start: trim ? start : previous.end, end: trim ? end : next.start, action: trim ? "trim" : "preserve",
      reason: trim ? "Pausa entre palavras, silêncio medido <= -38 dBFS; respiração de 220 ms preservada nas bordas." : calm ? "Preservar respiração narrativa/estilo calmo." : emotional ? "Pausa próxima de evento textual emocional, pergunta ou conclusão." : "Sem evidência objetiva suficiente de pausa morta; preservada." });
    if (trim) { removed += end - start; previousCutEnd = end; }
  }
  return plan;
}
