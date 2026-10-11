"use client";
import { useEffect, useState } from "react";
import type { ClipCard, ProcessingStatus } from "../types";
import { parseClipCards, parseProcessingStatus, processingRequest, ProcessingApiError } from "../services/processing-api";
export function useProcessing(uploadId: string) {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<ProcessingStatus>({ uploadId, stage: "not-started" });
  const [clips, setClips] = useState<ClipCard[]>([]);
  const [error, setError] = useState<NonNullable<ProcessingStatus["error"]> | null>(null);
  const [busy, setBusy] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true); setError(null); setClips([]); setWarning(null);
    async function run() {
      try {
        try { await processingRequest(uploadId, "portfolio/process", "POST", abort.signal); }
        catch (failure) { if (!(failure instanceof ProcessingApiError && failure.code === "IN_PROGRESS")) throw failure; }
        while (!abort.signal.aborted) {
          let result;
          try { result = await processingRequest(uploadId, "portfolio/process/status", "GET", abort.signal); setWarning(null); }
          catch (failure) {
            if (!(failure instanceof ProcessingApiError) || !["REQUEST_TIMEOUT", "API_UNAVAILABLE"].includes(failure.code)) throw failure;
            setWarning(failure.message);
            await new Promise<void>(resolve => {
              const timer = setTimeout(done, 3000);
              function done() { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); }
              abort.signal.addEventListener("abort", done, { once: true });
              if (abort.signal.aborted) done();
            });
            continue;
          }
          const next = parseProcessingStatus(result["status"], uploadId); setStatus(next);
          if (next.stage === "not-started") throw new ProcessingApiError("INTERRUPTED", "A API reiniciou ou o job foi interrompido. Os resultados concluídos foram preservados; tente novamente para reutilizá-los.");
          if (next.stage === "failed") {
            try { const saved = await processingRequest(uploadId, "portfolio/clips", "GET", abort.signal); setClips(parseClipCards(saved["batch"], uploadId)); } catch { /* No completed outputs yet. */ }
            throw new ProcessingApiError(next.error?.code ?? "PROCESSING_FAILED", next.error?.message ?? "O processamento falhou.", next.error);
          }
          if (next.stage === "completed") {
            const output = await processingRequest(uploadId, "portfolio/clips", "GET", abort.signal);
            setClips(parseClipCards(output["batch"], uploadId)); break;
          }
          await new Promise<void>(resolve => {
            const timer = setTimeout(done, 1000);
            function done() { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); }
            abort.signal.addEventListener("abort", done, { once: true });
          });
        }
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure instanceof ProcessingApiError ? { ...failure.details, code: failure.code, message: failure.message } : { code: "UNEXPECTED_ERROR", message: "Não foi possível consultar os cortes." });
      } finally { if (!abort.signal.aborted) setBusy(false); }
    }
    void run();
    return () => abort.abort();
  }, [uploadId, attempt]);
  async function cancel() {
    try { await processingRequest(uploadId, "portfolio/process", "DELETE", new AbortController().signal); }
    catch (failure) { setWarning(failure instanceof Error ? failure.message : "Não foi possível confirmar o cancelamento."); }
  }
  return { status, clips, error, busy, warning, cancel, retry: () => setAttempt(value => value + 1) };
}
