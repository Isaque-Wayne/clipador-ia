import { record } from "../../video-preparation/utils/parse-inspection.js";
import { RENDER_PROFILES, EDIT_PLAN_VERSION } from "../types.js";
import type { EditPlan } from "../types.js";
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export function validateEditPlan(value: unknown): EditPlan {
  if (!record(value) || ![EDIT_PLAN_VERSION, "social-edit-1.0.0"].includes(String(value["version"])) || typeof value["clipId"] !== "string" || !/^c_[a-f0-9]{16}$/.test(value["clipId"]) || typeof value["analysisVersion"] !== "string"
    || !["CLEAN", "DYNAMIC", "STORY", "EMOTIONAL", "EDUCATIONAL", "PODCAST"].includes(String(value["style"])) || !Object.hasOwn(RENDER_PROFILES, String(value["renderProfile"])) || !record(value["sourceRange"]) || !number(value["sourceRange"]["start"]) || !number(value["sourceRange"]["end"])
    || value["sourceRange"]["start"] < 0 || value["sourceRange"]["end"] <= value["sourceRange"]["start"] || !number(value["outputDuration"]) || value["outputDuration"] <= 0 || value["outputDuration"] > 180.01
    || !Array.isArray(value["timeline"]) || !value["timeline"].length || value["timeline"].length > 100) throw new Error("Invalid edit plan");
  let previousSource = value["sourceRange"]["start"], previousOutput = 0;
  for (const span of value["timeline"]) {
    if (!record(span) || !["sourceStart", "sourceEnd", "outputStart", "outputEnd"].every(key => number(span[key])) || Number(span["sourceStart"]) < previousSource - .001 || Number(span["sourceEnd"]) <= Number(span["sourceStart"]) || Number(span["sourceEnd"]) > value["sourceRange"]["end"] + .001
      || Math.abs(Number(span["outputStart"]) - previousOutput) > .001 || Math.abs(Number(span["outputEnd"]) - Number(span["outputStart"]) - Number(span["sourceEnd"]) + Number(span["sourceStart"])) > .001) throw new Error("Invalid timeline");
    previousSource = Number(span["sourceEnd"]); previousOutput = Number(span["outputEnd"]);
  }
  if (Math.abs(previousOutput - value["outputDuration"]) > .001) throw new Error("Invalid planned duration");
  const framing = value["framing"], captions = value["captions"], music = value["music"];
  if (!record(framing) || !["crop", "padding"].includes(String(framing["mode"])) || !record(framing["focus"]) || framing["focus"]["x"] !== .5 || framing["focus"]["y"] !== .5 || !Array.isArray(framing["speakerShots"]) || framing["speakerShots"].length)
    throw new Error("Unsupported framing plan");
  if (!record(captions) || !["caption-plan-1.0.0", "caption-plan-1.0.1"].includes(String(captions["version"])) || !record(captions["safeArea"]) || !number(captions["fontSize"]) || captions["fontSize"] < 40 || captions["fontSize"] > 72 || !Array.isArray(captions["groups"]) || captions["groups"].length > 2000) throw new Error("Invalid captions");
  for (const key of ["left", "right", "top", "bottom", "anchorY"]) if (!number(captions["safeArea"][key]) || Number(captions["safeArea"][key]) < 0 || Number(captions["safeArea"][key]) > .9) throw new Error("Invalid safe area");
  if (Number(captions["safeArea"]["left"]) + Number(captions["safeArea"]["right"]) >= .8 || Number(captions["safeArea"]["top"]) + Number(captions["safeArea"]["bottom"]) >= .8) throw new Error("Empty caption safe area");
  const centerX = captions["version"] === "caption-plan-1.0.0" ? .5 : (Number(captions["safeArea"]["left"]) + 1 - Number(captions["safeArea"]["right"])) / 2;
  for (const group of captions["groups"]) {
    if (!record(group) || !number(group["start"]) || !number(group["end"]) || group["start"] < 0 || group["end"] <= group["start"] || group["end"] > value["outputDuration"] + .001 || typeof group["activeWord"] !== "boolean" || typeof group["emphasis"] !== "boolean" || !record(group["position"])
      || !["clean", "active", "concept"].includes(String(group["style"])) || !number(group["position"]["x"]) || Math.abs(group["position"]["x"] - centerX) > .001 || !number(group["position"]["y"]) || group["position"]["y"] < Number(captions["safeArea"]["top"]) || group["position"]["y"] > 1 - Number(captions["safeArea"]["bottom"]) || !Array.isArray(group["words"]) || !group["words"].length || group["words"].length > 5) throw new Error("Invalid caption group");
    for (const word of group["words"]) if (!record(word) || typeof word["text"] !== "string" || word["text"].length > 200 || !number(word["start"]) || !number(word["end"]) || word["start"] < group["start"] - .001 || word["end"] < word["start"] || word["end"] > group["end"] + .001 || typeof word["emphasis"] !== "boolean") throw new Error("Invalid caption word");
  }
  if (!Array.isArray(value["zoomEvents"]) || value["zoomEvents"].length > 30) throw new Error("Invalid zoom events");
  for (const zoom of value["zoomEvents"]) if (!record(zoom) || !number(zoom["start"]) || !number(zoom["end"]) || zoom["start"] < 0 || zoom["end"] <= zoom["start"] || zoom["end"] > value["outputDuration"] + .001 || !number(zoom["intensity"]) || zoom["intensity"] < 0 || zoom["intensity"] > .12 || !record(zoom["focus"]) || zoom["focus"]["x"] !== .5 || zoom["focus"]["y"] !== .5 || typeof zoom["reason"] !== "string") throw new Error("Invalid zoom");
  if (!record(music) || typeof music["requested"] !== "boolean" || !number(music["volume"]) || music["volume"] < 0 || music["volume"] > .12 || !["start", "end", "fadeIn", "fadeOut"].every(key => number(music[key]) && Number(music[key]) >= 0)) throw new Error("Invalid music plan");
  if (!["inspirational", "emotional", "tense", "energetic", "playful", "neutral", "cinematic", "educational"].includes(String(music["mood"])) || music["intensity"] !== "low" || typeof music["reason"] !== "string"
    || music["start"] !== 0 || music["end"] !== value["outputDuration"] || Number(music["fadeIn"]) > value["outputDuration"] || Number(music["fadeOut"]) > value["outputDuration"]) throw new Error("Unsupported music range");
  const ducking = music["ducking"];
  if (!record(ducking) || !["threshold", "ratio", "attackMs", "releaseMs"].every(key => number(ducking[key]) && Number(ducking[key]) > 0) || Number(ducking["threshold"]) > 1 || Number(ducking["ratio"]) > 20 || Number(ducking["attackMs"]) > 2000 || Number(ducking["releaseMs"]) > 9000) throw new Error("Invalid ducking");
  for (const key of ["silenceCuts", "emphasisEvents", "bRollEvents", "transitions"] as const) if (!Array.isArray(value[key]) || value[key].length > 2000) throw new Error("Invalid event list");
  for (const key of ["silenceCuts", "emphasisEvents", "bRollEvents"] as const) for (const event of value[key] as unknown[]) {
    const source = key === "silenceCuts";
    if (!record(event) || !number(event["start"]) || !number(event["end"]) || event["start"] < (source ? value["sourceRange"]["start"] : 0) || event["end"] < event["start"] || event["end"] > (source ? value["sourceRange"]["end"] : value["outputDuration"]) + .001) throw new Error("Invalid plan event timing");
    if (key === "bRollEvents" && (typeof event["query"] !== "string" || event["query"].length > 120 || !["illustrate", "cutaway"].includes(String(event["purpose"])) || !number(event["importance"]) || event["importance"] < 0 || event["importance"] > 1)) throw new Error("Invalid B-roll cue");
    if (key !== "bRollEvents" && typeof event["reason"] !== "string") throw new Error("Invalid event reason");
  }
  for (const transition of value["transitions"] as unknown[]) if (!record(transition) || transition["kind"] !== "cut" || !number(transition["at"]) || transition["at"] < 0 || transition["at"] > value["outputDuration"]) throw new Error("Invalid transition");
  if (!record(value["pacing"]) || !record(value["soundEffects"])) throw new Error("Invalid planning metadata");
  const pacing = value["pacing"];
  if (!["calm", "balanced", "brisk"].includes(String(pacing["visualTempo"])) || !["maxEffectsPerMinute", "minZoomGap", "minShotDuration"].every(key => number(pacing[key]) && Number(pacing[key]) > 0)
    || !Array.isArray(pacing["pauses"]) || !Array.isArray(value["soundEffects"]["events"]) || value["soundEffects"]["requiresLicensedAsset"] !== true) throw new Error("Invalid pacing/effects");
  for (const pause of pacing["pauses"]) if (!record(pause) || !number(pause["start"]) || !number(pause["end"]) || pause["start"] < value["sourceRange"]["start"] || pause["end"] > value["sourceRange"]["end"] || pause["end"] <= pause["start"] || !["preserve", "trim"].includes(String(pause["action"])) || typeof pause["reason"] !== "string") throw new Error("Invalid planned pause");
  return value as unknown as EditPlan;
}
