import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import type { TranscriptionEngine } from "../types/transcript.js";
import { runPython } from "./python-runner.js";
import { normalizeTranscript } from "./normalize-transcript.js";
import { TranscriptionError } from "./transcription-error.js";
import { record } from "../../video-preparation/utils/parse-inspection.js";
import { resolvePipelineTimeouts } from "../../../../../../config/pipeline-timeouts.mjs";

const engineRoot = fileURLToPath(new URL("../../../../../../tools/transcription/", import.meta.url));
export interface EngineMetrics { engineSeconds: number; cpuSeconds: number; peakWorkingSetBytes: number | null }
export function createFasterWhisperEngine(onDiagnostic?: (message: string) => void, onMetrics?: (metrics: EngineMetrics) => void): TranscriptionEngine {
  return { async transcribe(audioPath, signal, onProgress) {
    const stat = await lstat(audioPath);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(audioPath) !== audioPath)
      throw new TranscriptionError("INVALID_INPUT", "Caminho de áudio inseguro.");
    const raw = await runPython({
      executable: join(engineRoot, "venv", "Scripts", "python.exe"),
      args: ["-I", "-X", "utf8", join(engineRoot, "engine.py"), "--audio", audioPath, "--model", join(engineRoot, "models", "small")],
      timeoutMs: resolvePipelineTimeouts().transcription, ...(onDiagnostic ? { onDiagnostic } : {}),
      ...(onProgress ? { onProgress } : {}),
    }, signal);
    if (record(raw) && record(raw["metrics"])) {
      const metrics = raw["metrics"];
      if (typeof metrics["engineSeconds"] === "number" && Number.isFinite(metrics["engineSeconds"]) && metrics["engineSeconds"] > 0
        && typeof metrics["cpuSeconds"] === "number" && Number.isFinite(metrics["cpuSeconds"]) && metrics["cpuSeconds"] >= 0
        && (metrics["peakWorkingSetBytes"] === null || (typeof metrics["peakWorkingSetBytes"] === "number" && Number.isSafeInteger(metrics["peakWorkingSetBytes"]) && metrics["peakWorkingSetBytes"] >= 0)))
        onMetrics?.({ engineSeconds: metrics["engineSeconds"], cpuSeconds: metrics["cpuSeconds"], peakWorkingSetBytes: metrics["peakWorkingSetBytes"] });
    }
    try { return normalizeTranscript(raw); }
    catch { throw new TranscriptionError("INVALID_RESULT", "A engine retornou uma transcrição inválida."); }
  } };
}
