import Link from "next/link";
import styles from "./site-header.module.css";

export function SiteHeader() {
  return (
    <header className={`${styles["header"]} glass-elevated`}>
      <Link href="/" className={styles["brand"]} aria-label="Clipador IA — início">
        <span className={styles["mark"]} aria-hidden="true">C</span>
        Clipador <span className={styles["accent"]}>IA</span>
      </Link>
      <nav aria-label="Navegação principal" className={styles["navigation"]}>
        <Link href="/" className="button-ghost">Início</Link>
        <Link href="/upload" className="button-secondary">Enviar vídeo <span aria-hidden="true">↗</span></Link>
      </nav>
    </header>
  );
}
