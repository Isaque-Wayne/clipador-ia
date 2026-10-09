export const SCORE_WEIGHTS = { hookStrength: 16, standaloneClarity: 16, informationValue: 14, curiosity: 8, emotion: 6, storytelling: 8, surprise: 6, retentionPotential: 12, conclusionQuality: 8, speechDensity: 6 } as const;
export const PENALTY_WEIGHTS = { slowStart: 8, missingContext: 14, unfinishedThought: 15, excessiveSilence: 12, repetition: 10, weakEnding: 8, tooShort: 12, tooLong: 15 } as const;
export type CriterionName = keyof typeof SCORE_WEIGHTS;
export type PenaltyName = keyof typeof PENALTY_WEIGHTS;
export interface ScoreDimension { name: CriterionName; value: number; weight: number; explanation: string }
export interface ScorePenalty { name: PenaltyName; value: number; weight: number; explanation: string }
export interface CandidateScore { value: number; maximum: 100; dimensions: ScoreDimension[]; penalties: ScorePenalty[]; method: string }
