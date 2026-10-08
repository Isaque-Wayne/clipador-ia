import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { parseYouTubeUrl } from "../../../../../../config/youtube-url.mjs";
import type { IngestionState } from "../types/ingestion";
import { ingestYouTube, IngestionError } from "../services/ingest-youtube";

export function useYouTubeIngestion() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<IngestionState>({ status: "idle" });
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current) return;
    try { parseYouTubeUrl(url); }
    catch (error) { setState({ status: "error", message: error instanceof Error ? error.message : "URL inválida." }); return; }
    const abort = new AbortController();
    active.current = abort;
    setState({ status: "loading" });
    try { const result = await ingestYouTube(url, abort.signal); if (!abort.signal.aborted) setState({ status: "success", result }); }
    catch (error) {
      if (!abort.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Falha na ingestão.",
        ...(error instanceof IngestionError && error.id ? { id: error.id } : {}) });
    } finally { active.current = null; }
  }
  return { url, setUrl, state, submit };
}
