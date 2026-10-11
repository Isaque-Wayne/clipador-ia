import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir,readFile,readdir,writeFile,lstat } from "node:fs/promises";
import { resolve,join,relative } from "node:path";
import { performance } from "node:perf_hooks";
import { createUploadService } from "../../apps/api/dist/features/uploads/services/receive-video.js";
import { createClipStorage,fileChecksum } from "../../apps/api/dist/features/clip-rendering/services/clip-storage.js";
import { renderClips } from "../../apps/api/dist/features/clip-rendering/services/render-clips.js";
import { createResourceGate } from "../../apps/api/dist/features/processing/services/resource-gate.js";
import { prepareRenderPlans } from "../../apps/api/dist/features/editing/planning/prepare-render-plans.js";
import { PortfolioAnalysisProvider } from "../../apps/api/dist/features/portfolio/services/portfolio-provider.js";
import { selectFinalPortfolio } from "../../apps/api/dist/features/portfolio/services/final-selection.js";
import { inspectVideo } from "../../apps/api/dist/features/video-preparation/services/inspect-video.js";
import { validateSocialOutput } from "../../apps/api/dist/features/clip-rendering/services/validate-social-output.js";
import { createServer } from "../../apps/api/dist/server/create-server.js";
import { openMediaInput } from "../../apps/api/dist/features/video-preparation/services/open-media-input.js";
import { runRenderProcess } from "../../apps/api/dist/features/clip-rendering/services/render-process.js";
import { mediaTool } from "../../apps/api/dist/features/youtube-ingestion/services/ffmpeg-runner.js";

const sourceRoot=resolve(process.argv[2]??"apps/api/.data/long-video-validation/2026-10-09T00-23-21-111Z/uploads/58c33abb-00b2-4ca5-84ae-c9ba67e69a35");
const root=resolve("apps/api/.data/vertical-quality-validation",new Date().toISOString().replaceAll(":","-"));await mkdir(root,{recursive:true});
const sourceMetadata=JSON.parse(await readFile(join(sourceRoot,"metadata.json"),"utf8"));
const transcript=JSON.parse(await readFile(join(sourceRoot,"transcript.json"),"utf8")).transcript;
const oldReport=JSON.parse(await readFile(join(sourceRoot,"portfolio.json"),"utf8")).report;
const signal=new AbortController().signal,uploads=createUploadService({directory:join(root,"uploads")});await uploads.initialize();
const uploaded=await uploads.receiveVideo(createReadStream(join(sourceRoot,`video${sourceMetadata.extension}`)),sourceMetadata.file.name,sourceMetadata.file.type,signal,sourceMetadata.file.size);
const id=uploaded.id;assert.equal(uploads.findUpload(id).checksum.value,sourceMetadata.checksum.value);
const report=await new PortfolioAnalysisProvider().analyze({uploadId:id,transcript,audio:oldReport.portfolio.audio},signal);
const selection=selectFinalPortfolio(report,"maximum");
await writeFile(join(root,"selection-audit.json"),JSON.stringify({analysis:report.portfolio.metrics,...selection},null,2),{flag:"wx"});
console.log(JSON.stringify({root,id,analysis:report.portfolio.metrics,summary:selection.summary}));
const storage=createClipStorage(join(root,"outputs"));await storage.initialize();
const pilot=["micro","short","standard","extended"].map(profile=>{const candidate=selection.candidates.find(item=>item.profile===profile);assert.ok(candidate,`Real eligible ${profile} required`);return candidate;});
const gate=createResourceGate(),started=performance.now();
async function render(candidates,selectionSummary) {
  const plans=await prepareRenderPlans(uploads,id,transcript,report,candidates,"AUTO",signal,()=>{});
  return renderClips({uploads,storage,gate,uploadId:id,report,transcript,candidates,plans,signal,timeoutMs:300000,
    ...(selectionSummary?{selection:selectionSummary}:{}),onStage:(stage,done,total)=>console.log(`${stage} ${done}/${total}`),onDiagnostic:message=>console.log(message)});
}
async function inspectBatch(batch,name) {
  const checks=[];
  for(const clip of batch.clips) {
    const path=join(root,"outputs",id,batch.batchId,clip.file),inspection=await inspectVideo({path,identity:await lstat(path,{bigint:true})},signal);
    validateSocialOutput(inspection,clip.editPlan.outputDuration);assert.equal(await fileChecksum(path),clip.checksum);
    assert.equal(clip.finalQuality.renderEligible,true);assert.ok(clip.finalQuality.finalScore>=58);
    const pkg=JSON.parse(await readFile(join(root,"outputs",id,batch.batchId,clip.socialPackage.metadata.file),"utf8"));
    const group=clip.editPlan.captions.groups.find(item=>item.words.length>=4)??clip.editPlan.captions.groups[0];
    const stamp=Math.min(clip.duration-.1,group.start+.15),snapshot=`${name}-${clip.id}.jpg`;
    const pinned=await openMediaInput({path,identity:await lstat(path,{bigint:true})});
    try {await runRenderProcess({executable:await mediaTool("ffmpeg"),cwd:root,inputFd:pinned.fd,timeoutMs:15000,args:["-hide_banner","-loglevel","error","-nostdin","-n","-protocol_whitelist","fd,file,pipe","-fd","0","-ss",stamp.toFixed(3),"-i","fd:","-frames:v","1","-an","-vf","scale=540:960","-q:v","3","-f","image2","-update","1",snapshot]},signal);} finally {await pinned.close();}
    checks.push({id:clip.id,title:clip.candidate.title,profile:clip.candidate.profile,start:clip.start,end:clip.end,duration:clip.duration,
      width:inspection.width,height:inspection.height,videoCodec:inspection.videoCodec,audio:inspection.audio,bytes:clip.size,checksum:clip.checksum,
      renderSeconds:clip.metadata.renderSeconds,finalQuality:clip.finalQuality,template:clip.visualCompositionPlan.template,foreground:clip.visualCompositionPlan.foreground,reason:clip.visualCompositionPlan.reason,
      captions:clip.metadata.cueCount,fontSize:clip.editPlan.captions.fontSize,zoomEvents:clip.editPlan.zoomEvents.length,
      snapshot,video:relative(root,path),thumbnail:relative(root,join(root,"outputs",id,batch.batchId,clip.socialPackage.thumbnail.file)),
      frameTimestamp:pkg.thumbnailPlan.frameTimestamp,metadata:relative(root,join(root,"outputs",id,batch.batchId,clip.socialPackage.metadata.file))});
  }
  return checks;
}
// Four real durations are validated first, then a complete capped batch is rendered.
const pilotBatch=await render(pilot),pilotChecks=await inspectBatch(pilotBatch,"pilot");
await writeFile(join(root,"pilot.json"),JSON.stringify({batchId:pilotBatch.batchId,checks:pilotChecks},null,2),{flag:"wx"});
console.log(JSON.stringify({pilot:pilotChecks.map(clip=>({profile:clip.profile,duration:clip.duration,dimensions:[clip.width,clip.height],snapshot:join(root,clip.snapshot)}))}));
const batch=await render(selection.candidates,selection.summary),checks=await inspectBatch(batch,"final");
assert.ok(batch.clips.length<=20);assert.equal(batch.clips.length,selection.summary.selected);await storage.read(id,batch.batchId,true);
assert.deepEqual(await readdir(join(root,"outputs",".work")),[]);
const server=createServer({directory:join(root,"uploads")},{},{},{directory:join(root,"outputs")});server.log.level="silent";await server.ready();
const get=[];
try {
  assert.equal((await server.inject("/health")).statusCode,200);
  const result=await server.inject(`/uploads/${id}/portfolio/clips`);assert.equal(result.statusCode,200);assert.deepEqual(result.json().batch.selection,selection.summary);
  const tooMany=await server.inject({method:"POST",url:`/uploads/${id}/portfolio/process`,payload:{candidateIds:report.candidates.slice(0,21).map(candidate=>candidate.id)}});assert.equal(tooMany.statusCode,400);
  for(const clip of checks) {
    const base=`/uploads/${id}/clips/${batch.batchId}/${clip.id}`;
    const video=await server.inject({url:`${base}/file`,headers:{range:"bytes=0-31"}});assert.equal(video.statusCode,206);assert.equal(video.rawPayload.length,32);
    const thumbnail=await server.inject(`${base}/thumbnail`),metadata=await server.inject(`${base}/metadata`),frame=await server.inject(`${base}/source-frame`);
    assert.equal(thumbnail.statusCode,200);assert.equal(metadata.statusCode,200);assert.equal(frame.statusCode,200);get.push({id:clip.id,video:206,thumbnail:200,metadata:200,sourceFrame:200});
  }
} finally {await server.close();await uploads.drain();}
const escape=text=>String(text).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
const url=path=>path.replaceAll("\\","/");
const result={root,id,batchId:batch.batchId,sourceHash:sourceMetadata.checksum.value,analysis:report.portfolio.metrics,selection:selection.summary,pilot:pilotChecks,checks,get,
  seconds:(performance.now()-started)/1000,usage:await storage.usage(),workEntries:await readdir(join(root,"outputs",".work"))};
