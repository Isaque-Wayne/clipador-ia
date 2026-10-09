export interface TranscriptWord { word: string; start: number; end: number; probability: number | null }
export interface TranscriptSegment { id: number; start: number; end: number; text: string; words: TranscriptWord[] }
export interface Transcript { language: string; languageProbability: number | null; duration: number; text: string; segments: TranscriptSegment[] }
export interface TranscriptionEngine {
  transcribe(audioPath: string, signal: AbortSignal, onProgress?: (progress: TranscriptionProgress) => void): Promise<Transcript>;
}
export interface TranscriptionProgress { segmentsProcessed: number; processedThroughSeconds: number }
