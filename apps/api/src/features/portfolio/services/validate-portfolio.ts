import { record } from "../../video-preparation/utils/parse-inspection.js";
import { DURATION_PROFILES } from "../types.js";
import type { ClipPortfolio, PortfolioCandidate, AudioSignals } from "../types.js";
import type { CutCandidate } from "../../analysis/candidate.js";
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
export function validateAudio(value: unknown): AudioSignals {
  if (!record(value) || typeof value["available"] !== "boolean" || value["method"] !== "ffmpeg-astats-0.5s" || !Array.isArray(value["windows"]) || value["windows"].length > 100000) throw new Error("Invalid audio signals");
  let previousEnd = 0;
  for (const window of value["windows"]) {
    if (!record(window) || !["start", "end", "rmsDb", "peakDb"].every(key => number(window[key])) || Number(window["start"]) < previousEnd - .001 || Number(window["end"]) <= Number(window["start"])
      || Number(window["rmsDb"]) < -120 || Number(window["rmsDb"]) > 12 || Number(window["peakDb"]) < -120 || Number(window["peakDb"]) > 12 || Number(window["rmsDb"]) > Number(window["peakDb"]) + .001) throw new Error("Invalid audio window");
    previousEnd = Number(window["end"]);
  }
  if (value["available"] && !value["windows"].length || value["reason"] !== undefined && typeof value["reason"] !== "string") throw new Error("Invalid audio availability");
  return value as unknown as AudioSignals;
}
export function validatePortfolioCandidate(value: Record<string, unknown>): PortfolioCandidate {
  if (typeof value["familyId"] !== "string" || !/^f_[a-f0-9]{16}$/.test(value["familyId"]) || typeof value["profile"] !== "string" || !Object.hasOwn(DURATION_PROFILES, value["profile"])
    || typeof value["objective"] !== "string" || !strings(value["topicTokens"]) || !["potentialScore", "standaloneQuality"].every(key => number(value[key]) && Number(value[key]) >= 0 && Number(value[key]) <= 100)
    || !record(value["hookScore"]) || !record(value["emotion"]) || !record(value["storyArc"])) throw new Error("Invalid portfolio candidate");
  const hook = value["hookScore"], emotion = value["emotion"], arc = value["storyArc"];
  if (!number(hook["value"]) || hook["value"] < 0 || hook["value"] > 100 || hook["windowSeconds"] !== 3 || !strings(hook["evidence"]) || !Array.isArray(hook["dimensions"])) throw new Error("Invalid hook");
  for (const dimension of hook["dimensions"]) if (!record(dimension) || typeof dimension["name"] !== "string" || !number(dimension["value"]) || dimension["value"] < 0 || dimension["value"] > 1 || !number(dimension["weight"])) throw new Error("Invalid hook dimension");
  if (!record(emotion["semantic"]) || emotion["semantic"]["method"] !== "lexical-portuguese" || !Array.isArray(emotion["semantic"]["labels"]) || !record(emotion["audio"]) || !record(emotion["visual"]) || emotion["visual"]["available"] !== false
    || !record(emotion["confidence"]) || !Array.isArray(emotion["events"])) throw new Error("Invalid emotion signals");
  for (const label of emotion["semantic"]["labels"]) if (!record(label) || !["enthusiasm", "surprise", "humor", "tension", "indignation", "inspiration", "curiosity", "vulnerability", "confidence", "energy", "urgency", "reflection"].includes(String(label["name"])) || !number(label["strength"]) || label["strength"] < 0 || label["strength"] > 1 || !strings(label["evidence"])) throw new Error("Invalid semantic label");
  for (const key of ["meanRmsDb", "peakDb", "dynamicsDb", "quietRatio"] as const) if (emotion["audio"][key] !== null && !number(emotion["audio"][key])) throw new Error("Invalid audio summary");
  const confidence = emotion["confidence"];
  if (typeof emotion["visual"]["reason"] !== "string" || typeof emotion["audio"]["available"] !== "boolean" || !number(emotion["audio"]["speechWordsPerSecond"]) || emotion["audio"]["speechWordsPerSecond"] < 0
    || emotion["audio"]["quietRatio"] !== null && (Number(emotion["audio"]["quietRatio"]) < 0 || Number(emotion["audio"]["quietRatio"]) > 1)
    || typeof confidence["note"] !== "string" || !["semantic", "audio"].every(key => number(confidence[key]) && Number(confidence[key]) >= 0 && Number(confidence[key]) <= 1)) throw new Error("Invalid confidence");
  for (const event of emotion["events"]) if (!record(event) || !number(event["start"]) || !number(event["end"]) || event["start"] < Number(value["start"]) || event["end"] > Number(value["end"]) + .001 || event["end"] < event["start"] || !["question", "contrast", "number", "conclusion", "strong-statement", "emotion", "list"].includes(String(event["kind"])) || !number(event["strength"]) || typeof event["reason"] !== "string" || typeof event["text"] !== "string") throw new Error("Invalid emphasis event");
  if (!number(arc["confidence"]) || arc["confidence"] < 0 || arc["confidence"] > 1 || !strings(arc["evidence"])) throw new Error("Invalid story arc");
  for (const key of ["setup", "development", "payoff"] as const) if (arc[key] !== undefined && !number(arc[key])) throw new Error("Invalid story timestamp");
  return value as unknown as PortfolioCandidate;
}
export function validatePortfolio(value: unknown, candidates: CutCandidate[]): ClipPortfolio {
  if (!record(value) || typeof value["version"] !== "string" || !number(value["sourceDuration"]) || value["sourceDuration"] <= 0 || !record(value["rankings"]) || !record(value["metrics"]) || !Array.isArray(value["families"]) || !Array.isArray(value["audit"]) || value["audit"].length > 1280) throw new Error("Invalid portfolio");
  const ids = new Set(candidates.map(item => item.id));
  candidates.forEach(candidate => validatePortfolioCandidate(candidate as unknown as Record<string, unknown>));
  const list = (items: unknown) => strings(items) && new Set(items).size === items.length && items.every(item => ids.has(item));
  for (const key of ["micro", "short", "standard", "extended", "highlights", "bestOverall"] as const) if (!list(value[key])) throw new Error("Invalid portfolio bucket");
  for (const profile of Object.keys(DURATION_PROFILES)) {
    const members = value[profile] as string[];
    if (members.length !== candidates.filter(candidate => candidate.profile === profile).length || members.some(id => candidates.find(candidate => candidate.id === id)?.profile !== profile)) throw new Error("Mismatched portfolio profile");
  }
  for (const key of ["strongestHook", "mostEmotional", "mostEducational", "funniest", "mostShareable", "bestMicro", "bestLongForm"] as const) if (!list(value["rankings"][key])) throw new Error("Invalid ranking");
  for (const family of value["families"]) if (!record(family) || typeof family["id"] !== "string" || !/^f_[a-f0-9]{16}$/.test(family["id"]) || !number(family["anchor"]) || !list(family["candidateIds"]) || !strings(family["profiles"]) || !family["profiles"].every(profile => Object.hasOwn(DURATION_PROFILES, profile))) throw new Error("Invalid family");
  const familyIds = new Set<string>();
  for (const family of value["families"]) {
    const item = family as Record<string, unknown>, id = String(item["id"]), members = item["candidateIds"] as string[], profiles = item["profiles"] as string[];
    if (familyIds.has(id) || !members.length || members.length !== candidates.filter(candidate => candidate.familyId === id).length
      || members.some(member => candidates.find(candidate => candidate.id === member)?.familyId !== id) || profiles.length !== new Set(profiles).size
      || profiles.length !== new Set(members.map(member => candidates.find(candidate => candidate.id === member)?.profile)).size) throw new Error("Mismatched clip family");
    familyIds.add(id);
  }
  if (candidates.some(candidate => !familyIds.has(candidate.familyId ?? ""))) throw new Error("Missing clip family");
  for (const entry of value["audit"]) if (!record(entry) || typeof entry["candidateId"] !== "string" || !/^c_[a-f0-9]{16}$/.test(entry["candidateId"]) || !Object.hasOwn(DURATION_PROFILES, String(entry["profile"])) || !["start", "end", "score"].every(key => number(entry[key])) || !["approved", "rejected", "duplicate"].includes(String(entry["decision"])) || !strings(entry["reasons"])) throw new Error("Invalid audit");
  for (const key of ["raw", "valid", "approved", "rejected", "duplicates", "families"] as const) if (!Number.isSafeInteger(value["metrics"][key]) || Number(value["metrics"][key]) < 0) throw new Error("Invalid metrics");
  const metrics = value["metrics"];
  if (!number(metrics["analysisSeconds"]) || metrics["analysisSeconds"] < 0) throw new Error("Invalid timing");
  if (metrics["raw"] !== value["audit"].length || metrics["approved"] !== candidates.length || metrics["families"] !== value["families"].length
    || Number(metrics["raw"]) !== Number(metrics["valid"]) + Number(metrics["rejected"]) || Number(metrics["valid"]) !== Number(metrics["approved"]) + Number(metrics["duplicates"])) throw new Error("Mismatched portfolio metrics");
  const audio = validateAudio(value["audio"]);
  if (audio.windows.some(window => window.end > Number(value["sourceDuration"]) + .001)) throw new Error("Audio outside source");
  return value as unknown as ClipPortfolio;
}
