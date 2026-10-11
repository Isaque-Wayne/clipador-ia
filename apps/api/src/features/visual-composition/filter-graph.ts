import type { VisualCompositionPlan } from "./types.js";
import { validateVisualPlan } from "./validation.js";
export function compositionFilters(input: string, output: string, plan: VisualCompositionPlan, width: number, height: number, prefix = "vc"): string[] {
  validateVisualPlan(plan);
  const box = plan.foreground, bw = Math.floor(box.width * width / 2) * 2, bh = Math.floor(box.height * height / 2) * 2;
  const x = Math.round(box.x * width), y = Math.round(box.y * height);
  const crop = plan.sourceCrop ? `crop=iw*${plan.sourceCrop.width}:ih*${plan.sourceCrop.height}:iw*${plan.sourceCrop.x}:ih*${plan.sourceCrop.y},` : "";
  if (["FULL_VERTICAL", "FOCUS_DETAIL"].includes(plan.template)) return [
    `${input}${crop}scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2:reset_sar=1,crop=${width}:${height},setsar=1${output}`,
  ];
  return [
    `${input}split=2[${prefix}bg][${prefix}fg]`,
    `[${prefix}bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=${plan.background.blurSigma},scale=${width}:${height},setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=0x101724@${plan.background.darkness}:t=fill${plan.template === "GLASS_FRAME" ? `,drawbox=x=${x-12}:y=${y-12}:w=${bw+24}:h=${bh+24}:color=0x101724@0.35:t=fill,drawbox=x=${x-12}:y=${y-12}:w=${bw+24}:h=${bh+24}:color=white@0.18:t=1` : ""}[${prefix}base]`,
    `[${prefix}fg]${crop}scale=${bw}:${bh}:force_original_aspect_ratio=decrease:force_divisible_by=2:reset_sar=1,setsar=1[${prefix}main]`,
    `[${prefix}base][${prefix}main]overlay=x=${x}+(${bw}-overlay_w)/2:y=${y}+(${bh}-overlay_h)/2:shortest=1${output}`,
  ];
}
