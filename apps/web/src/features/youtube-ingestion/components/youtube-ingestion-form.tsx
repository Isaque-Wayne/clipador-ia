"use client";

import { useEffect } from "react";
import { useYouTubeIngestion } from "../hooks/use-youtube-ingestion";
import { formatVideoSize, UPLOAD_MAX_FILE_LABEL } from "../../video-upload/utils/validate-video";
import styles from "./youtube-ingestion.module.css";
import resultStyles from "../../video-upload/components/upload-result.module.css";

export function YouTubeIngestionForm({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { url, setUrl, state, submit } = useYouTubeIngestion();
  const loading = state.status === "loading";
  useEffect(() => { onBusyChange?.(loading); return () => onBusyChange?.(false); }, [loading, onBusyChange]);
  return (
    <form onSubmit={submit} aria-busy={loading} className={styles["form"]}>
      <label htmlFor="youtube-url">Link do YouTube</label>
      <p id="youtube-help">Cole o link de um vídeo público ou Shorts. Até {UPLOAD_MAX_FILE_LABEL}.</p>
      <input id="youtube-url" type="url" required maxLength={2048} value={url} disabled={loading}
        aria-describedby="youtube-help" placeholder="https://www.youtube.com/watch?v=…" onChange={(event) => setUrl(event.target.value)} />
      <button type="submit" disabled={!url.trim() || loading}>{loading ? "Importando vídeo…" : "Importar do YouTube"}</button>
      <div aria-live="polite" aria-atomic="true">
        {loading && <p role="status">Importando seu vídeo… As informações e o arquivo estão sendo preparados.</p>}
        {state.status === "success" && <section className={resultStyles["card"]} aria-label="Resultado da ingestão">
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
      {state.status === "error" && <div role="alert"><p>{state.message}</p>{state.id && <p>ID da tentativa: <code>{state.id}</code></p>}</div>}
    </form>
  );
}
