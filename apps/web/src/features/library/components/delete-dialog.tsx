"use client";
import { useEffect, useRef, useState } from "react";
import type { Project } from "../types";
import { formatBytes, libraryRequest } from "../services/library-api";
import styles from "./library.module.css";
export function DeleteDialog({ project, scope, onClose, onDeleted }: { project: Project; scope: "project" | "outputs"; onClose: () => void; onDeleted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function remove() {
    setBusy(true); setError(null);
    try { await libraryRequest(`projects/${project.id}${scope === "outputs" ? "/outputs" : ""}`, "DELETE"); onDeleted(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Não foi possível excluir."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className={`${styles["dialog"]} glass-elevated`} aria-labelledby="delete-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="delete-title">{scope === "project" ? "Excluir projeto?" : "Excluir todos os cortes?"}</h2><p>{project.title}</p>
    <p>{scope === "project" ? "O vídeo original, a transcrição, a análise e todos os cortes deste projeto serão removidos." : "Todos os cortes e lotes deste projeto serão removidos. O original, a transcrição e a análise serão preservados para gerar cortes novamente."}</p>
    <p>Espaço previsto: <strong>{formatBytes(scope === "project" ? project.totalBytes : project.outputDeletionBytes ?? project.outputBytes)}</strong>. Esta ação não pode ser desfeita.</p>
    {error && <p role="alert">{error}</p>}<div className={styles["actions"]}><button autoFocus className="button-secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className={styles["danger"]} disabled={busy || project.active} onClick={() => void remove()}>{busy ? "Excluindo…" : "Confirmar exclusão"}</button></div>
  </dialog>;
}
