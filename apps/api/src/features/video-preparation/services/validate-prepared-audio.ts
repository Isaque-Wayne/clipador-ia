import { runMediaTool } from "../../youtube-ingestion/services/ffmpeg-runner.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { inspectionArguments, ASR_SAMPLE_RATE } from "../utils/media-commands.js";
import { record } from "../utils/parse-inspection.js";
import { readProbeJson } from "./read-probe-json.js";

export function validateAudioProbe(value: unknown, expectedDuration: number): void {
  const streams = record(value) ? value["streams"] : undefined;
  const format = record(value) ? value["format"] : undefined;
  const audio = Array.isArray(streams) && streams.length === 1 && record(streams[0]) ? streams[0] : undefined;
  const duration = record(format) ? Number(format["duration"]) : NaN;
  if (!audio || audio["codec_type"] !== "audio" || audio["codec_name"] !== "pcm_s16le"
    || Number(audio["sample_rate"]) !== ASR_SAMPLE_RATE || audio["channels"] !== 1
    || !record(format) || format["format_name"] !== "wav" || !Number.isFinite(duration) || duration <= 0
    || duration > expectedDuration + Math.max(2, expectedDuration * .01))
    throw new UploadValidationError("Áudio preparado inválido: formato, duração ou parâmetros divergentes.", 422);
}
export async function validatePreparedAudio(path: string, expectedDuration: number, signal: AbortSignal): Promise<void> {
  const process = await runMediaTool("ffprobe", inspectionArguments(path, "audio"), signal, {
    mapFailure: () => new UploadValidationError("Não foi possível validar o áudio preparado.", 422),
  });
  validateAudioProbe(await readProbeJson(process), expectedDuration);
}
