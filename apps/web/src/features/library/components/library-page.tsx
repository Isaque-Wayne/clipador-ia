"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Project, StorageUsage } from "../types";
import { formatBytes, formatDuration, libraryRequest, parseProjects, parseUsage, statusLabels } from "../services/library-api";
import { StorageDashboard } from "./storage-dashboard";
import { DeleteDialog } from "./delete-dialog";
import styles from "./library.module.css";
export function LibraryPage() {
  const [projects, setProjects] = useState<Project[]>([]), [usage, setUsage] = useState<StorageUsage | null>(null), [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0), [filter, setFilter] = useState("all"), [query, setQuery] = useState(""), [order, setOrder] = useState("recent"), [deletion, setDeletion] = useState<Project | null>(null);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError(null);
    void Promise.all([libraryRequest("projects", "GET", abort.signal), libraryRequest("storage/usage", "GET", abort.signal)]).then(([list, storage]) => {
      if (!abort.signal.aborted) { setProjects(parseProjects(list["projects"])); setUsage(parseUsage(storage["usage"])); }
    }).catch(failure => { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Falha ao abrir Biblioteca."); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [refresh]);
  const visible = projects.filter(project => (filter === "all" || project.status === filter) && project.title.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR"))).sort((a, b) => order === "space" ? b.totalBytes - a.totalBytes : order === "clips" ? b.clipCount - a.clipCount : order === "old" ? (a.createdAt ?? "").localeCompare(b.createdAt ?? "") : (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return <main id="main-content" className={styles["page"]}>
    <div className={styles["heading"]}><div><p className={styles["eyebrow"]}>SEU ESPAÇO DE CRIAÇÃO</p><h1>Biblioteca</h1><p>Vídeos e cortes salvos, prontos para continuar.</p></div><Link href="/upload" className="button-primary">Novo vídeo ↗</Link></div>
    {usage && <StorageDashboard usage={usage} />}
    <section className={`glass-panel ${styles["section"]}`} aria-label="Projetos salvos"><div className={styles["filters"]}>
      <label>Buscar título<input className="glass-input" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Encontre um vídeo…" /></label>
      <label>Status<select className="glass-input" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos</option><option value="completed">Concluídos</option><option value="processing">Em processamento</option><option value="failed">Falharam</option><option value="uploaded">Vídeos salvos</option></select></label>
      <label>Ordenar<select className="glass-input" value={order} onChange={event => setOrder(event.target.value)}><option value="recent">Mais recentes</option><option value="old">Mais antigos</option><option value="space">Maior espaço</option><option value="clips">Mais cortes</option></select></label><button className="button-secondary" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Atualizar</button>
    </div>{loading && <p role="status">Consultando projetos salvos…</p>}{error && <p role="alert">{error}</p>}{!loading && !error && !visible.length && <p>{projects.length ? "Nenhum projeto corresponde aos filtros." : "Sua Biblioteca está vazia. Envie um vídeo para começar."}</p>}
    <div className={styles["grid"]}>{visible.map(project => <article key={project.id} className={`glass-subtle ${styles["card"]}`}>
      <Link href={`/library/${project.id}`} className={styles["cover"]} aria-label={`Abrir ${project.title}`}>{project.thumbnail ? <img src={project.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden="true">▶</span>}</Link>
      <div className={styles["body"]}><p className={styles["muted"]}>{project.origin} · {statusLabels[project.status]}</p><h2><Link href={`/library/${project.id}`}>{project.title}</Link></h2><p>{formatDuration(project.duration)} · {project.createdAt ? new Date(project.createdAt).toLocaleString("pt-BR") : "Data indisponível"}</p>
      <p>{project.clipCount} cortes · Original {formatBytes(project.originalBytes)} · Outputs {formatBytes(project.outputBytes)}</p><p className={styles["muted"]}>Transcrição {project.hasTranscript ? "disponível" : "ausente"} · Análise {project.hasAnalysis ? "disponível" : "ausente"}</p>
      {!!project.warnings.length && <p role="status">{project.warnings[0]}</p>}<div className={styles["actions"]}><Link className="button-primary" href={`/library/${project.id}`}>Abrir projeto</Link><button className="button-ghost" disabled={project.active} onClick={() => setDeletion(project)}>Excluir projeto</button></div>{project.active && <small>Exclusão bloqueada enquanto o projeto está em uso.</small>}</div>
    </article>)}</div></section>
    {deletion && <DeleteDialog project={deletion} scope="project" onClose={() => setDeletion(null)} onDeleted={() => { setDeletion(null); setRefresh(value => value + 1); }} />}
  </main>;
}
