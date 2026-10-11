import type { VideoInspection } from "../../video-preparation/types/inspection.js";
import { ProcessingError } from "../../processing/services/processing-error.js";
export function validateSocialOutput(output: VideoInspection, expectedDuration: number) {
  if (output.width !== 1080 || output.height !== 1920 || Math.abs(output.aspectRatio - 9 / 16) > .001
    || output.videoCodec !== "h264" || output.audio?.codec !== "aac" || Math.abs(output.durationSeconds - expectedDuration) > .3)
    throw new ProcessingError("INVALID_OUTPUT", "MP4 social inválido: é obrigatório 1080×1920 (9:16), vídeo H.264, áudio AAC e duração correspondente ao plano.");
}
