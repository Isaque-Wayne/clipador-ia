import type { CutCandidate } from "../../analysis/candidate.js";
import type { Transcript } from "../../transcription/types/transcript.js";
import type { VideoInspection } from "../../video-preparation/types/inspection.js";
import type { AudioSignals } from "../../portfolio/types.js";
import { EDIT_PLAN_VERSION } from "../types.js";
import type { EditPlan, EditStyle, ZoomEvent } from "../types.js";
import { planPacing } from "../pacing/pacing-plan.js";
import { buildTimeline, outputTime } from "./timeline.js";
import { buildCaptionPlan } from "../captions/caption-plan.js";
import { SafeFramingProvider } from "../framing/framing-provider.js";
export function chooseStyle(candidate: CutCandidate, requested: EditStyle): Exclude<EditStyle, "AUTO"> {
  if (requested !== "AUTO") return requested;
  if (candidate.profile === "micro") return "DYNAMIC";
  if ((candidate.storyArc?.confidence ?? 0) >= .4 && candidate.profile === "extended") return "STORY";
  if (candidate.emotion?.semantic.labels.some(label => ["vulnerability", "tension", "inspiration"].includes(label.name))) return "EMOTIONAL";
  if (candidate.emotion?.events.some(event => ["number", "list"].includes(event.kind))) return "EDUCATIONAL";
  return "CLEAN";
}
export function buildEditPlan(candidate: CutCandidate, transcript: Transcript, inspection: VideoInspection, audio?: AudioSignals, requested: EditStyle = "AUTO"): EditPlan {
  const style = chooseStyle(candidate, requested), pacing = planPacing(candidate, transcript, audio, style);
  const silenceCuts = pacing.pauses.filter(pause => pause.action === "trim").map(({ start, end, reason }) => ({ start, end, reason }));
  const timeline = buildTimeline(candidate.start, candidate.end, silenceCuts), outputDuration = timeline.at(-1)?.outputEnd ?? 0;
  const zoomEvents: ZoomEvent[] = [];
  if (style !== "CLEAN") for (const event of candidate.emotion?.events ?? []) {
    if (!["number", "question", "strong-statement", "emotion"].includes(event.kind)) continue;
    const start = outputTime(event.start, timeline); if (start === null || start + 1 > outputDuration || start - (zoomEvents.at(-1)?.end ?? -99) < pacing.minZoomGap) continue;
    if (zoomEvents.length >= Math.max(1, Math.ceil(outputDuration / 60 * pacing.maxEffectsPerMinute))) break;
    zoomEvents.push({ start, end: Math.min(outputDuration, start + (style === "DYNAMIC" ? 1.5 : 2)), intensity: style === "DYNAMIC" ? .08 : .045, focus: { x: .5, y: .5 }, reason: event.reason });
  }
  const emphasisEvents = (candidate.emotion?.events ?? []).flatMap(event => { const start = outputTime(event.start, timeline), end = outputTime(event.end, timeline); return start !== null && end !== null ? [{ ...event, start, end }] : []; });
  const bRollEvents = emphasisEvents.filter(event => event.kind === "number" && /\b(iphone|computador|carro|livro|ouro)\b/iu.test(event.text)).slice(0, 2).map(event => ({ start: event.start, end: Math.min(event.end, event.start + 3), query: event.text.slice(0, 120), purpose: "illustrate" as const, importance: .4 }));
  return { version: EDIT_PLAN_VERSION, clipId: candidate.id, analysisVersion: candidate.score.method, style,
    sourceRange: { start: candidate.start, end: candidate.end }, renderProfile: "vertical-social", outputDuration, timeline, pacing,
    framing: new SafeFramingProvider().resolve(inspection, "vertical-social"), captions: buildCaptionPlan(transcript, timeline, style), zoomEvents, emphasisEvents, bRollEvents,
    music: { requested: ["STORY", "EMOTIONAL"].includes(style), mood: style === "STORY" ? "cinematic" : "emotional", intensity: "low", volume: .06, start: 0, end: outputDuration, fadeIn: .5, fadeOut: .8,
      ducking: { threshold: .03, ratio: 8, attackMs: 15, releaseMs: 300 }, reason: "Música opcional e somente licenciada; prioridade para voz, sem alterar seu ganho." },
    soundEffects: { events: [], requiresLicensedAsset: true }, silenceCuts, transitions: timeline.slice(1).map(span => ({ kind: "cut" as const, at: span.outputStart })) };
}
