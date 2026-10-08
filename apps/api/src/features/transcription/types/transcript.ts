export interface TranscriptWord { word: string; start: number; end: number; probability: number | null }
export interface TranscriptSegment { start: number; end: number; text: string; words: TranscriptWord[] }
export interface Transcript { language: string; duration: number; segments: TranscriptSegment[] }
export interface TranscriptionEngine {
  transcribe(audioPath: string, signal: AbortSignal): Promise<Transcript>;
}
