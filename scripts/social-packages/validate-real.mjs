import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { createUploadService } from "../../apps/api/dist/features/uploads/services/receive-video.js";
import { createClipStorage, fileChecksum } from "../../apps/api/dist/features/clip-rendering/services/clip-storage.js";
import { renderClips } from "../../apps/api/dist/features/clip-rendering/services/render-clips.js";
import { createResourceGate } from "../../apps/api/dist/features/processing/services/resource-gate.js";
import { prepareRenderPlans } from "../../apps/api/dist/features/editing/planning/prepare-render-plans.js";
import { parseReport, digest } from "../../apps/api/dist/features/analysis/services/analysis-persistence.js";
import { createServer } from "../../apps/api/dist/server/create-server.js";

const sourceId="476e89fd-2062-4f8b-976b-ec44c168ff03";
const sourceRoot=resolve(process.argv[2]??`apps/api/.data/uploads/${sourceId}`);
const root=resolve("apps/api/.data/social-package-validation",new Date().toISOString().replaceAll(":","-"));
await mkdir(root,{recursive:true});
const report=parseReport(JSON.parse(await readFile(join(sourceRoot,"portfolio.json"),"utf8")).report);
const transcript=JSON.parse(await readFile(join(sourceRoot,"transcript.json"),"utf8")).transcript;
const sourceMetadata=JSON.parse(await readFile(join(sourceRoot,"metadata.json"),"utf8"));
const source=join(sourceRoot,`video${sourceMetadata.extension}`),signal=new AbortController().signal;
const uploads=createUploadService({directory:join(root,"uploads")});await uploads.initialize();
const upload=await uploads.receiveVideo(createReadStream(source),sourceMetadata.file.name,sourceMetadata.file.type,signal,sourceMetadata.file.size);
const id=upload.uploadId??upload.id;
assert.ok(id,"Upload must have an ID");assert.equal(uploads.findUpload(id).checksum.value,sourceMetadata.checksum.value);
const storage=createClipStorage(join(root,"outputs"));await storage.initialize();
const choices=[{profile:"micro",style:"DYNAMIC"},{profile:"short",style:"PODCAST"},{profile:"standard",style:"EDUCATIONAL"},{profile:"extended",style:"EMOTIONAL"},{profile:"short",style:"CLEAN"}];
const families=new Set();const candidates=[];const plans=[];
for(const choice of choices) {
  let eligible=report.candidates.filter(candidate=>candidate.profile===choice.profile&&!families.has(candidate.familyId));
  if(choice.style==="EDUCATIONAL") eligible.sort((a,b)=>Number(b.emotion.events.some(event=>["number","list"].includes(event.kind)))-Number(a.emotion.events.some(event=>["number","list"].includes(event.kind)))||b.score.value-a.score.value);
  if(choice.style==="EMOTIONAL") {const strength=candidate=>Math.max(0,...candidate.emotion.semantic.labels.filter(label=>["vulnerability","inspiration","tension","reflection"].includes(label.name)).map(label=>label.strength));eligible.sort((a,b)=>strength(b)-strength(a)||b.score.value-a.score.value);}
  const candidate=eligible[0];assert.ok(candidate);families.add(candidate.familyId);candidates.push(candidate);
  plans.push(...await prepareRenderPlans(uploads,id,transcript,report,[candidate],choice.style,signal,()=>{}));
}
console.log(JSON.stringify({root,id,selection:candidates.map((candidate,index)=>({id:candidate.id,title:candidate.title,profile:candidate.profile,duration:candidate.duration,style:choices[index].style}))},null,2));
const started=performance.now();
const batch=await renderClips({uploads,storage,gate:createResourceGate(),uploadId:id,report,transcript,candidates,plans,signal,timeoutMs:600000,
  onStage:(stage,completed,total)=>console.log(`${stage}: ${completed}/${total}`),onDiagnostic:text=>console.log(text)});
