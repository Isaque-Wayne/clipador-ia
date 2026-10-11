import type { StorageUsage } from "../types";
import { formatBytes } from "../services/library-api";
import styles from "./library.module.css";
export function StorageDashboard({ usage }: { usage: StorageUsage }) {
  return <section className={`glass-panel ${styles["storage"]}`} aria-label="Armazenamento">
    <h2>Armazenamento</h2><p>{formatBytes(usage.totalBytes)} usados · {usage.projectCount} projetos</p>
    <div className={styles["columns"]}>{[["Vídeos e dados", usage.uploadUsedBytes, usage.uploadLimitBytes], ["Cortes e temporários de render", usage.outputUsedBytes, usage.outputLimitBytes]].map(([label, used, limit]) => <div key={String(label)}><p>{label}: {formatBytes(Number(used))} de {formatBytes(Number(limit))}</p><progress value={Number(used)} max={Number(limit)} aria-label={String(label)} /></div>)}</div>
    <dl className={styles["stats"]}>{[["Originais", usage.originalBytes], ["Cortes finais e manifestos", usage.outputBytes], ["Transcrições e metadados", usage.artifactBytes], ["Temporários", usage.temporaryBytes], ["Outros arquivos", usage.unclassifiedBytes]].map(([label, bytes]) => <div key={String(label)}><dt>{label}</dt><dd>{formatBytes(Number(bytes))}</dd></div>)}</dl>
    <p className={styles["muted"]}>Quotas lógicas independentes. Espaço físico livre: {formatBytes(usage.freeDiskBytes)}. Os projetos salvos são mantidos até você excluir.</p>
    {!!usage.warnings.length && <p role="status">{usage.warnings.join(" ")}</p>}
  </section>;
}
