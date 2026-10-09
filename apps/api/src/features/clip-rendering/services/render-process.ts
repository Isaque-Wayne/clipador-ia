import { spawn } from "node:child_process";
import { ProcessingError } from "../../processing/services/processing-error.js";
import { PipelineTimeoutError } from "../../pipeline/services/stage-deadline.js";
import { terminateProcessTree } from "../../pipeline/services/terminate-process-tree.js";
interface ProcessOptions { executable: string; args: string[]; cwd: string; inputFd?: number; timeoutMs: number; onDiagnostic?: (text: string) => void }
export async function runRenderProcess(options: ProcessOptions, signal: AbortSignal): Promise<void> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 2_147_483_647) throw new Error("Invalid render timeout");
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    let failure: Error | undefined, diagnostic = "";
    const child = spawn(options.executable, options.args, { cwd: options.cwd, shell: false, windowsHide: true, stdio: [options.inputFd ?? "ignore", "ignore", "pipe"] });
    const abort = () => {
      failure ??= signal.reason instanceof ProcessingError || signal.reason instanceof PipelineTimeoutError ? signal.reason : new ProcessingError("CANCELLED", "Renderização cancelada.", 409);
      void terminateProcessTree(child);
    };
    const started = performance.now();
    const timer = setTimeout(() => { failure ??= new ProcessingError("RENDER_TIMEOUT", "A renderização do corte excedeu o limite de tempo configurado.", 408,
      { stage: "renderClip", timeoutMs: options.timeoutMs, elapsedMs: performance.now() - started }); void terminateProcessTree(child); }, options.timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stderr?.on("data", (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString("utf8")).slice(-16 * 1024); });
    child.once("error", () => { failure ??= new ProcessingError("FFMPEG_UNAVAILABLE", "Não foi possível iniciar o FFmpeg local."); });
    child.once("close", async code => {
      await terminateProcessTree(child);
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (diagnostic.trim()) options.onDiagnostic?.(diagnostic.trim());
      if (failure) reject(failure);
      else if (code !== 0) reject(new ProcessingError("FFMPEG_FAILED", `FFmpeg falhou ao renderizar o corte (saída ${String(code)}). Consulte o diagnóstico do servidor.`));
      else resolve();
    });
  });
}
