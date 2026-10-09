import { performance } from "node:perf_hooks";
import { resolvePipelineTimeouts } from "../../../../../../config/pipeline-timeouts.mjs";
import type { PipelineTimeouts } from "../../../../../../config/pipeline-timeouts.mjs";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";

export type PipelineStage = keyof PipelineTimeouts;
const labels: Record<PipelineStage, string> = {
  metadata: "A consulta de metadados", download: "O download", ffmpeg: "O processamento pelo FFmpeg",
  ffprobe: "A inspeção pelo FFprobe", transcription: "A transcrição", analysis: "A análise",
  render: "A renderização do lote", renderClip: "A renderização do corte", preparation: "A preparação do áudio",
  storage: "A operação de armazenamento", upload: "O upload", request: "A consulta à API",
};
export class PipelineTimeoutError extends UploadValidationError {
  readonly code = "TIMEOUT";
  constructor(public readonly stage: PipelineStage, public readonly timeoutMs: number, public readonly elapsedMs: number) {
    super(`${labels[stage]} excedeu o limite de tempo configurado.`, 408);
  }
}
export function createStageDeadline(stage: PipelineStage, parent: AbortSignal, timeoutMs = resolvePipelineTimeouts()[stage]) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new Error(`Timeout inválido: ${stage}`);
  const started = performance.now(), abort = new AbortController();
  const expire = () => abort.abort(new PipelineTimeoutError(stage, timeoutMs, performance.now() - started));
  const timer = setTimeout(expire, timeoutMs);
  const signal = AbortSignal.any([parent, abort.signal]);
  return { signal, dispose: () => clearTimeout(timer), check() {
    if (performance.now() - started >= timeoutMs && !signal.aborted) expire();
    signal.throwIfAborted();
  } };
}
export async function withStageDeadline<T>(stage: PipelineStage, parent: AbortSignal, operation: (signal: AbortSignal) => Promise<T>, timeoutMs?: number): Promise<T> {
  const deadline = createStageDeadline(stage, parent, timeoutMs);
  try { deadline.check(); const result = await operation(deadline.signal); deadline.check(); return result; }
  catch (error) { if (deadline.signal.aborted) throw deadline.signal.reason; throw error; }
  finally { deadline.dispose(); }
}
