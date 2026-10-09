import { lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { runMediaTool } from "../../youtube-ingestion/services/ffmpeg-runner.js";
import { writeVideoStream } from "../../uploads/services/write-video-stream.js";
import { UploadValidationError, MAX_VIDEO_BYTES } from "../../uploads/utils/validate-video.js";
import { audioArguments, ASR_BYTES_PER_SECOND } from "../utils/media-commands.js";
import type { VideoInspection } from "../types/inspection.js";
import { validatePreparedAudio } from "./validate-prepared-audio.js";
import { openMediaInput } from "./open-media-input.js";
import type { MediaInput } from "../types/preparation.js";
import { createStageDeadline } from "../../pipeline/services/stage-deadline.js";

export async function withPreparedAudio<T>(input: MediaInput, directory: string, inspection: VideoInspection,
  signal: AbortSignal, reserve: (bytes: number) => void, consumer: (audioPath: string) => Promise<T>): Promise<T> {
  if (!inspection.audio) throw new UploadValidationError("Este vídeo não contém áudio para transcrição.", 422);
  // PCM mono 16 kHz: reserva conservadora antes de iniciar e confirmação por bloco.
  const maximum = Math.ceil((inspection.durationSeconds + 2) * ASR_BYTES_PER_SECOND) + 4096;
  if (!Number.isSafeInteger(maximum) || maximum > MAX_VIDEO_BYTES)
    throw new UploadValidationError("Áudio preparado excederia o limite de arquivo configurado.", 413);
  reserve(maximum);
  const output = join(directory, "audio-asr.wav.part");
  const file = await open(output, "wx", 0o600);
  const deadline = createStageDeadline("preparation", signal);
  signal = deadline.signal;
  try {
    const source = await openMediaInput(input);
    try {
      const process = await runMediaTool("ffmpeg", audioArguments(), signal, {
        inputFd: source.fd, mapFailure: () => new UploadValidationError("FFmpeg falhou ao preparar o áudio para transcrição.", 422),
      });
      try { await writeVideoStream(process.content, file, maximum, signal, undefined, reserve); }
      finally { await process.dispose?.(); }
    } finally { await source.close(); }
    await file.close();
    signal.throwIfAborted();
    await validatePreparedAudio(output, inspection.durationSeconds, signal);
    deadline.check();
    deadline.dispose(); // The consumer (Whisper) owns a different stage budget.
    return await consumer(output);
  } finally {
    deadline.dispose();
    await file.close();
    const stat = await lstat(output);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Temporário de áudio inseguro.");
    await unlink(output);
  }
}
