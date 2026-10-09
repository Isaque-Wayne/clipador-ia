import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import { TranscriptionError, cancellation } from "./transcription-error.js";
import type { TranscriptionProgress } from "../types/transcript.js";
import { PipelineTimeoutError } from "../../pipeline/services/stage-deadline.js";
import { terminateProcessTree } from "../../pipeline/services/terminate-process-tree.js";

export const MAX_ENGINE_BYTES = 16 * 1024 * 1024;
export interface RunnerOptions { executable: string; args: string[]; timeoutMs: number; onDiagnostic?: (stderr: string) => void; onProgress?: (progress: TranscriptionProgress) => void }
export async function runPython(options: RunnerOptions, parent: AbortSignal): Promise<unknown> {
  if (parent.aborted) throw parent.reason instanceof TranscriptionError || parent.reason instanceof PipelineTimeoutError ? parent.reason : cancellation();
  const settings: SpawnOptions = { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", PYTHONIOENCODING: "utf-8" } };
  const child = spawn(options.executable, options.args, settings);
  let stdout: Buffer[] = [], bytes = 0, stderr = "", failure: Error | undefined;
  const stop = (error: Error) => { failure ??= error; void terminateProcessTree(child); };
  const aborted = () => stop(parent.reason instanceof TranscriptionError || parent.reason instanceof PipelineTimeoutError ? parent.reason : cancellation());
  parent.addEventListener("abort", aborted, { once: true });
  if (parent.aborted) aborted();
  const started = performance.now();
  const timer = setTimeout(() => stop(new PipelineTimeoutError("transcription", options.timeoutMs, performance.now() - started)), options.timeoutMs);
  let pendingLine = "", lastSegments = 0, lastSeconds = 0;
  function line(text: string) {
    if (!text.startsWith("CLIPADOR_PROGRESS ")) { stderr = (stderr + text + "\n").slice(-16_384); return; }
    try {
      const value: unknown = JSON.parse(text.slice(18));
      if (typeof value !== "object" || value === null || !("segmentsProcessed" in value) || !("processedThroughSeconds" in value)) return;
      const count = value.segmentsProcessed, seconds = value.processedThroughSeconds;
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= lastSegments || count > 100_000
        || typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < lastSeconds || seconds > 86_400) return;
      lastSegments = count; lastSeconds = seconds;
      options.onProgress?.({ segmentsProcessed: count, processedThroughSeconds: seconds });
    } catch { /* Untrusted stderr is never a completed transcript. */ }
  }
  try {
    return await new Promise<unknown>((resolve, reject) => {
      child.once("error", () => { failure ??= new TranscriptionError("ENGINE_UNAVAILABLE", "Não foi possível iniciar a engine Python local.", 503); });
      child.stdout?.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_ENGINE_BYTES) { stdout = []; stop(new TranscriptionError("INVALID_RESULT", "Resultado da engine excedeu o limite.")); }
        else if (!failure) stdout.push(chunk);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        pendingLine += chunk.toString("utf8");
        let end;
        while ((end = pendingLine.indexOf("\n")) !== -1) { line(pendingLine.slice(0, end)); pendingLine = pendingLine.slice(end + 1); }
        if (pendingLine.length > 16_384) { stderr = (stderr + pendingLine.slice(0, -16_384)).slice(-16_384); pendingLine = pendingLine.slice(-16_384); }
      });
      child.once("close", (code) => {
        if (pendingLine) { if (pendingLine.startsWith("CLIPADOR_PROGRESS ")) line(pendingLine); else stderr = (stderr + pendingLine).slice(-16_384); }
        if (stderr) options.onDiagnostic?.(stderr);
        if (failure) return reject(failure);
        if (code !== 0) return reject(new TranscriptionError("ENGINE_FAILED", "A engine local falhou ao transcrever o áudio.", 502));
        try { resolve(JSON.parse(Buffer.concat(stdout).toString("utf8"))); }
        catch { reject(new TranscriptionError("INVALID_RESULT", "A engine retornou JSON inválido.")); }
      });
    });
  } finally { clearTimeout(timer); parent.removeEventListener("abort", aborted); await terminateProcessTree(child); }
}
