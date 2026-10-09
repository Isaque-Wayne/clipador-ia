import { resolvePipelineTimeouts } from "../../../../../../config/pipeline-timeouts.mjs";
export function preparationTimeoutMs(): number { return resolvePipelineTimeouts().preparation; }
