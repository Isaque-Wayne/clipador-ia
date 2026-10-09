import Link from "next/link";
import { ProductPreview } from "../features/product-intro/components/product-preview";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <main id="main-content" className={styles["page"]}>
      <div className={styles["content"]}>
        <section className={styles["hero"]} aria-labelledby="intro-title">
          <div className={styles["copy"]}>
            <p className={styles["eyebrow"]}>MENOS RUÍDO. MAIS ATENÇÃO.</p>
            <h1 id="intro-title">Grandes histórias.<br /><span>Novos formatos.</span></h1>
            <p className={styles["lead"]}>Transforme vídeos longos em cortes com potencial para prender atenção.</p>
            <p className={styles["description"]}>Toda criação começa com um vídeo. Envie um arquivo ou cole um link do YouTube para dar o primeiro passo.</p>
            <Link href="/upload" className={`button-primary ${styles["start"]}`}>Começar <span aria-hidden="true">↗</span></Link>
            <p className={styles["hint"]}>Upload local ou YouTube. Você escolhe.</p>
          </div>
          <ProductPreview />
        </section>
        <footer className={styles["footer"]}>
          <span>Clipador IA</span>
          <span>Espaço para criar. Simplicidade para começar.</span>
        </footer>
      </div>
    </main>
  );
}
