import type { UploadSuccess } from "../types/upload";
import { formatVideoSize } from "../utils/validate-video";
import styles from "./upload-result.module.css";

export function UploadResult({ result }: { result: UploadSuccess }) {
  return (
    <section className={`${styles["card"]} glass-panel`} aria-labelledby="upload-result-title">
      <span className={styles["badge"]}>✓ Concluído</span>
      <h2 id="upload-result-title">{result.file.name}</h2>
      <dl className={styles["metadata"]}>
        <div><dt>Origem</dt><dd>Upload local</dd></div>
        <div><dt>Status</dt><dd>Enviado com sucesso</dd></div>
        <div><dt>Tamanho</dt><dd>{formatVideoSize(result.file.size)}</dd></div>
        <div><dt>Tipo</dt><dd>{result.file.type}</dd></div>
        <div><dt>ID do upload</dt><dd><code>{result.id}</code></dd></div>
      </dl>
    </section>
  );
}
