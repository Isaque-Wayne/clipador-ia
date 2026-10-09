import type { CandidateScore } from "./scoring.js";
import type { DurationProfile, EmotionSignals, HookScore, StoryArc } from "../portfolio/types.js";
export interface CutCandidate {
  id: string; start: number; end: number; duration: number; title: string; transcript: string;
  segmentIds: number[]; reason: string; reasons: string[]; score: CandidateScore;
  hook?: string; hookType?: "question" | "contrast" | "statement"; topic?: string;
  description?: string; suggestedCTA?: string; hashtags?: string[];
  familyId?: string; profile?: DurationProfile; objective?: string; potentialScore?: number;
  hookScore?: HookScore; emotion?: EmotionSignals; storyArc?: StoryArc; standaloneQuality?: number; topicTokens?: string[];
}