assert.equal(batch.clips.length,5);assert.deepEqual(await readdir(join(root,"outputs",".work")),[]);
await storage.read(id,batch.batchId,true);
const server=createServer({directory:join(root,"uploads")},{},{},{directory:join(root,"outputs")});server.log.level="silent";await server.ready();
const checks=[];
try {
  assert.equal((await server.inject("/health")).statusCode,200);
  for(const clip of batch.clips) {
    const base=`/uploads/${id}/clips/${batch.batchId}/${clip.id}`;
    const video=await server.inject({url:`${base}/file`,headers:{range:"bytes=0-31"}});assert.equal(video.statusCode,206);assert.equal(video.rawPayload.length,32);
    const image=await server.inject(`${base}/thumbnail`);assert.equal(image.statusCode,200);assert.equal(image.headers["content-type"],"image/jpeg");assert.equal(image.rawPayload.length,clip.socialPackage.thumbnail.size);
    const metadata=await server.inject(`${base}/metadata`);assert.equal(metadata.statusCode,200);const pkg=metadata.json();const {checksum,...payload}=pkg;assert.equal(checksum.value,digest(payload));assert.equal(pkg.video.checksum,clip.checksum);
    assert.equal(pkg.thumbnailPlan.validation.withinSafeArea,true);assert.ok(pkg.thumbnailPlan.ranking.length>=4);assert.equal(pkg.platformProfiles.length,3);
    const dir=join(root,"outputs",id,batch.batchId);
    assert.equal(await fileChecksum(join(dir,clip.socialPackage.thumbnail.file)),clip.socialPackage.thumbnail.checksum);
    checks.push({id:clip.id,title:clip.candidate.title,profile:clip.candidate.profile,style:clip.editPlan.style,template:clip.socialPackage.template,thumbnailStyle:clip.socialPackage.thumbnailStyle,
      duration:clip.duration,videoBytes:clip.size,thumbnailBytes:clip.socialPackage.thumbnail.size,metadataBytes:clip.socialPackage.metadata.size,checksum:clip.checksum,
      frameTimestamp:clip.socialPackage.frameTimestamp,frameSignals:pkg.thumbnailPlan.ranking[0],cueCount:clip.metadata.cueCount,renderSeconds:clip.metadata.renderSeconds,
      get:{video:video.statusCode,thumbnail:image.statusCode,metadata:metadata.statusCode},safeArea:pkg.thumbnailPlan.safeAreas,paths:{video:relative(root,join(dir,clip.file)),thumbnail:relative(root,join(dir,clip.socialPackage.thumbnail.file)),sourceFrame:relative(root,join(dir,clip.socialPackage.sourceFrame.file)),metadata:relative(root,join(dir,clip.socialPackage.metadata.file))},reason:clip.socialPackage.selectionReason});
  }
} finally {await server.close();await uploads.drain();}
const escaped=text=>String(text).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const url=path=>path.split("\\").join("/");
const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clipador IA · QA Social Packages</title><style>body{background:#101724;color:#edf3fb;font:16px Arial;margin:0;padding:32px}main{max-width:1260px;margin:auto}h1{font-size:32px}article{border:1px solid #354456;border-radius:20px;background:#182231;padding:24px;margin:28px 0}.media{display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:20px;align-items:start}img,video{width:100%;max-height:540px;object-fit:contain;background:#0d1420;border-radius:12px}.source img{aspect-ratio:16/9}.label{color:#a0d7e9;font-size:13px;letter-spacing:.04em}p{line-height:1.65}code{overflow-wrap:anywhere;color:#acc0d8}a{color:#a0d7e9}.notes{color:#acc0d8}@media(max-width:760px){body{padding:16px}.media{grid-template-columns:1fr}article{padding:16px}img,video{max-height:600px}}</style><main><p class="label">CLIPADOR IA · REVISÃO LOCAL</p><h1>Vídeo + capa + metadata</h1><p>Cinco trechos reais de “${escaped(sourceMetadata.source?.title??sourceMetadata.file.name)}”. Um MP4 por pacote, três perfis de plataforma. As margens são presets conservadores; sem reconhecimento facial. O estilo podcast foi solicitado editorialmente.</p>${checks.map(clip=>`<article><p class="label">${clip.profile.toUpperCase()} · ${clip.style} · ${clip.template} · ${clip.duration.toFixed(2)}s</p><h2>${escaped(clip.title)}</h2><div class="media"><div><p>Capa · ${clip.thumbnailStyle}</p><img src="${url(clip.paths.thumbnail)}" alt="Capa ${escaped(clip.title)}"></div><div><p>Vídeo final com captions</p><video src="${url(clip.paths.video)}" controls preload="metadata" poster="${url(clip.paths.thumbnail)}"></video></div><div class="source"><p>Frame original · ${clip.frameTimestamp.toFixed(2)}s</p><img src="${url(clip.paths.sourceFrame)}" alt="Frame original"><p>${escaped(clip.reason)}</p><p>${clip.cueCount} grupos de caption · Capa ${(clip.thumbnailBytes/1024).toFixed(1)} KiB · Render ${clip.renderSeconds.toFixed(1)}s</p><a href="${url(clip.paths.metadata)}">Metadata e planos completos</a><p><code>SHA-256 ${clip.checksum}</code></p></div></div></article>`).join("")}<p class="notes">Nenhuma nova transcrição, download do YouTube, publicação externa ou asset generativo foi realizado nesta validação.</p></main></html>`;
await writeFile(join(root,"qa.html"),html);
const result={root,id,batchId:batch.batchId,sourceHash:sourceMetadata.checksum.value,totalSeconds:(performance.now()-started)/1000,checks,usage:await storage.usage(),workEntries:await readdir(join(root,"outputs",".work")),qa:join(root,"qa.html")};
await writeFile(join(root,"result.json"),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
