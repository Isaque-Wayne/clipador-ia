import type { EditPlan, AssetResolution } from "../types.js";
import { validateEditPlan } from "../planning/validate-edit-plan.js";
import type { VisualCompositionPlan } from "../../visual-composition/types.js";
import { validateVisualPlan } from "../../visual-composition/validation.js";
export interface RenderPlan { edit: EditPlan; assets: AssetResolution; visual?: VisualCompositionPlan }
export function createRenderPlan(edit: EditPlan, assets: AssetResolution, visual?: VisualCompositionPlan): RenderPlan {
  validateEditPlan(edit);
  if (visual && (validateVisualPlan(visual).clipId !== edit.clipId || edit.renderProfile !== "vertical-social")) throw new Error("Visual plan requires matching vertical clip");
  return { edit, assets, ...(visual ? { visual } : {}) };
}
