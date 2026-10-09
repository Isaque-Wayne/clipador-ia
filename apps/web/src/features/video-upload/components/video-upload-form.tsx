"use client";

import { useEffect, useState } from "react";
import { ProcessingPanel } from "../../processing/components/processing-panel";
import { useVideoUpload } from "../hooks/use-video-upload";
import { formatVideoSize, VIDEO_ACCEPT, UPLOAD_MAX_FILE_LABEL } from "../utils/validate-video";
import styles from "./video-upload-form.module.css";
import { UploadResult } from "./upload-result";

export function VideoUploadForm({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { file, state, selectFile, submit } = useVideoUpload();
  const uploading = state.status === "uploading";
  const [processingBusy, setProcessingBusy] = useState(false);
  const busy = uploading || processingBusy;
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);

  return (
    <form className={styles["form"]} aria-busy={busy} onSubmit={(event) => {
      event.preventDefault();
      if (!busy) void submit();
    }}>
      <label className={styles["dropzone"]} htmlFor="video-file"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (!busy) selectFile(event.dataTransfer.files[0] ?? null);
        }}>
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
          <path d="M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
        </svg>
        <strong>{file ? file.name : "Arraste seu vídeo até aqui"}</strong>
        <span>{file ? `${formatVideoSize(file.size)} · Clique para trocar o arquivo` : "ou clique para escolher um arquivo"}</span>
        <input id="video-file" type="file" accept={VIDEO_ACCEPT} disabled={busy}
          aria-label="Selecione seu vídeo" aria-describedby="video-help"
          onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
      </label>
      <p id="video-help" className={styles["help"]}>MP4, WebM ou MOV · Até {UPLOAD_MAX_FILE_LABEL}</p>
      <button className="button-primary" type="submit" disabled={!file || busy}>
        {uploading ? "Enviando vídeo…" : "Enviar vídeo"}
      </button>
      <div aria-live="polite" aria-atomic="true">
        {uploading && <p role="status">Enviando seu vídeo… Aguarde a confirmação.</p>}
        {state.status === "success" && <UploadResult result={state.result} />}
      </div>
      {state.status === "success" && <ProcessingPanel key={state.result.id} uploadId={state.result.id} onBusyChange={setProcessingBusy} />}
      {state.status === "error" && <p role="alert" className={styles["error"]}>{state.message}</p>}
    </form>
  );
}
