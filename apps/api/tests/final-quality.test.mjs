import assert from "node:assert/strict";
import test from "node:test";
import { safeVerticalFrame } from "../dist/features/visual-composition/safe-vertical-frame.js";
import { validateSocialOutput } from "../dist/features/clip-rendering/services/validate-social-output.js";
import { selectFinalPortfolio, validateSelectionSummary } from "../dist/features/portfolio/services/final-selection.js";
import { evaluateFinalCandidate, maxFinalClips } from "../dist/features/portfolio/services/final-quality.js";
import { refineSpeechWindow } from "../dist/features/portfolio/services/refine-boundaries.js";
import { compositionFilters } from "../dist/features/visual-composition/filter-graph.js";
import { buildVisualCompositionPlan } from "../dist/features/visual-composition/planner.js";
import { renderClips } from "../dist/features/clip-rendering/services/render-clips.js";
const profiles=["micro","short","standard","extended"],durations=[15,30,55,100];
function candidate(index,profile=profiles[index%4]) {
  const duration=durations[profiles.indexOf(profile)],start=index*120;
  return {id:`c_${index.toString(16).padStart(16,"0")}`,familyId:`f_${index.toString(16).padStart(16,"0")}`,profile,start,end:start+duration,duration,
    transcript:"Como três escolhas ajudam a aprender? Portanto o resultado melhora.",hookType:index%2 ? "question" : "contrast",topicTokens:[`assunto${index}`],
    score:{value:80,dimensions:["standaloneClarity","conclusionQuality","retentionPotential","informationValue","emotion","hookStrength"].map(name=>({name,value:.85})),penalties:[]},
    hookScore:{value:70},emotion:{semantic:{labels:[]}},storyArc:{confidence:.6}};
}
function report(candidates) {return {generatedCount:candidates.length+30,candidates,portfolio:{sourceDuration:20000}};}
test("vertical geometry fills canvas without stretch; unsafe wide crop uses full-width centered foreground",()=>{
  const portrait=safeVerticalFrame(1080,1920);assert.equal(portrait.mode,"crop");assert.deepEqual(portrait.foreground,{x:0,y:0,width:1,height:1});
  const wide=safeVerticalFrame(1920,1080);assert.equal(wide.mode,"blur");assert.equal(wide.foreground.width,1);assert.equal(wide.foreground.x,0);
  assert.ok(Math.abs((wide.foreground.width*1080)/(wide.foreground.height*1920)-16/9)<.00001);
  const focal={x:.42,y:.2,width:.12,height:.5},crop=safeVerticalFrame(1920,1080,focal);assert.equal(crop.mode,"crop");
  assert.ok(crop.sourceCrop.x<=focal.x);assert.ok(crop.sourceCrop.x+crop.sourceCrop.width>=focal.x+focal.width);
  const dialogue=safeVerticalFrame(1920,1080,{x:.15,y:.1,width:.7,height:.7});assert.equal(dialogue.mode,"blur");
  const plan=buildVisualCompositionPlan(candidate(1),{}, {width:1920,height:1080},{personRegion:focal});
  assert.equal(plan.template,"FULL_VERTICAL");const graph=compositionFilters("[in]","[out]",plan,1080,1920).join(";");assert.match(graph,/crop=1080:1920/);assert.doesNotMatch(graph,/gblur|overlay/);
});
test("FFprobe validation refuses horizontal, inverted, wrong DAR, missing audio, wrong codec/duration",()=>{
  const output={width:1080,height:1920,aspectRatio:9/16,videoCodec:"h264",audio:{codec:"aac"},durationSeconds:15};
  assert.doesNotThrow(()=>validateSocialOutput(output,15));
  for(const bad of [{width:1920,height:1080},{width:1080,height:1080},{aspectRatio:16/9},{audio:null},{videoCodec:"hevc"},{durationSeconds:13}])assert.throws(()=>validateSocialOutput({...output,...bad},15),{code:"INVALID_OUTPUT"});
});
test("renderer boundary blocks over-cap, weak manual candidates and landscape before acquiring resources",async()=>{
  const base=candidate(1),gate={acquire(){assert.fail("Invalid input cannot reserve resources");}};
  await assert.rejects(renderClips({candidates:Array.from({length:21},(_,index)=>candidate(index)),plans:[],gate}),{code:"INVALID_SELECTION"});
  await assert.rejects(renderClips({candidates:[base],report:{},plans:[{edit:{clipId:base.id,renderProfile:"landscape"}}],gate}),{code:"INVALID_PLAN"});
  const weak={...base,hookScore:{value:20}};
  await assert.rejects(renderClips({candidates:[weak],report:report([weak]),plans:[{edit:{clipId:weak.id,renderProfile:"vertical-social"}}],gate}),{code:"QUALITY_GATE"});
});
test("all quantity modes gate quality; maximum caps at20, does not pad a scarce pool, config validated",()=>{
  const pool=Array.from({length:100},(_,index)=>candidate(index));
  for(const quantity of ["auto","few","normal","many","maximum"]){const result=selectFinalPortfolio(report(pool),quantity);assert.ok(result.candidates.length<=20);assert.equal(validateSelectionSummary(result.summary),result.summary);assert.ok(result.audit.filter(entry=>entry.decision==="selected").every(entry=>entry.renderEligible));}
  const result=selectFinalPortfolio(report(pool),"maximum");assert.equal(result.candidates.length,20);assert.equal(result.summary.qualityPassed,100);assert.ok(new Set(result.candidates.map(item=>item.profile)).size===4);
  assert.equal(selectFinalPortfolio(report(pool.slice(0,12)),"maximum").candidates.length,12);
  assert.equal(selectFinalPortfolio(report(pool),"maximum",7).candidates.length,7);
  assert.equal(maxFinalClips({}),20);assert.equal(maxFinalClips({MAX_FINAL_CLIPS:"12"}),12);for(const value of ["0","101","NaN","1.5"])assert.throws(()=>maxFinalClips({MAX_FINAL_CLIPS:value}));
});
test("quality distinguishes weak hook, context, closure, repetition; no bypass by maximum",()=>{
  const base=candidate(1);assert.equal(evaluateFinalCandidate(base).renderEligible,true);
  const poor=[{...base,hookScore:{value:25}},{...base,transcript:"Uma ideia porque"},{...base,score:{...base.score,value:39}},{...base,score:{...base.score,penalties:[{name:"missingContext",value:1}]}},{...base,score:{...base.score,penalties:[{name:"repetition",value:.9}]}}];
  for(const item of poor){assert.equal(evaluateFinalCandidate(item).renderEligible,false);assert.equal(selectFinalPortfolio(report([item]),"maximum").candidates.length,0);}
});
test("42/45/48s variants keep best; same moment permits only micro plus complete distinct use",()=>{
  const variants=[42,45,48].map((duration,index)=>({...candidate(index,"standard"),start:100,end:100+duration,duration,familyId:"f_aaaaaaaaaaaaaaaa",score:{...candidate(index).score,value:80-index},hookScore:{value:75-index}}));
  const one=selectFinalPortfolio(report(variants),"maximum");assert.equal(one.candidates.length,1);assert.equal(one.summary.duplicatesRemoved,2);
  const micro={...candidate(4,"micro"),start:100,end:115,familyId:"f_aaaaaaaaaaaaaaaa"};
  const uses=selectFinalPortfolio(report([micro,...variants]),"maximum");assert.equal(uses.candidates.length,2);assert.ok(uses.candidates.some(item=>item.profile==="micro"));
});
test("boundary refinement removes isolated fillers, preserves meaning words, extends incomplete final up to6s",()=>{
  const make=(text,start)=>({start,end:start+2,text,segmentIds:[1],words:text.split(" ").map((word,index)=>({word,start:start+index*.2,end:start+(index+1)*.2}))});
  const units=[make("Ahn, como três escolhas ajudam?",0),make("O resultado melhora porque",3),make("o contexto fica claro.",5)];
  const refined=refineSpeechWindow(units,0,1,10,20);assert.ok(refined.bounds.start>0);assert.equal(refined.selected[0].words[0].word,"como");assert.equal(refined.selected.length,3);assert.equal(units[0].words[0].word,"Ahn,");
  const meaningful=refineSpeechWindow([make("É importante porque muda tudo.",0)],0,0,4,20);assert.equal(meaningful.selected[0].words[0].word,"É");
});
