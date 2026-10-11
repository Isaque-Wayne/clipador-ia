import type { PackagePreview } from "./types";
const record=(value:unknown):value is Record<string,unknown>=>typeof value==="object"&&value!==null&&!Array.isArray(value);
export function parsePackagePreview(value:unknown,base:string):PackagePreview {
  if(!record(value)||!["FULL_VERTICAL","TOP_BOTTOM","SPLIT","FULL_VIDEO","CLEAN_PODCAST","FOCUS_DETAIL","BLURRED_BACKGROUND","GLASS_FRAME","MEDIA_STACK","HEADLINE_TOP","HEADLINE_CENTER"].includes(String(value["template"]))
    ||!["CLEAN","BOLD","PODCAST","EMOTIONAL","EDUCATIONAL","DYNAMIC"].includes(String(value["thumbnailStyle"]))||typeof value["headline"]!=="string"||value["headline"].length>80
    ||typeof value["frameTimestamp"]!=="number"||!Number.isFinite(value["frameTimestamp"])||value["frameTimestamp"]<0||typeof value["selectionReason"]!=="string"||value["selectionReason"].length>5000
    ||!Array.isArray(value["platforms"])||value["platforms"].join()!=="youtube-shorts,instagram-reels,tiktok") throw new Error("Pacote social inválido na resposta da API.");
  for(const [key,suffix] of [["thumbnailUrl","thumbnail"],["metadataUrl","metadata"],["sourceFrameUrl","source-frame"]]) if(key&&value[key]!==undefined&&value[key]!==`${base}/${suffix}`) throw new Error("URL de artefato inválida.");
  return {thumbnailUrl:`${base}/thumbnail`,metadataUrl:`${base}/metadata`,sourceFrameUrl:`${base}/source-frame`,template:String(value["template"]),thumbnailStyle:String(value["thumbnailStyle"]),
    platforms:value["platforms"] as string[],headline:value["headline"],frameTimestamp:value["frameTimestamp"],selectionReason:value["selectionReason"]};
}
