import type { UploadService } from "../../uploads/services/receive-video.js";
import type { VideoInspection } from "../types/inspection.js";
import { inspectVideo } from "./inspect-video.js";
import { withPreparedAudio } from "./prepare-audio.js";

export type PreparationStage = "preparing" | "extracting-audio" | "audio-ready";
export function createVideoPreparation(uploads: UploadService) {
  return {
    inspect: (id: string, signal = new AbortController().signal) => uploads.prepareUpload(id, async (context) => {
      const inspection = await inspectVideo(context.input, context.signal);
      await context.persistInspection(inspection);
      return inspection;
    }, signal),
    prepare: <T>(id: string, consumeAudio: (audioPath: string, inspection: VideoInspection, signal: AbortSignal) => Promise<T>,
      signal = new AbortController().signal, onStage?: (stage: PreparationStage) => void) => uploads.prepareUpload(id, async (context) => {
        onStage?.("preparing");
        const inspection = await inspectVideo(context.input, context.signal);
        await context.persistInspection(inspection);
        onStage?.("extracting-audio");
        return withPreparedAudio(context.input, context.directory, inspection, context.signal, context.reserve, async (path) => {
          onStage?.("audio-ready");
          return consumeAudio(path, inspection, context.signal);
        });
      }, signal),
  };
}
