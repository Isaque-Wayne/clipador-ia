import type { VideoInspection } from "../../video-preparation/types/inspection.js";
import { RENDER_PROFILES } from "../types.js";
import type { FramingPlan } from "../types.js";
export interface FramingProvider { resolve(inspection: VideoInspection, profile: keyof typeof RENDER_PROFILES): FramingPlan }
export class SafeFramingProvider implements FramingProvider {
  resolve(inspection: VideoInspection, profile: keyof typeof RENDER_PROFILES): FramingPlan {
    const target = RENDER_PROFILES[profile], ratio = (inspection.width / inspection.height) / (target.width / target.height), retained = Math.min(ratio, 1 / ratio);
    return { mode: retained >= .68 ? "crop" : "padding", focus: { x: .5, y: .5 }, speakerShots: [], reason: retained >= .68 ? "Crop central conserva >=68% da área; sem inferir rosto/falante." : "Padding proporcional conserva o quadro inteiro; active speaker indisponível." };
  }
}
