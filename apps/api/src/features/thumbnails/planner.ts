import type { CutCandidate } from "../analysis/candidate.js";
import type { EditPlan } from "../editing/types.js";
import type { VisualCompositionPlan } from "../visual-composition/types.js";
import { COMMON_SAFE_AREA } from "../social-packages/platform-profiles.js";
import { shortHeadline, fitHeadline } from "./headline.js";
import { THUMBNAIL_VERSION } from "./types.js";
import type { FrameRank, ThumbnailPlan, ThumbnailStyle } from "./types.js";
export function buildThumbnailPlan(candidate: CutCandidate, edit: EditPlan, visual: VisualCompositionPlan, ranking: FrameRank[]): ThumbnailPlan {
  const chosen=ranking[0]; if(!chosen) throw new Error("Thumbnail requires ranked frame");
  const style: ThumbnailStyle=edit.style==="DYNAMIC" ? (candidate.hookScore && candidate.hookScore.value>=75 ? "BOLD" : "DYNAMIC") : edit.style==="PODCAST" ? "PODCAST" : edit.style==="EMOTIONAL" ? "EMOTIONAL" : edit.style==="EDUCATIONAL" ? "EDUCATIONAL" : "CLEAN";
  const preferred={CLEAN:78,BOLD:96,PODCAST:76,EMOTIONAL:72,EDUCATIONAL:82,DYNAMIC:88}[style];
  const region={x:.10,y:.205,width:.68,height:.19};
  const fit=fitHeadline(shortHeadline(candidate),region.width*1080-56,preferred);
  return {version:THUMBNAIL_VERSION,clipId:candidate.id,frameTimestamp:chosen.timestamp,ranking,
    background:{kind:"blurred-frame",blurSigma:16,darkness:style==="BOLD" ? .56 : .46},crop:null,focalRegion:visual.focalRegion,
    headline:{text:fit.text,lines:fit.lines,fontSize:fit.fontSize,region},subtitle:null,layout:"frame-and-headline",style,
    foreground:{x:.10,y:.415,width:.68,height:.24},overlays:[{kind:"title-bar",text:fit.text,region,opacity:style==="EMOTIONAL" ? .52 : .68}],
    safeAreas:{...COMMON_SAFE_AREA},width:1080,height:1920,
    reason:[chosen.reason,`Ranking ${chosen.score.toFixed(3)}: evidência semântica + contraste/brilho/nitidez/estabilidade.`,"Headline derivada do texto existente; sem criação de promessa ou marketing.",...(fit.text.split(/\s+/).length<2 ? ["Texto disponível contém apenas uma palavra; preservado sem inventar complemento."] : []),...visual.limitations],
    validation:{estimatedTextWidth:fit.estimatedTextWidth,minimumFontSize:64,withinSafeArea:true,contrastBacking:true}};
}
