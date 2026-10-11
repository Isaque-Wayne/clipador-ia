import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";
import type { IngestionState } from "../types/ingestion";
import { ingestYouTube, waitForIngestion, cancelIngestion, retryYouTubeIngestion, IngestionError } from "../services/ingest-youtube";
import type { IngestionProgress, IngestionResult } from "../types/ingestion";

const pendingKey = "clipador.youtube.pending-job";
function remember(id?: string) { try { if (id) localStorage.setItem(pendingKey, id); else localStorage.removeItem(pendingKey); } catch { /* Storage may be disabled. */ } }

export function useYouTubeIngestion() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<IngestionState>({ status: "idle" });
  const active = useRef<AbortController | null>(null);
  const jobId = useRef<string | null>(null);
  function update(progress: IngestionProgress) {
    jobId.current = progress.id; remember(progress.id); setState({ status: "loading", progress });
  }
  async function run(abort: AbortController, operation: () => Promise<IngestionResult>, sourceUrl?: string) {
    active.current = abort; setState({ status: "loading" });
    try { const result = await operation(); if (!abort.signal.aborted) { remember(result.id); jobId.current = null; setState({ status: "success", result }); } }
    catch (error) {
      if (!abort.signal.aborted) {
        if (!(error instanceof IngestionError && ["API_UNAVAILABLE", "REQUEST_TIMEOUT"].includes(error.code))) remember();
        const retryUrl = sourceUrl ?? (error instanceof IngestionError ? error.sourceUrl : undefined);
        setState({ status: "error", message: error instanceof Error ? error.message : "Falha na ingestão.",
          ...(retryUrl ? { retryUrl } : {}),
          ...(error instanceof IngestionError && error.id ? { id: error.id } : {}) });
      }
    } finally { if (active.current === abort) active.current = null; }
  }
  useEffect(() => {
    let id: string | null = null;
    try { id = localStorage.getItem(pendingKey); } catch { /* Polling still works without localStorage. */ }
    const abort = new AbortController();
    if (id) void run(abort, () => waitForIngestion(id!, abort.signal, update));
    return () => { abort.abort(); active.current?.abort(); };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    let sourceUrl: string;
    try { sourceUrl = parseYouTubeUrl(url).url; }
    catch (error) { setState({ status: "error", message: error instanceof Error ? error.message : "URL inválida." }); return; }
    const abort = new AbortController();
    await run(abort, () => ingestYouTube(sourceUrl, abort.signal, update), sourceUrl);
  }
  async function cancel() {
    const id = jobId.current;
    if (!id) return;
    try { await cancelIngestion(id, new AbortController().signal); }
    catch (error) { setState(current => current.status === "loading" && current.progress
      ? { ...current, progress: { ...current.progress, warning: error instanceof Error ? error.message : "Não foi possível confirmar o cancelamento." } } : current); }
  }
  async function retry() {
    if (active.current || state.status !== "error" || !state.id) return;
    const id = state.id, sourceUrl = state.retryUrl, abort = new AbortController();
    await run(abort, () => retryYouTubeIngestion(id, abort.signal, update, sourceUrl), sourceUrl);
  }
  return { url, setUrl, state, submit, cancel, retry };
}
