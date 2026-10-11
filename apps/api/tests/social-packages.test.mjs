import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile, readdir, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeTranscript } from "../dist/features/transcription/services/normalize-transcript.js";
import { LocalAnalysisProvider } from "../dist/features/analysis/services/local-provider.js";
import { digest } from "../dist/features/analysis/services/analysis-persistence.js";
import { buildEditPlan } from "../dist/features/editing/planning/edit-plan.js";
import { validateEditPlan } from "../dist/features/editing/planning/validate-edit-plan.js";
import { applyPlatformCaptions, COMMON_SAFE_AREA, PLATFORM_SAFE_AREAS, platformProfiles } from "../dist/features/social-packages/platform-profiles.js";
import { buildVisualCompositionPlan } from "../dist/features/visual-composition/planner.js";
import { validateVisualPlan } from "../dist/features/visual-composition/validation.js";
import { compositionFilters } from "../dist/features/visual-composition/filter-graph.js";
import { headlineEvent } from "../dist/features/visual-composition/overlays-ass.js";
import { shortHeadline } from "../dist/features/thumbnails/headline.js";
import { rankFrames, frameCandidates, pixelSignals } from "../dist/features/thumbnails/frame-ranking.js";
import { frameCacheKey, createFrameCache } from "../dist/features/thumbnails/frame-cache.js";
import { buildThumbnailPlan } from "../dist/features/thumbnails/planner.js";
import { validateThumbnailPlan } from "../dist/features/thumbnails/renderer.js";
import { jpegDimensions } from "../dist/features/thumbnails/image-validation.js";
import { parsePackageSummary, WORK_FILE, OUTPUT_FILE } from "../dist/features/social-packages/validation.js";
import { createClipStorage, fileChecksum } from "../dist/features/clip-rendering/services/clip-storage.js";
import { projectFiles, removeProjectFiles } from "../dist/features/library/services/library-files.js";
import { runRenderProcess } from "../dist/features/clip-rendering/services/render-process.js";
import { mediaTool } from "../dist/features/youtube-ingestion/services/ffmpeg-runner.js";
const signal=new AbortController().signal;
const transcript=normalizeTranscript({language:"pt",duration:12,segments:[{start:.2,end:11.6,text:"Uma ideia clara ajuda a aprender três caminhos para melhorar.",words:"Uma ideia clara ajuda a aprender três caminhos para melhorar.".split(" ").map((word,index)=>({word,start:.2+index,end:1.2+index}))}]});
const report=await new LocalAnalysisProvider().analyze({uploadId:randomUUID(),transcript},signal),candidate=report.candidates[0];
const inspection={width:320,height:180,aspectRatio:16/9,durationSeconds:12};
const edit=applyPlatformCaptions(buildEditPlan(candidate,transcript,inspection,undefined,"CLEAN"));
const visual=buildVisualCompositionPlan(candidate,edit,inspection);
const rank=[{timestamp:1,score:.8,reason:"Hook",semantic:.9,brightness:.8,contrast:.8,sharpness:.8,stability:.8}];

