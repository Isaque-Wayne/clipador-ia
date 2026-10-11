"use client";
import { useState } from "react";
import type { PackagePreview as PackageData } from "./types";
import styles from "./package-preview.module.css";
const names:Record<string,string>={FULL_VERTICAL:"Vertical em tela cheia",TOP_BOTTOM:"Topo e base",SPLIT:"Conteúdo complementar",FULL_VIDEO:"Imagem preservada",CLEAN_PODCAST:"Podcast",FOCUS_DETAIL:"Detalhe",BLURRED_BACKGROUND:"Fundo com blur",GLASS_FRAME:"Moldura glass",MEDIA_STACK:"Mídias em camadas",HEADLINE_TOP:"Headline no topo",HEADLINE_CENTER:"Headline central"};
export function PackagePreview({videoUrl,title,packageData}:{videoUrl:string;title:string;packageData:PackageData|undefined}) {
  const [view,setView]=useState<"video"|"cover">("video");
  return <div className={styles["package"]}>
    {packageData&&<div className={styles["tabs"]} role="group" aria-label={`Preview de ${title}`}><button type="button" className="button-ghost" aria-pressed={view==="video"} onClick={()=>setView("video")}>Vídeo</button><button type="button" className="button-ghost" aria-pressed={view==="cover"} onClick={()=>setView("cover")}>Capa</button></div>}
    {view==="cover"&&packageData ? <img className={styles["media"]} src={packageData.thumbnailUrl} alt={`Capa: ${packageData.headline}`} width={1080} height={1920} loading="lazy"/> : <video className={styles["media"]} controls playsInline preload="none" src={videoUrl} poster={packageData?.thumbnailUrl} aria-label={title}/>}
    {packageData&&<div className={styles["info"]}><p>{names[packageData.template]??packageData.template} · Capa {packageData.thumbnailStyle}</p><p className={styles["platforms"]}>Shorts · Reels · TikTok</p><details><summary>Escolha da capa e pacote</summary><p>Frame original: {packageData.frameTimestamp.toFixed(2)}s</p><p>{packageData.selectionReason}</p><a href={packageData.sourceFrameUrl} target="_blank" rel="noreferrer">Ver frame original</a><p>Um vídeo compartilhado pelos três perfis. Revise as margens no aplicativo antes de publicar.</p></details><div className={styles["downloads"]}><a className="button-secondary" href={`${packageData.thumbnailUrl}?download=1`} download>Baixar capa</a><a className="button-ghost" href={`${packageData.metadataUrl}?download=1`} download>Baixar metadata</a></div></div>}
  </div>;
}
