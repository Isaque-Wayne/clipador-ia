import type { EditPlan, AssetResolution } from "../types.js";
import { validateEditPlan } from "../planning/validate-edit-plan.js";
export interface RenderPlan { edit: EditPlan; assets: AssetResolution }
export function createRenderPlan(edit: EditPlan, assets: AssetResolution): RenderPlan { validateEditPlan(edit); return { edit, assets }; }
