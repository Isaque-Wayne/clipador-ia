import Link from "next/link";
import { VideoInput } from "../../features/video-input/components/video-input";
import styles from "./page.module.css";

export default function UploadPage() {
  return (
    <main className={styles["page"]}>
      <div className={styles["content"]}>
        <header className={styles["header"]}>
          <Link href="/" className={styles["brand"]}>
            <span className={styles["mark"]} aria-hidden="true">C</span>
            Clipador <span>IA</span>
          </Link>
          <Link href="/" className={styles["back"]}>← Início</Link>
        </header>
        <div className={styles["intro"]}>
          <p className={styles["eyebrow"]}>SEU PRÓXIMO VÍDEO COMEÇA AQUI</p>
          <h1>Uma nova perspectiva<br />para seus vídeos.</h1>
          <p>Transforme vídeos longos em cortes prontos para publicar.</p>
        </div>
        <VideoInput />
        <p className={styles["footnote"]}>Seu vídeo fica salvo temporariamente para as próximas etapas.</p>
      </div>
    </main>
  );
}
