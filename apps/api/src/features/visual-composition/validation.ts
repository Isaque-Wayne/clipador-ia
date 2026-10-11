import { record } from "../video-preparation/utils/parse-inspection.js";
import { VISUAL_TEMPLATES, VISUAL_VERSION } from "./types.js";
import type { Region, VisualCompositionPlan } from "./types.js";
import { isCandidateId } from "../analysis/services/analysis-persistence.js";
export function validRegion(value: unknown): value is Region {
  return record(value) && ["x", "y", "width", "height"].every(key => typeof value[key] === "number" && Number.isFinite(value[key]) && Number(value[key]) >= 0)
    && Number(value["width"]) > 0 && Number(value["height"]) > 0 && Number(value["x"]) + Number(value["width"]) <= 1.001 && Number(value["y"]) + Number(value["height"]) <= 1.001;
}
export function validSafeArea(value: unknown) {
  return record(value) && ["left", "right", "top", "bottom", "anchorY"].every(key => typeof value[key] === "number" && Number.isFinite(value[key]) && Number(value[key]) >= 0 && Number(value[key]) < 1)
    && Number(value["left"]) + Number(value["right"]) < .8 && Number(value["top"]) + Number(value["bottom"]) < .8
    && Number(value["anchorY"]) > Number(value["top"]) && Number(value["anchorY"]) < 1 - Number(value["bottom"]);
}
export function validateVisualPlan(value: unknown): VisualCompositionPlan {
  if (!record(value) || value["version"] !== VISUAL_VERSION || typeof value["clipId"] !== "string" || !isCandidateId(value["clipId"])
    || !VISUAL_TEMPLATES.includes(value["template"] as VisualCompositionPlan["template"]) || !validRegion(value["foreground"])
    || value["sourceCrop"] !== null && !validRegion(value["sourceCrop"]) || value["focalRegion"] !== null && !validRegion(value["focalRegion"])
    || !record(value["background"]) || !["blurred-video", "solid"].includes(String(value["background"]["kind"]))
    || typeof value["background"]["blurSigma"] !== "number" || !Number.isFinite(value["background"]["blurSigma"]) || value["background"]["blurSigma"] < 0 || value["background"]["blurSigma"] > 24
    || typeof value["background"]["darkness"] !== "number" || !Number.isFinite(value["background"]["darkness"]) || value["background"]["darkness"] < .2 || value["background"]["darkness"] > .8
    || !Array.isArray(value["overlays"]) || value["overlays"].length > 2 || !Array.isArray(value["reason"]) || !value["reason"].every(reason => typeof reason === "string" && reason.length < 1000)
    || !record(value["identity"]) || value["identity"]["font"] !== "Arial" || !validSafeArea(value["safeArea"])) throw new Error("Invalid visual composition plan");
  for (const overlay of value["overlays"]) if (!record(overlay) || !["title-bar", "label", "card", "speaker-name", "topic", "badge", "callout"].includes(String(overlay["kind"])) || typeof overlay["text"] !== "string" || overlay["text"].length > 80 || !validRegion(overlay["region"]) || typeof overlay["opacity"] !== "number" || overlay["opacity"] < .3 || overlay["opacity"] > .75) throw new Error("Invalid overlay");
  const plan = value as unknown as VisualCompositionPlan;
  // UI margins constrain text, never the video image itself.
  for (const region of plan.overlays.map(overlay => overlay.region)) if (region.x < plan.safeArea.left - .001 || region.x + region.width > 1 - plan.safeArea.right + .001 || region.y < plan.safeArea.top - .001 || region.y + region.height > 1 - plan.safeArea.bottom + .001) throw new Error("Visual element outside safe area");
  if (plan.template === "FULL_VERTICAL" && (plan.foreground.x !== 0 || plan.foreground.y !== 0 || plan.foreground.width !== 1 || plan.foreground.height !== 1 || !plan.sourceCrop)) throw new Error("FULL_VERTICAL must fill the canvas");
  if (plan.template === "FOCUS_DETAIL" && !plan.sourceCrop || plan.template === "MEDIA_STACK" && plan.auxiliaryFrameTimestamp === null) throw new Error("Template needs explicit visual evidence");
  // Reserved conceptual layouts need a second approved input; never silently render them as a different template.
  if (["MEDIA_STACK", "TOP_BOTTOM", "SPLIT"].includes(plan.template)) throw new Error("Special renderer awaits an approved auxiliary asset provider");
  return plan;
}
