import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import type { OpenedVideo } from "../../uploads/services/persist-video-input.js";
import { UploadValidationError } from "../../uploads/utils/validate-video.js";
import { downloaderError } from "../utils/downloader-error.js";
export interface TransferSummary { bytesReceived: number; elapsedMs: number; exitCode: number | null; stderr: string }
export interface ProcessStreamOptions { launch?: typeof spawn; inputFd?: number; onDiagnostic?: (message: string) => void; onTransfer?: (summary: TransferSummary) => void; mapFailure?: (stderr: string, code: number) => UploadValidationError }
export async function openProcessStream(executable: string, args: string[], signal: AbortSignal, options: ProcessStreamOptions = {}): Promise<OpenedVideo> {
  signal.throwIfAborted();
    const started = performance.now();
    const child = (options.launch ?? spawn)(executable, args, {
      shell: false, windowsHide: true, stdio: [options.inputFd ?? "ignore", "pipe", "pipe"],
    });
    const stdout = child.stdout;
    const stderrStream = child.stderr;
    if (!stdout || !stderrStream) { child.kill("SIGKILL"); throw new UploadValidationError("Não foi possível abrir o stream do downloader.", 503); }
    let stderr = "";
    let processError: Error | undefined;
    let closed = false;
    let bytesReceived = 0;
    let reported = false;
    const completion = new Promise<{ code: number | null; terminationSignal: string | null }>((resolve) => {
      child.once("error", (error) => { processError = error; });
      child.once("close", (code: number | null, terminationSignal: string | null) => {
        closed = true;
        resolve({ code, terminationSignal });
      });
    });
    // Drenar stderr independentemente do consumidor de vídeo; preservar a cauda com o erro final.
    stderrStream.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-16_384); });
    const stop = () => { if (!closed) child.kill("SIGKILL"); stdout.destroy(); };
    const aborted = () => stop();
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) stop();

    const content = Readable.from((async function* () {
      try {
        // O iterador só lê o próximo bloco quando o storage solicita; nenhum Buffer.concat de vídeo.
        for await (const chunk of stdout) {
          signal.throwIfAborted();
          if (!Buffer.isBuffer(chunk)) throw new UploadValidationError("O downloader retornou um stream inválido.", 502);
          bytesReceived += chunk.length;
          yield chunk;
        }
        const result = await completion;
        signal.throwIfAborted();
        if (processError) throw new UploadValidationError("Não foi possível iniciar o downloader de mídia.", 503);
        if (result.terminationSignal || result.code === null)
          throw new UploadValidationError("O downloader de mídia foi encerrado antes de concluir.", 502);
        if (result.code !== 0) throw (options.mapFailure?.(stderr, result.code) ?? downloaderError(stderr, "download", result.code));
        // EOF para o storage somente após stdout completo E processo encerrado com código zero.
      } catch (error) {
        stop();
        if (signal.aborted) throw signal.reason;
        if (processError) throw new UploadValidationError("Não foi possível iniciar o downloader de mídia.", 503);
        throw error instanceof UploadValidationError ? error
          : new UploadValidationError("O stream de mídia do downloader foi interrompido.", 502);
      }
    })(), { objectMode: false, highWaterMark: 64 * 1024 });
    // Uma falha pode chegar enquanto o storage está abrindo o parcial.
    content.on("error", () => {});
    return { content, dispose: async () => {
      stop();
      content.destroy();
      const result = await completion;
      signal.removeEventListener("abort", aborted);
      if (!reported) {
        reported = true;
        if (stderr) options.onDiagnostic?.(stderr);
        options.onTransfer?.({ bytesReceived, elapsedMs: performance.now() - started, exitCode: result.code, stderr });
      }
    } };

}