test("template determinístico, sem inventar rosto, e detalhes exigem evidência",()=> {
  assert.deepEqual(buildVisualCompositionPlan(candidate,edit,inspection),visual);assert.equal(visual.template,"BLURRED_BACKGROUND");assert.equal(visual.focalRegion,null);
  for(const style of ["PODCAST","DYNAMIC","EDUCATIONAL"]) assert.equal(buildVisualCompositionPlan(candidate,{...edit,style},inspection).template,"BLURRED_BACKGROUND");
  assert.equal(visual.foreground.width,1); assert.equal(visual.foreground.x,0); assert.equal(visual.overlays.length,0);
  const detail=buildVisualCompositionPlan(candidate,edit,inspection,{detailRegion:{x:.4,y:.2,width:.15,height:.4}});assert.equal(validateVisualPlan(detail).template,"FOCUS_DETAIL");
  assert.throws(()=>validateVisualPlan({...detail,sourceCrop:null}));
  assert.throws(()=>validateVisualPlan({...visual,template:"MEDIA_STACK",auxiliaryFrameTimestamp:1}),/awaits/);
  assert.equal(buildVisualCompositionPlan(candidate,edit,inspection,{centerClear:true}).template,"BLURRED_BACKGROUND");
  assert.match(compositionFilters("[in]","[out]",visual,1080,1920).join(";"),/gblur=sigma=14/);
});
test("um vídeo atende três perfis; captions na interseção e metadata distinta",()=> {
  assert.deepEqual(validateEditPlan(edit),edit);
  for(const safe of Object.values(PLATFORM_SAFE_AREAS)) {assert.ok(COMMON_SAFE_AREA.left>=safe.left);assert.ok(COMMON_SAFE_AREA.right>=safe.right);assert.ok(COMMON_SAFE_AREA.top>=safe.top);assert.ok(COMMON_SAFE_AREA.bottom>=safe.bottom);}
  assert.ok(edit.captions.groups.every(group=>group.position.y<1-COMMON_SAFE_AREA.bottom));
  const profiles=platformProfiles("Ideia clara","Descrição do trecho",`${candidate.id}.jpg`);
  assert.equal(new Set(profiles.map(profile=>profile.cover.file)).size,1);assert.equal(profiles[0].metadata.title,"Ideia clara");assert.match(profiles[1].metadata.caption,/Descrição/);assert.equal(profiles[1].cover.previewAspect,4/5);
});
test("headline deriva cláusula completa, remove final dependente e escapa tags ASS",()=> {
  assert.equal(shortHeadline({...candidate,title:"Vou passar o contato, mas fecha com ele"}),"Vou passar o contato");
  assert.equal(shortHeadline({...candidate,title:"Já que a gente tá na zoeira?"}),"a gente tá na zoeira?");
  const text=headlineEvent("{\\pos(0,0)} ideia clara",{x:.1,y:.2,width:.68,height:.2},1080,1920,1);
  assert.ok(!text.includes("{\\pos(0,0)}"));
});
test("ranking evita cortes de silêncio, favorece imagem clara/nítida e é reproduzível",async()=> {
  const proposals=frameCandidates(candidate,edit);assert.ok(proposals.length>=4);
  const dark=new Uint8Array(160*90),sharp=Uint8Array.from({length:160*90},(_,i)=>i%2 ? 190 : 70);
  assert.ok(pixelSignals(sharp,sharp).sharpness>pixelSignals(dark,dark).sharpness);
  const samples=async timestamp=>timestamp<3 ? sharp : dark;
  const first=await rankFrames(candidate,edit,samples);assert.deepEqual(await rankFrames(candidate,edit,samples),first);assert.ok(first[0].timestamp<3);
  const retained={...edit,timeline:[{sourceStart:4,sourceEnd:8,outputStart:0,outputEnd:4}]};assert.ok(frameCandidates(candidate,retained).every(frame=>frame.timestamp>=4&&frame.timestamp<=7.92));
});
test("seis presets de capa e validação de legibilidade/safe area",()=> {
  for(const [style,expected] of [["CLEAN","CLEAN"],["DYNAMIC","DYNAMIC"],["PODCAST","PODCAST"],["EMOTIONAL","EMOTIONAL"],["EDUCATIONAL","EDUCATIONAL"]]) {
    const plan=buildThumbnailPlan(candidate,{...edit,style},visual,rank);assert.equal(validateThumbnailPlan(plan).style,expected);
    assert.throws(()=>validateThumbnailPlan({...plan,headline:{...plan.headline,region:{...plan.headline.region,x:0}}}));
  }
  assert.equal(buildThumbnailPlan({...candidate,hookScore:{value:90}},{...edit,style:"DYNAMIC"},visual,rank).style,"BOLD");
  assert.equal(validateThumbnailPlan(buildThumbnailPlan({...candidate,title:"Olá",hook:undefined,transcript:"Olá"},edit,visual,rank)).headline.text,"Olá");
  assert.throws(()=>validateVisualPlan({...visual,background:{...visual.background,blurSigma:NaN}}));
  const withZoom=buildVisualCompositionPlan(candidate,{...edit,zoomEvents:[{start:0,end:1,intensity:.08,focus:{x:.5,y:.5},reason:"event"}]},inspection);
  assert.equal(withZoom.foreground.width,1,"Zoom must not shrink the image to caption UI margins");
  assert.ok(edit.captions.groups.every(group=>group.position.x>=COMMON_SAFE_AREA.left && group.position.x<=1-COMMON_SAFE_AREA.right));
  assert.throws(()=>jpegDimensions(Buffer.from("not a jpeg")));
});
test("cache nativo reutiliza o frame, chave distingue fonte/resolução e cleanup esvazia",{timeout:30000},async()=> {
  const root=await mkdtemp(join(tmpdir(),"clipador-frame-cache-")),input=join(root,"source.mp4");
  await runRenderProcess({executable:await mediaTool("ffmpeg"),cwd:root,timeoutMs:10000,args:["-hide_banner","-loglevel","error","-f","lavfi","-i","testsrc2=s=320x180:r=15:d=3","-c:v","libopenh264","-b:v","200k","source.mp4"]},signal);
  const work=join(root,"work");await mkdir(work);
  const cache=createFrameCache({path:input,identity:await lstat(input,{bigint:true})},"video-id",work,signal);
  const [one,two]=await Promise.all([cache.sample(1),cache.sample(1)]);assert.deepEqual(one,two);assert.equal(cache.count(),1);assert.equal((await readdir(work)).length,1);
  const jpg=await cache.image(1);assert.equal(jpegDimensions(await readFile(jpg)).width,1280);assert.equal(cache.count(),2);
  assert.notEqual(frameCacheKey("one",1,"160x90"),frameCacheKey("two",1,"160x90"));assert.notEqual(frameCacheKey("one",1,"160x90"),frameCacheKey("one",1,"1280x720"));
  await cache.cleanup();assert.deepEqual(await readdir(work),[]);
});
function summary(id,hash=digest("image")) {return {version:"social-package-1.0.0",thumbnail:{file:`${id}.jpg`,size:5,checksum:hash,width:1080,height:1920,mime:"image/jpeg"},sourceFrame:{file:`${id}.source.jpg`,size:5,checksum:hash,width:320,height:180,mime:"image/jpeg"},metadata:{file:`${id}.package.json`,size:5,checksum:hash},template:visual.template,thumbnailStyle:"CLEAN",headline:"Uma ideia clara",frameTimestamp:1,platforms:["youtube-shorts","instagram-reels","tiktok"],selectionReason:"Hook"};}
test("contrato rejeita traversal e cleanup/accounting compartilham nomes controlados",()=> {
  const pkg=summary(candidate.id);assert.deepEqual(parsePackageSummary(pkg,candidate.id),pkg);
  assert.throws(()=>parsePackageSummary({...pkg,thumbnail:{...pkg.thumbnail,file:"../outside.jpg"}},candidate.id));
  for(const file of [`${candidate.id}.jpg`,`${candidate.id}.source.jpg`,`${candidate.id}.package.json`]) {assert.equal(OUTPUT_FILE.test(file),true);assert.equal(WORK_FILE.test(file),true);}
  assert.equal(OUTPUT_FILE.test("frame-"+"a".repeat(24)+".jpg"),false);assert.equal(WORK_FILE.test("important.txt"),false);
});
test("append publica todos os artefatos ou preserva manifesto anterior; integridade e exclusão",async()=> {
  const root=await mkdtemp(join(tmpdir(),"clipador-package-storage-")),storage=createClipStorage(root);await storage.initialize();
  const uploadId=randomUUID(),batchId=randomUUID(),work=await storage.work(batchId,true),bytes=Buffer.from("video");
  const clone={...candidate,id:"c_aaaaaaaaaaaaaaaa"},nextReport={...report,candidates:[candidate,clone]};
  const clip={id:candidate.id,file:`${candidate.id}.mp4`,start:candidate.start,end:candidate.end,duration:candidate.duration,width:1080,height:1920,size:bytes.length,checksum:"",status:"completed",candidate,editPlan:edit,visualCompositionPlan:visual,
    metadata:{videoCodec:"h264",audioCodec:"aac",subtitlesBurned:true,cueCount:1,layout:"padding",renderSeconds:1}};
  await writeFile(join(work,clip.file),bytes);clip.checksum=await fileChecksum(join(work,clip.file));clip.socialPackage=summary(candidate.id,clip.checksum);
  for(const asset of [clip.socialPackage.thumbnail,clip.socialPackage.sourceFrame,clip.socialPackage.metadata]) await writeFile(join(work,asset.file),bytes);
  const batch={schemaVersion:1,uploadId,batchId,createdAt:new Date().toISOString(),analysisVersion:nextReport.analysisVersion,renderVersion:"test",sourceHash:digest("source"),analysisHash:digest(nextReport),report:nextReport,clips:[clip]};
  await storage.publish(batch);assert.equal((await storage.read(uploadId,batchId)).clips.length,1);
  const next={...clip,id:clone.id,file:`${clone.id}.mp4`,candidate:clone,editPlan:{...edit,clipId:clone.id},visualCompositionPlan:{...visual,clipId:clone.id},socialPackage:summary(clone.id,clip.checksum)};
  const partialWork=await storage.work(batchId,true);await writeFile(join(partialWork,next.file),bytes);await writeFile(join(partialWork,next.socialPackage.thumbnail.file),bytes);
  await assert.rejects(storage.append(batch,next));assert.equal((await storage.read(uploadId,batchId)).clips.length,1);
  assert.ok(!(await readdir(join(root,uploadId,batchId))).includes(next.file));
  await storage.clearWork(batchId);
  const stored=await storage.artifact(uploadId,batchId,candidate.id,"thumbnail");await writeFile(stored.path,"wrong");
  await assert.rejects(storage.artifact(uploadId,batchId,candidate.id,"thumbnail"),{code:"INVALID_OUTPUT"});
  const plan=await projectFiles(storage.root(),uploadId,true),before=(await storage.usage()).bytes;assert.equal(plan.bytes,before);
  assert.equal((await removeProjectFiles([plan])).freedBytes,before);assert.equal((await storage.usage()).bytes,0);
});
