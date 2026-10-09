export interface PipelineTimeouts {
  metadata: number; download: number; ffmpeg: number; ffprobe: number;
  transcription: number; analysis: number; render: number; renderClip: number;
  preparation: number; storage: number; upload: number; request: number;
}
export const PIPELINE_TIMEOUT_DEFAULTS: Readonly<PipelineTimeouts>;
export function resolvePipelineTimeouts(environment?: Readonly<Record<string, string | undefined>>): PipelineTimeouts;
