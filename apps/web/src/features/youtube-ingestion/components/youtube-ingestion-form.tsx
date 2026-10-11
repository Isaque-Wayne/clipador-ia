"use client";

import { useEffect, useState } from "react";
import { ProcessingPanel } from "../../processing/components/processing-panel";
import { useYouTubeIngestion } from "../hooks/use-youtube-ingestion";
import { formatVideoSize, UPLOAD_MAX_FILE_LABEL } from "../../video-upload/utils/validate-video";
import styles from "./youtube-ingestion.module.css";
import resultStyles from "../../video-upload/components/upload-result.module.css";

export function YouTubeIngestionForm({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { url, setUrl, state, submit, cancel, retry } = useYouTubeIngestion();
  const loading = state.status === "loading";
  const [processingBusy, setProcessingBusy] = useState(false);
  const busy = loading || processingBusy;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  return (
    <form onSubmit={event => { if (busy) event.preventDefault(); else submit(event); }} aria-busy={busy} className={styles["form"]}>
      <label htmlFor="youtube-url">Link do YouTube</label>
      <p id="youtube-help">Cole o link de um vídeo público ou Shorts. Até {UPLOAD_MAX_FILE_LABEL}.</p>
      <input id="youtube-url" type="url" required maxLength={2048} value={url} disabled={busy}
        aria-describedby="youtube-help" placeholder="https://www.youtube.com/watch?v=…" onChange={(event) => setUrl(event.target.value)} />
      <button className="button-primary" type="submit" disabled={!url.trim() || busy}>{loading ? "Importando vídeo…" : "Importar do YouTube"}</button>
      <div aria-live="polite" aria-atomic="true">
        {state.status === "loading" && <><p role="status">{state.progress?.status === "merging" ? "Combinando vídeo e áudio…"
          : state.progress?.status === "fetching-metadata" ? "Consultando informações do YouTube…" : "Importando seu vídeo… Esta etapa pode levar alguns minutos."}
          {state.progress?.bytesReceived !== undefined && ` · ${formatVideoSize(state.progress.bytesReceived)} recebidos`}</p>
          {state.progress?.warning && <p role="status">{state.progress.warning}</p>}
          {state.progress && <button className="button-secondary" type="button" onClick={() => void cancel()}>Cancelar importação</button>}</>}
        {state.status === "success" && <section className={`${resultStyles["card"]} glass-panel`} aria-label="Resultado da ingestão">
          <span className={resultStyles["badge"]}>✓ Concluído</span>
          <h2>{state.result.video?.title ?? "Vídeo do YouTube"}</h2>
          {state.result.video?.thumbnailUrl && <img src={state.result.video.thumbnailUrl} width={320} height={180} alt="Miniatura do vídeo importado" />}
          <dl className={resultStyles["metadata"]}>
            <div><dt>Origem</dt><dd>YouTube</dd></div>
            <div><dt>Status</dt><dd>Importado com sucesso</dd></div>
            {state.result.video?.durationSeconds && <div><dt>Duração</dt><dd>{Math.round(state.result.video.durationSeconds)} segundos</dd></div>}
            <div><dt>Tamanho</dt><dd>{formatVideoSize(state.result.upload.file.size)}</dd></div>
            <div><dt>ID da ingestão</dt><dd><code>{state.result.id}</code></dd></div>
          </dl>
        </section>}
      </div>
      {state.status === "success" && <ProcessingPanel key={state.result.upload.id} uploadId={state.result.upload.id} onBusyChange={setProcessingBusy} />}
      {state.status === "error" && <div role="alert"><p>{state.message}</p>{state.id && <>
        <p>ID da tentativa: <code>{state.id}</code></p>
        <button className="button-secondary" type="button" disabled={busy} onClick={() => void retry()}>Tentar novamente</button>
      </>}</div>}
    </form>
  );
}
