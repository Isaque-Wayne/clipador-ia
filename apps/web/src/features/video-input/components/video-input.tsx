"use client";

import { useState } from "react";
import { VideoUploadForm } from "../../video-upload/components/video-upload-form";
import { YouTubeIngestionForm } from "../../youtube-ingestion/components/youtube-ingestion-form";
import styles from "./video-input.module.css";

export function VideoInput() {
  const [mode, setMode] = useState<"file" | "youtube">("file");
  const [busy, setBusy] = useState(false);
  return <section className={styles["panel"]} aria-labelledby="video-input-title">
    <h2 id="video-input-title">Iniciar um projeto</h2>
    <p>Escolha de onde vem seu vídeo.</p>
    <div className={styles["selector"]} role="group" aria-label="Escolha como enviar o vídeo">
      <button type="button" disabled={busy} aria-pressed={mode === "file"} onClick={() => setMode("file")}>Enviar vídeo</button>
      <button type="button" disabled={busy} aria-pressed={mode === "youtube"} onClick={() => setMode("youtube")}>Link do YouTube</button>
    </div>
    {mode === "file" ? <VideoUploadForm onBusyChange={setBusy} /> : <YouTubeIngestionForm onBusyChange={setBusy} />}
  </section>;
}
