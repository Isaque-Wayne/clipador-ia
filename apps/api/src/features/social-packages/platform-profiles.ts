import type { SafeArea, EditPlan } from "../editing/types.js";
import { PLATFORM_IDS } from "./types.js";
import type { PlatformId, PlatformProfile } from "./types.js";

// Conservative internal presets, not fixed platform specifications. UI varies by device and caption length.
export const PLATFORM_SAFE_AREAS: Record<PlatformId, SafeArea> = {
  "youtube-shorts": { left: .10, right: .18, top: .12, bottom: .23, anchorY: .69 },
  "instagram-reels": { left: .10, right: .18, top: .14, bottom: .25, anchorY: .68 },
  tiktok: { left: .10, right: .22, top: .16, bottom: .28, anchorY: .68 },
};
export const COMMON_SAFE_AREA: SafeArea = { left: .10, right: .22, top: .16, bottom: .28, anchorY: .68 };
export function applyPlatformCaptions(plan: EditPlan): EditPlan {
  const safeArea = { ...COMMON_SAFE_AREA };
  return { ...plan, captions: { ...plan.captions, safeArea, fontSize: 54,
    groups: plan.captions.groups.map(group => ({ ...group, position: { x: (safeArea.left + 1 - safeArea.right) / 2, y: safeArea.anchorY } })) } };
}
export function platformProfiles(title: string, description: string, cover: string): PlatformProfile[] {
  return PLATFORM_IDS.map(id => ({ id, safeArea: { ...PLATFORM_SAFE_AREAS[id] },
    cover: { file: cover, previewAspect: id === "instagram-reels" ? 4 / 5 : 9 / 16, placement: id === "instagram-reels" ? "cover" : "candidate" },
    metadata: id === "youtube-shorts" ? { title: title.slice(0, 100), description } : { caption: `${title}\n\n${description}`.trim() },
    exportRequirements: { aspect: "9:16", width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac", fps: 30, automaticPublishing: false },
    textPlacement: { headlineY: .26, captionsY: COMMON_SAFE_AREA.anchorY },
    notes: ["Margens conservadoras configuráveis; revisar no dispositivo antes de publicar.",
      id === "instagram-reels" ? "Prévia 4:5: manter headline e assunto na região central da capa." : "Capa candidata para seleção manual no aplicativo/Studio, conforme disponibilidade da conta."] }));
}
