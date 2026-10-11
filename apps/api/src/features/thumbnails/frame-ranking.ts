import type { CutCandidate } from "../analysis/candidate.js";
import type { EditPlan } from "../editing/types.js";
import type { FrameRank } from "./types.js";
export function frameCandidates(candidate: CutCandidate, edit: EditPlan) {
  const proposals = [ { timestamp: candidate.start + Math.min(1.1, candidate.duration / 5), semantic: .9, reason: "Início do hook, após a transição de entrada." },
    { timestamp: candidate.start + Math.min(2.2, candidate.duration / 3), semantic: .85, reason: "Desenvolvimento inicial do hook." },
    { timestamp: candidate.start + candidate.duration / 2, semantic: .35, reason: "Desenvolvimento da ideia." },
    { timestamp: candidate.storyArc?.payoff ?? candidate.end - Math.min(1.2, candidate.duration / 5), semantic: candidate.storyArc?.payoff ? 1 : .65, reason: candidate.storyArc?.payoff ? "Payoff identificado pela análise existente." : "Conclusão do trecho." },
    ...(candidate.emotion?.events ?? []).filter(event => event.start >= candidate.start && event.end <= candidate.end).sort((a,b) => b.strength-a.strength).slice(0,3)
      .map(event => ({ timestamp: (event.start+event.end)/2, semantic: Math.min(1,.6+event.strength*.4), reason: `${event.kind}: ${event.reason}` })) ];
  const seen = new Set<number>();
  return proposals.filter(proposal => { const ms = Math.round(proposal.timestamp*1000); if (seen.has(ms) || !edit.timeline.some(span => proposal.timestamp >= span.sourceStart && proposal.timestamp <= span.sourceEnd-.08)) return false; seen.add(ms); return true; }).slice(0,7);
}
export function pixelSignals(current: Uint8Array, previous: Uint8Array, width = 160): Pick<FrameRank,"brightness"|"contrast"|"sharpness"|"stability"> {
  if (current.length !== 160*90 || previous.length !== current.length) throw new Error("Invalid frame sample");
  let total=0, squared=0, edge=0, delta=0;
  for (let i=0; i<current.length; i++) {
    const pixel=current[i] ?? 0; total+=pixel; squared+=pixel*pixel; delta+=Math.abs(pixel-(previous[i]??pixel));
    if (i>width && i%width>0 && i%width<width-1 && i<current.length-width) edge+=Math.abs(4*pixel-(current[i-1]??0)-(current[i+1]??0)-(current[i-width]??0)-(current[i+width]??0));
  }
  const mean=total/current.length;
  return { brightness: Math.max(0,1-Math.abs(mean-128)/128), contrast: Math.min(1,Math.sqrt(Math.max(0,squared/current.length-mean*mean))/64), sharpness: Math.min(1,edge/current.length/35), stability: Math.max(0,1-delta/current.length/50) };
}
export async function rankFrames(candidate: CutCandidate, edit: EditPlan, sample: (timestamp: number)=>Promise<Uint8Array>): Promise<FrameRank[]> {
  const ranked: FrameRank[]=[];
  for(const proposal of frameCandidates(candidate,edit)) {
    const current=await sample(proposal.timestamp), previous=await sample(Math.max(candidate.start,proposal.timestamp-.12));
    const signals=pixelSignals(current,previous);
    const score=proposal.semantic*.40+signals.brightness*.12+signals.contrast*.16+signals.sharpness*.22+signals.stability*.10;
    ranked.push({...proposal,...signals,score:Math.round(score*10000)/10000});
  }
  if(!ranked.length) throw new Error("Nenhum frame elegível na timeline preservada.");
  return ranked.sort((a,b)=>b.score-a.score || a.timestamp-b.timestamp);
}
