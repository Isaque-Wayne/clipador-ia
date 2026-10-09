import type { CutCandidate } from "../analysis/candidate.js";
export const DURATION_PROFILES = { micro: { min: 8, max: 20, target: 14, objective: "hook/punchline" }, short: { min: 20, max: 45, target: 34, objective: "explicação rápida" }, standard: { min: 45, max: 75, target: 60, objective: "ideia desenvolvida" }, extended: { min: 75, max: 180, target: 105, objective: "raciocínio ou história completa" } } as const;
export type DurationProfile = keyof typeof DURATION_PROFILES;
export type QuantityMode = "auto" | "few" | "normal" | "many" | "maximum";
export type EmotionName = "enthusiasm" | "surprise" | "humor" | "tension" | "indignation" | "inspiration" | "curiosity" | "vulnerability" | "confidence" | "energy" | "urgency" | "reflection";
export interface AudioWindow { start: number; end: number; rmsDb: number; peakDb: number }
export interface AudioSignals { available: boolean; method: "ffmpeg-astats-0.5s"; windows: AudioWindow[]; reason?: string }
export interface EmotionSignals {
  semantic: { method: "lexical-portuguese"; labels: { name: EmotionName; strength: number; evidence: string[] }[] };
  audio: { available: boolean; meanRmsDb: number | null; peakDb: number | null; dynamicsDb: number | null; speechWordsPerSecond: number; quietRatio: number | null };
  visual: { available: false; reason: string }; confidence: { semantic: number; audio: number; note: string };
  events: EmphasisEvent[];
}
export interface EmphasisEvent { start: number; end: number; kind: "question" | "contrast" | "number" | "conclusion" | "strong-statement" | "emotion" | "list"; text: string; strength: number; reason: string }
export interface HookScore { value: number; windowSeconds: 3; evidence: string[]; dimensions: { name: string; value: number; weight: number }[] }
export interface StoryArc { setup?: number; development?: number; payoff?: number; confidence: number; evidence: string[] }
export interface PortfolioCandidate extends CutCandidate {
  familyId: string; profile: DurationProfile; objective: string; potentialScore: number; hookScore: HookScore;
  emotion: EmotionSignals; storyArc: StoryArc; standaloneQuality: number; topicTokens: string[];
}
export interface ClipFamily { id: string; anchor: number; candidateIds: string[]; profiles: DurationProfile[] }
export interface ClipPortfolio {
  version: string; sourceDuration: number; micro: string[]; short: string[]; standard: string[]; extended: string[];
  highlights: string[]; bestOverall: string[]; families: ClipFamily[];
  rankings: { strongestHook: string[]; mostEmotional: string[]; mostEducational: string[]; funniest: string[]; mostShareable: string[]; bestMicro: string[]; bestLongForm: string[] };
  audit: { candidateId: string; profile: DurationProfile; start: number; end: number; score: number; decision: "approved" | "rejected" | "duplicate"; reasons: string[]; overlapWith?: string; overlap?: number }[];
  metrics: { raw: number; valid: number; approved: number; rejected: number; duplicates: number; families: number; analysisSeconds: number };
  audio: AudioSignals;
}
