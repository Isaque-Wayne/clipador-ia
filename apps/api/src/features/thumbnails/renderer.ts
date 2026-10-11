import { rename, unlink, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { ThumbnailPlan } from "./types.js";
import { THUMBNAIL_VERSION, THUMBNAIL_STYLES } from "./types.js";
import { validRegion, validSafeArea } from "../visual-composition/validation.js";
import { compositionFilters } from "../visual-composition/filter-graph.js";
import { assHeader, glassPanel, headlineEvent } from "../visual-composition/overlays-ass.js";
import { VISUAL_VERSION } from "../visual-composition/types.js";
import type { VisualCompositionPlan } from "../visual-composition/types.js";
import { mediaTool } from "../youtube-ingestion/services/ffmpeg-runner.js";
import { runRenderProcess } from "../clip-rendering/services/render-process.js";
import { validateImage } from "./image-validation.js";
import { isCandidateId } from "../analysis/services/analysis-persistence.js";

export function validateThumbnailPlan(plan: ThumbnailPlan) {
  if(plan.version!==THUMBNAIL_VERSION||!isCandidateId(plan.clipId)||!THUMBNAIL_STYLES.includes(plan.style)||plan.width!==1080||plan.height!==1920||!validRegion(plan.headline.region)||!validRegion(plan.foreground)
    ||!validSafeArea(plan.safeAreas)||!Number.isFinite(plan.frameTimestamp)||plan.frameTimestamp<0||!Number.isFinite(plan.headline.fontSize)||plan.headline.fontSize<64||plan.headline.fontSize>96||plan.headline.lines.length<1||plan.headline.lines.length>3
    ||plan.headline.text.trim().split(/\s+/).filter(Boolean).length<1||plan.headline.text.split(/\s+/).length>6) throw new Error("Invalid thumbnail plan");
  const r=plan.headline.region,s=plan.safeAreas;
  if(r.x<s.left||r.x+r.width>1-s.right+.001||r.y<s.top||r.y+r.height>1-s.bottom+.001||plan.headline.lines.length*plan.headline.fontSize*1.18>r.height*1920-20||plan.validation.estimatedTextWidth>r.width*1080-48) throw new Error("Headline exceeds safe/readable region");
  if(plan.crop!==null&&!validRegion(plan.crop)||!Number.isFinite(plan.background.blurSigma)||plan.background.blurSigma<0||plan.background.blurSigma>24||!Number.isFinite(plan.background.darkness)||plan.background.darkness<.2||plan.background.darkness>.8) throw new Error("Invalid thumbnail background/crop");
  return plan;
}
export async function renderThumbnail(plan:ThumbnailPlan,sourceFrame:string,work:string,signal:AbortSignal) {
  validateThumbnailPlan(plan);
  const imageName=basename(sourceFrame); if(!/^(frame-[a-f0-9]{24}|c_[a-f0-9]{16}\.source)\.jpg$/.test(imageName)||join(work,imageName)!==sourceFrame) throw new Error("Unsafe source frame path");
  const assName=`${plan.clipId}.cover.ass`,graphName=`${plan.clipId}.cover.ffgraph`,partialName=`${plan.clipId}.jpg.part`,file=`${plan.clipId}.jpg`;
  const visual:VisualCompositionPlan={version:VISUAL_VERSION,clipId:plan.clipId,template:"BLURRED_BACKGROUND" as const,reason:plan.reason,
    background:{kind:"blurred-video" as const,blurSigma:plan.background.blurSigma,darkness:plan.background.darkness},foreground:plan.foreground,sourceCrop:plan.crop,focalRegion:plan.focalRegion,auxiliaryFrameTimestamp:null,overlays:[],safeArea:plan.safeAreas,
    identity:{font:"Arial" as const,accent:"#A0D7E9" as const,ink:"#101724" as const,radius:24 as const},limitations:[]};
  const graph=compositionFilters("[0:v:0]","[coverbase]",visual,1080,1920,"cover");
  graph.push(`[coverbase]ass=filename=${assName}[out]`);
  const text=assHeader(1080,1920)+glassPanel(plan.headline.region,1080,1920,1,plan.overlays[0]?.opacity??.65)+headlineEvent(plan.headline.text,plan.headline.region,1080,1920,1,plan.headline.fontSize)
    + `Dialogue: 5,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\an7\\pos(132,324)\\fs22\\bord0\\shad0\\c&HE9D7A0&}CLIPADOR IA\n`;
  await writeFile(join(work,assName),text,{flag:"wx",mode:0o600});
  await writeFile(join(work,graphName),graph.join(";\n"),{flag:"wx",mode:0o600});
  const executable=await mediaTool("ffmpeg");
  await runRenderProcess({executable,cwd:work,timeoutMs:20000,args:["-hide_banner","-loglevel","error","-nostdin","-n","-threads","2","-protocol_whitelist","file,pipe","-i",imageName,"-/filter_complex",graphName,"-filter_complex_threads","1","-map","[out]","-frames:v","1","-an","-q:v","3","-f","image2","-update","1",partialName]},signal);
  const image=await validateImage(join(work,partialName),file,{width:1080,height:1920});
  // Decode once: headers alone cannot detect damaged image payloads.
  await runRenderProcess({executable,cwd:work,timeoutMs:10000,args:["-hide_banner","-loglevel","error","-nostdin","-protocol_whitelist","file","-i",partialName,"-frames:v","1","-f","null","-"]},signal);
  await rename(join(work,partialName),join(work,file)); await unlink(join(work,assName)); await unlink(join(work,graphName));
  return image;
}