await writeFile(join(root,"result.json"),JSON.stringify(result,null,2),{flag:"wx"});
await writeFile(join(root,"qa.html"),`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipador · Vertical e qualidade</title><style>body{background:#101724;color:#edf3fb;font:16px Arial;margin:24px}main{max-width:1200px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}article{padding:16px;border:1px solid #354456;border-radius:16px}img,video{display:block;width:100%;max-width:270px;margin:auto;aspect-ratio:9/16}h2{font-size:18px}p{line-height:1.5}a{color:#a0d7e9}</style><main><h1>Vertical correto + quality gate</h1><p>${selection.summary.analyzed} analisados → ${selection.summary.qualityPassed} passam qualidade → ${selection.summary.duplicatesRemoved} duplicados removidos → ${checks.length} finais. ${escape(JSON.stringify(selection.summary.distribution))}. Fonte horizontal real; crop severo sem evidência usa blur e quadro inteiro em toda a largura.</p><div class="grid">${checks.map(clip=>`<article><h2>${escape(clip.title)}</h2><p>${clip.profile} · ${clip.duration.toFixed(2)}s · ${clip.template}</p><img src="${url(clip.snapshot)}" alt="Frame com legenda"><video controls preload="none" src="${url(clip.video)}"></video><p>1080×1920 · H.264/AAC · ${clip.captions} grupos de legenda</p><a href="${url(clip.thumbnail)}">Capa separada</a> · <a href="${url(clip.metadata)}">Metadata</a></article>`).join("")}</div></main></html>`,{flag:"wx"});
console.log(JSON.stringify({root,id,batchId:batch.batchId,selection:selection.summary,seconds:result.seconds,usage:result.usage,workEntries:result.workEntries},null,2));
