import styles from "./product-preview.module.css";

export function ProductPreview() {
  return (
    <figure className={styles["preview"]} aria-labelledby="product-preview-caption">
      <div className={`${styles["window"]} glass-surface`} aria-hidden="true">
        <div className={styles["toolbar"]}>
          <span className={styles["windowMark"]}>◧</span>
          <span>Do vídeo ao corte</span>
          <span className={styles["concept"]}>VISÃO DO PRODUTO</span>
        </div>
        <div className={`${styles["original"]} glass-subtle`}>
          <span className={styles["label"]}>01 / VÍDEO ORIGINAL</span>
          <div className={styles["landscape"]}>
            <svg viewBox="0 0 400 180" fill="none" preserveAspectRatio="xMidYMid slice">
              <circle cx="295" cy="48" r="22" fill="#d9cbb4" opacity=".75" />
              <path d="M0 180V130L95 42l104 138H0Z" fill="#706d86" />
              <path d="m110 180 108-119 182 90v29H110Z" fill="#42475c" />
              <path d="M0 165 110 126l160 54H0Z" fill="#292d3c" />
            </svg>
            <span className={styles["frameMark"]}>Seu ponto de partida</span>
          </div>
          <div className={styles["timeline"]}><span /><span /><span /><span /><span /></div>
        </div>
        <div className={styles["analysis"]}><span>↓</span><span>02 / ANÁLISE</span><span>↓</span></div>
        <div className={styles["cuts"]}>
          <div className={styles["vertical"]}><div className={styles["portrait"]} /><span>Um novo olhar</span></div>
          <div className={styles["vertical"]}><div className={styles["portrait"]} /><span>Outra perspectiva</span></div>
          <div className={styles["cutLabel"]}><span>03</span><strong>Cortes<br />verticais</strong><small>Novas formas de contar.</small></div>
        </div>
      </div>
      <figcaption id="product-preview-caption">Composição ilustrativa. Análise e criação de cortes fazem parte das próximas etapas.</figcaption>
    </figure>
  );
}
