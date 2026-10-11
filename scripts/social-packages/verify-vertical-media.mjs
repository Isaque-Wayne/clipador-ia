import assert from "node:assert/strict";
import { readFile,writeFile,lstat,readdir } from "node:fs/promises";
import { resolve,join,relative } from "node:path";
import { runMediaTool,mediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";
import { openMediaInput } from "../../apps/api/dist/features/video-preparation/services/open-media-input.js";
import { inspectVideo } from "../../apps/api/dist/features/video-preparation/services/inspect-video.js";
import { validateSocialOutput } from "../../apps/api/dist/features/clip-rendering/services/validate-social-output.js";
import { createUploadService } from "../../apps/api/dist/features/uploads/services/receive-video.js";
import { createClipStorage } from "../../apps/api/dist/features/clip-rendering/services/clip-storage.js";
import { renderClips } from "../../apps/api/dist/features/clip-rendering/services/render-clips.js";
import { createRenderPlan } from "../../apps/api/dist/features/editing/rendering/render-plan.js";
import { buildVisualCompositionPlan } from "../../apps/api/dist/features/visual-composition/planner.js";
import { createResourceGate } from "../../apps/api/dist/features/processing/services/resource-gate.js";
import { runRenderProcess } from "../../apps/api/dist/features/clip-rendering/services/render-process.js";
const root=resolve(process.argv[2]),result=JSON.parse(await readFile(join(root,"result.json"),"utf8")),signal=new AbortController().signal;
const envelope=JSON.parse(await readFile(join(root,"outputs",result.id,result.batchId,"manifest.json"),"utf8")),batch=envelope.batch;
const source=join(root,"uploads",result.id,"video.mp4");
async function pcm(path,time,duration) {
  const input=await openMediaInput({path,identity:await lstat(path,{bigint:true})});let process;
  try {
    process=await runMediaTool("ffmpeg",["-hide_banner","-loglevel","error","-nostdin","-protocol_whitelist","fd,file,pipe","-fd","0","-ss",time.toFixed(3),"-i","fd:","-t",duration.toFixed(3),"-vn","-ac","1","-ar","16000","-f","s16le","pipe:1"],signal,{inputFd:input.fd});
    const chunks=[];let size=0;for await(const chunk of process.content){size+=chunk.length;assert.ok(size<=128000);chunks.push(chunk);}return Buffer.concat(chunks);
  } finally {await process?.dispose?.();await input.close();}
}
function correlation(a,b) {
  let cross=0,aa=0,bb=0;const count=Math.min(a.length,b.length)/2;
  for(let index=0;index<count;index++){const x=a.readInt16LE(index*2),y=b.readInt16LE(index*2);cross+=x*y;aa+=x*x;bb+=y*y;}
  return aa&&bb ? cross/Math.sqrt(aa*bb) : 0;
}
const audio=[];
for(const clip of batch.clips) {
  const span=clip.editPlan.timeline.find(span=>span.sourceEnd-span.sourceStart>=2);assert.ok(span);
  const offset=.4,duration=Math.min(1.5,span.sourceEnd-span.sourceStart-offset-.1);
  const original=await pcm(source,span.sourceStart+offset,duration),output=await pcm(join(root,"outputs",result.id,result.batchId,clip.file),span.outputStart+offset,duration);
  const value=correlation(original,output);assert.ok(value>.9,`${clip.id} audio correlation ${value}`);audio.push({id:clip.id,correlation:value,seconds:duration,sourceTimestamp:span.sourceStart+offset,outputTimestamp:span.outputStart+offset});
}
// Separate editorial demonstration: known central participant, not automatic speaker recognition.
const candidate=batch.report.candidates.find(candidate=>candidate.profile==="micro"&&candidate.start>1600&&batch.clips.some(clip=>clip.id===candidate.id));assert.ok(candidate);
const base=batch.clips.find(clip=>clip.id===candidate.id),uploads=createUploadService({directory:join(root,"uploads")});await uploads.initialize();
const sourceInspection=await inspectVideo({path:source,identity:await lstat(source,{bigint:true})},signal);
const visual=buildVisualCompositionPlan(candidate,base.editPlan,sourceInspection,{personRegion:{x:.40,y:.25,width:.15,height:.70}});assert.equal(visual.template,"FULL_VERTICAL");
const plan=createRenderPlan({...base.editPlan,framing:{...base.editPlan.framing,mode:"crop",reason:visual.reason[0]}},{warnings:["Região central indicada manualmente na validação; sem active speaker automático."]},visual);
const storage=createClipStorage(join(root,"outputs"));await storage.initialize();
const transcript=JSON.parse(await readFile(resolve("apps/api/.data/long-video-validation/2026-10-09T00-23-21-111Z/uploads/58c33abb-00b2-4ca5-84ae-c9ba67e69a35/transcript.json"),"utf8")).transcript;
const cropped=await renderClips({uploads,storage,gate:createResourceGate(),uploadId:result.id,report:batch.report,transcript,candidates:[candidate],plans:[plan],signal,timeoutMs:300000,onStage:()=>{}});
const crop=cropped.clips[0],path=join(root,"outputs",result.id,cropped.batchId,crop.file),inspection=await inspectVideo({path,identity:await lstat(path,{bigint:true})},signal);validateSocialOutput(inspection,crop.editPlan.outputDuration);
const pinned=await openMediaInput({path,identity:await lstat(path,{bigint:true})});
try {await runRenderProcess({executable:await mediaTool("ffmpeg"),cwd:root,inputFd:pinned.fd,timeoutMs:15000,args:["-hide_banner","-loglevel","error","-nostdin","-n","-protocol_whitelist","fd,file,pipe","-fd","0","-ss","1","-i","fd:","-frames:v","1","-an","-vf","scale=540:960","-q:v","3","-f","image2","-update","1","full-vertical.jpg"]},signal);} finally {await pinned.close();await uploads.drain();}
assert.deepEqual(await readdir(join(root,"outputs",".work")),[]);
const checks={audio,crop:{id:crop.id,batchId:cropped.batchId,width:inspection.width,height:inspection.height,checksum:crop.checksum,bytes:crop.size,video:relative(root,path),foreground:visual.foreground,sourceCrop:visual.sourceCrop,reason:visual.reason,snapshot:"full-vertical.jpg"},workEntries:[]};
await writeFile(join(root,"media-verification.json"),JSON.stringify(checks,null,2),{flag:"wx"});console.log(JSON.stringify({audioClips:audio.length,minimumCorrelation:Math.min(...audio.map(check=>check.correlation)),crop:checks.crop},null,2));
