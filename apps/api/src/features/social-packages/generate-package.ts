import { constants } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaInput } from "../video-preparation/types/preparation.js";
import type { RenderedClip } from "../clip-rendering/types.js";
import type { VisualCompositionPlan } from "../visual-composition/types.js";
import { createFrameCache } from "../thumbnails/frame-cache.js";
import { rankFrames } from "../thumbnails/frame-ranking.js";
import { buildThumbnailPlan } from "../thumbnails/planner.js";
import { renderThumbnail } from "../thumbnails/renderer.js";
import { validateImage } from "../thumbnails/image-validation.js";
import { digest } from "../analysis/services/analysis-persistence.js";
import { fileChecksum } from "../clip-rendering/services/clip-storage.js";
import { platformProfiles } from "./platform-profiles.js";
import { SOCIAL_PACKAGE_VERSION, PLATFORM_IDS } from "./types.js";
import type { SocialClipPackage, SocialPackageSummary } from "./types.js";

export const SOCIAL_ARTIFACT_BUDGET=5*1024*1024;
export async function generateSocialPackage(input:{clip:RenderedClip;visual:VisualCompositionPlan;source:MediaInput;sourceHash:string;projectId:string;work:string;signal:AbortSignal}):Promise<SocialPackageSummary> {
  const {clip,visual,source,sourceHash,projectId,work}=input, edit=clip.editPlan;
  if(!edit) throw new Error("Social package needs an edit plan");
  const signal=AbortSignal.any([input.signal,AbortSignal.timeout(90000)]);
  const cache=createFrameCache(source,`${projectId}:${sourceHash}`,work,signal);
  try {
    const ranking=await rankFrames(clip.candidate,edit,cache.sample), plan=buildThumbnailPlan(clip.candidate,edit,visual,ranking);
    const sourceName=`${clip.id}.source.jpg`,sourcePath=join(work,sourceName);
    await copyFile(await cache.image(plan.frameTimestamp),sourcePath,constants.COPYFILE_EXCL);
    const sourceFrame=await validateImage(sourcePath,sourceName), thumbnail=await renderThumbnail(plan,sourcePath,work,signal);
    const metadataName=`${clip.id}.package.json`;
    const title=clip.candidate.title,description=clip.candidate.description??clip.candidate.transcript.slice(0,600);
    const payload:Omit<SocialClipPackage,"checksum">={version:SOCIAL_PACKAGE_VERSION,clipId:clip.id,projectId,
      video:{file:clip.file,size:clip.size,checksum:clip.checksum,width:clip.width,height:clip.height,duration:clip.duration},thumbnail,sourceFrame,
      metadata:{file:metadataName,generatedAt:new Date().toISOString(),semanticMethod:"existing-analysis-and-transcript",warnings:[...visual.limitations,...(clip.assets?.warnings??[])]},
      platformProfiles:platformProfiles(title,description,thumbnail.file),editPlan:edit,visualCompositionPlan:visual,thumbnailPlan:plan,title,description,style:edit.style,
      score:clip.finalQuality?.finalScore??clip.candidate.potentialScore??clip.candidate.score.value,duration:clip.duration,...(clip.finalQuality?{finalQuality:clip.finalQuality}:{}),
      assets:[{kind:"source-video",id:projectId,checksum:sourceHash},{kind:"source-frame",id:sourceName,checksum:sourceFrame.checksum},...(clip.assets?.musicId ? [{kind:"licensed-music" as const,id:clip.assets.musicId}] : [])],
      capabilities:{downloadFiles:true,zip:false,regenerateThumbnail:"planned",chooseFrame:"planned",changeTemplate:"planned"}};
    const pkg:SocialClipPackage={...payload,checksum:{algorithm:"sha256",value:digest(payload)}};
    const data=JSON.stringify(pkg,null,2), size=Buffer.byteLength(data);
    if(size>1024*1024) throw new Error("Package metadata exceeded 1 MiB budget");
    await writeFile(join(work,metadataName),data,{flag:"wx",mode:0o600});
    return {version:SOCIAL_PACKAGE_VERSION,thumbnail,sourceFrame,metadata:{file:metadataName,size,checksum:await fileChecksum(join(work,metadataName))},template:visual.template,thumbnailStyle:plan.style,
      headline:plan.headline.text,frameTimestamp:plan.frameTimestamp,platforms:[...PLATFORM_IDS],selectionReason:plan.reason.join(" ")};
  } finally { await cache.cleanup(); }
}
