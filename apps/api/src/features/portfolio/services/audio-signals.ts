import type { AudioSignals, AudioWindow } from "../types.js";
import type { PreparationContext } from "../../video-preparation/types/preparation.js";
import { runMediaTool } from "../../youtube-ingestion/services/ffmpeg-runner.js";
import { openMediaInput } from "../../video-preparation/services/open-media-input.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
export function audioSignalArguments(): string[] {
  return ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "fd,pipe", "-fd", "0", "-format_whitelist", "mov,matroska,webm", "-i", "fd:", "-vn", "-sn", "-dn", "-map", "0:a:0",
    "-af", "aformat=sample_rates=16000:channel_layouts=mono,asetnsamples=n=8000:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level+Peak_level,ametadata=mode=print:file='pipe\\:1'", "-f", "null", "NUL"];
}
export function parseAudioSignals(text: string, duration: number): AudioSignals {
  const windows: AudioWindow[] = [];
  let start: number | undefined, rms: number | undefined, peak: number | undefined;
  const db = (value: string) => value === "-inf" ? -120 : Math.max(-120, Math.min(12, Number(value)));
  function flush() { if (start !== undefined && rms !== undefined && peak !== undefined && [start, rms, peak].every(Number.isFinite) && start < duration) windows.push({ start, end: Math.min(duration, start + .5), rmsDb: rms, peakDb: peak }); }
  for (const line of text.split(/\r?\n/u)) {
    const timestamp = /pts_time:([\d.e+-]+)/u.exec(line);
    if (timestamp) { flush(); start = Number(timestamp[1]); rms = undefined; peak = undefined; }
    else if (line.startsWith("lavfi.astats.Overall.RMS_level=")) rms = db(line.split("=")[1] ?? "NaN");
    else if (line.startsWith("lavfi.astats.Overall.Peak_level=")) peak = db(line.split("=")[1] ?? "NaN");
  }
  flush();
  if (!windows.length || windows.some((window, index) => index > 0 && window.start <= windows[index - 1]!.start)) throw new UploadValidationError("Métricas de áudio inválidas.", 422);
  return { available: true, method: "ffmpeg-astats-0.5s", windows };
}
export async function readAudioSignals(context: PreparationContext, duration: number, onDiagnostic?: (text: string) => void): Promise<AudioSignals> {
  const file = await openMediaInput(context.input);
  try {
    const process = await runMediaTool("ffmpeg", audioSignalArguments(), context.signal, { inputFd: file.fd, ...(onDiagnostic ? { onDiagnostic } : {}), mapFailure: () => new UploadValidationError("FFmpeg não conseguiu medir energia do áudio.", 422) });
    try {
      let text = "", bytes = 0;
      for await (const chunk of process.content) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new UploadValidationError("Métricas de áudio excederam o limite seguro.", 422); text += chunk.toString("utf8"); }
      return parseAudioSignals(text, duration);
    } finally { await process.dispose?.(); }
  } finally { await file.close(); }
}
