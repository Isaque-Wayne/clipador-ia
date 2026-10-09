"use client";
import { useEffect, useState } from "react";
import { useProcessing } from "../hooks/use-processing";
import type { ProcessingStage } from "../types";
import styles from "./processing-panel.module.css";
const labels: Record<ProcessingStage, string> = {
  "not-started": "Vídeo recebido", "preparing-audio": "Preparando áudio", transcribing: "Transcrevendo", transcribed: "Transcrição concluída",
  analyzing: "Analisando conteúdo e áudio", "selecting-clips": "Selecionando melhores momentos", "planning-edits": "Planejando edição", "resolving-assets": "Preparando recursos de edição", "rendering-subtitles": "Preparando legendas", "rendering-clips": "Criando cortes", completed: "Finalizado", failed: "Processamento interrompido",
};
const emotionLabels: Record<string, string> = { enthusiasm: "Entusiasmo", surprise: "Surpresa", humor: "Humor", tension: "Tensão", indignation: "Indignação", inspiration: "Inspiração", curiosity: "Curiosidade", vulnerability: "Vulnerabilidade", confidence: "Confiança", energy: "Energia", urgency: "Urgência", reflection: "Reflexão" };
export function ProcessingPanel({ uploadId, onBusyChange }: { uploadId: string; onBusyChange?: (busy: boolean) => void }) {
  const { status, clips, error, busy, retry, warning, cancel } = useProcessing(uploadId);
  const [profile, setProfile] = useState("all"), [order, setOrder] = useState("score");
  const visible = clips.filter(clip => profile === "all" || clip.profile === profile).sort((a, b) => {
    const metric = (clip: typeof a) => order === "hook" ? clip.hookScore ?? 0 : order === "emotion" ? clip.emotionalStrength ?? 0 : order === "educational" ? clip.educationalScore ?? 0 : order === "duration" ? clip.duration : clip.score;
    return metric(b) - metric(a) || a.id.localeCompare(b.id);
  });
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  return <section className={`${styles["panel"]} glass-panel`} aria-label="Processamento e cortes">
    <h2>{clips.length ? `Seu portfólio · ${clips.length} cortes` : "Preparando seus cortes"}</h2>
    <p role="status" aria-live="polite" aria-atomic="true">{error ? "Não foi possível concluir esta tentativa." : labels[status.stage]}
      {busy && status.selectedCount !== undefined && ` · ${status.renderedCount ?? 0} de ${status.selectedCount} cortes concluídos`}</p>
    {!clips.length && !error && <p className={styles["hint"]}>Transcrição → momentos de várias durações → plano de edição → vídeos com legendas. O tempo depende da duração do vídeo.</p>}
    {busy && !warning && <p className={styles["hint"]}>O vídeo continua sendo processado. Esta etapa pode levar alguns minutos.</p>}
    {busy && status.stage === "transcribing" && status.progress && <p role="status">{status.progress.segmentsProcessed} segmentos transcritos · áudio processado até {Math.floor(status.progress.processedThroughSeconds / 60)}min{Math.floor(status.progress.processedThroughSeconds % 60)}s.</p>}
    {warning && <p role="status">{warning}</p>}
    {busy && <button type="button" className="button-secondary" onClick={() => void cancel()}>Cancelar processamento</button>}
    {error && <div role="alert" className={styles["error"]}><p>{error.message}</p><small>Código: {error.code}</small><div><button type="button" className="button-secondary" onClick={retry}>Tentar novamente</button></div></div>}
    {clips.length > 0 && <><p className={styles["hint"]}>Potencial e emoção inferidos por sinais textuais locais. Avalie o contexto antes de publicar.</p>
      <div className={styles["filters"]}><label>Tipo <select className="glass-input" value={profile} onChange={event => setProfile(event.target.value)}><option value="all">Todos</option>{["micro", "short", "standard", "extended"].map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
        <label>Ordenar <select className="glass-input" value={order} onChange={event => setOrder(event.target.value)}><option value="score">Melhores</option><option value="hook">Hook</option><option value="emotion">Emoção</option><option value="educational">Educacional</option><option value="duration">Duração</option></select></label></div>
      {!visible.length && <p>Nenhum corte deste perfil neste vídeo.</p>}<div className={styles["grid"]}>
      {visible.map((clip, index) => <article className={`${styles["clip"]} glass-subtle`} key={clip.id}>
        <video controls playsInline preload="metadata" src={clip.url} aria-label={`Preview do corte ${index + 1}`} />
        <div className={styles["body"]}><h3>{clip.title || `Corte ${index + 1}`}</h3><p className={styles["metrics"]}>{clip.duration.toFixed(1)} segundos <span>Potencial {clip.score.toFixed(1)}/100</span></p>
          <p className={styles["metrics"]}>{clip.profile?.toUpperCase()} {clip.editStyle && `· ${clip.editStyle}`} {clip.hookScore !== undefined && `· Hook ${clip.hookScore.toFixed(1)}/100`}</p>
          {!!clip.emotions?.length && <p>Sinais textuais: {clip.emotions.map(value => emotionLabels[value] ?? value).join(", ")}</p>}
          <p>{clip.reason}</p><div className={styles["actions"]}><a className="button-secondary" href={clip.url} target="_blank" rel="noreferrer">Assistir</a><a className="button-primary" href={`${clip.url}?download=1`} download={`${clip.id}.mp4`}>Baixar MP4</a></div></div>
      </article>)}
    </div></>}
  </section>;
}
