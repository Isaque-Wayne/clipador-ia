export interface VideoInspection {
  durationSeconds: number;
  width: number;
  height: number;
  aspectRatio: number;
  fps: number | null;
  container: string;
  videoCodec: string;
  audio: { codec: string; sampleRate: number; channels: number } | null;
  bitrate: number | null;
}
