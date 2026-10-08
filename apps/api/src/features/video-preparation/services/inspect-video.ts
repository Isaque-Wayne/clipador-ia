import { runMediaTool } from "../../youtube-ingestion/services/ffmpeg-runner.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { descriptorInspectionArguments } from "../utils/media-commands.js";
import { parseProbe } from "../utils/parse-probe.js";
import { readProbeJson } from "./read-probe-json.js";
import { openMediaInput } from "./open-media-input.js";
import type { MediaInput } from "../types/preparation.js";

export async function inspectVideo(input: MediaInput, signal: AbortSignal) {
  const file = await openMediaInput(input);
  try {
    const process = await runMediaTool("ffprobe", descriptorInspectionArguments(), signal, {
      inputFd: file.fd, mapFailure: () => new UploadValidationError("FFprobe não conseguiu inspecionar o vídeo.", 422),
    });
    return parseProbe(await readProbeJson(process));
  } finally { await file.close(); }
}
