import { record } from "../video-preparation/utils/parse-inspection.js";
import { SOCIAL_PACKAGE_VERSION, PLATFORM_IDS } from "./types.js";
import type { SocialPackageSummary, PackageFile } from "./types.js";
import { VISUAL_TEMPLATES } from "../visual-composition/types.js";
import { THUMBNAIL_STYLES } from "../thumbnails/types.js";
export function validPackageFile(value:unknown,file:string):value is PackageFile {
  return record(value)&&value["file"]===file&&typeof value["size"]==="number"&&Number.isSafeInteger(value["size"])&&value["size"]>0&&value["size"]<=1024*1024&&typeof value["checksum"]==="string"&&/^[a-f0-9]{64}$/.test(value["checksum"]);
}
export function parsePackageSummary(value:unknown,id:string):SocialPackageSummary {
  if(!record(value)||value["version"]!==SOCIAL_PACKAGE_VERSION||!validPackageFile(value["thumbnail"],`${id}.jpg`)||!validPackageFile(value["sourceFrame"],`${id}.source.jpg`)||!validPackageFile(value["metadata"],`${id}.package.json`)
    ||!VISUAL_TEMPLATES.includes(value["template"] as SocialPackageSummary["template"])||!THUMBNAIL_STYLES.includes(value["thumbnailStyle"] as SocialPackageSummary["thumbnailStyle"])
    ||!Array.isArray(value["platforms"])||value["platforms"].join()!==PLATFORM_IDS.join()||typeof value["headline"]!=="string"||value["headline"].length>80
    ||typeof value["frameTimestamp"]!=="number"||!Number.isFinite(value["frameTimestamp"])||value["frameTimestamp"]<0||typeof value["selectionReason"]!=="string"||value["selectionReason"].length>5000) throw new Error("Invalid social package summary");
  for(const key of ["thumbnail","sourceFrame"]) { const image=value[key]; if(!record(image)||image["mime"]!=="image/jpeg"||typeof image["width"]!=="number"||typeof image["height"]!=="number"||!Number.isSafeInteger(image["width"])||!Number.isSafeInteger(image["height"])||image["width"]<1||image["width"]>1920||image["height"]<1||image["height"]>1920) throw new Error("Invalid package image"); }
  const thumbnail=value["thumbnail"];
  if(!record(thumbnail)||thumbnail["width"]!==1080||thumbnail["height"]!==1920) throw new Error("Invalid thumbnail dimensions");
  return value as unknown as SocialPackageSummary;
}
export function packageFiles(summary:SocialPackageSummary|undefined) { return summary ? [summary.thumbnail,summary.sourceFrame,summary.metadata] : []; }
// Shared controlled filenames keep accounting, crash cleanup and project deletion in sync.
export const OUTPUT_FILE=/^(manifest\.json(?:\.part)?|c_[a-f0-9]{16}\.(mp4|jpg|source\.jpg|package\.json))$/;
export const WORK_FILE=/^(manifest\.json(?:\.part)?|c_[a-f0-9]{16}\.(mp4(?:\.part)?|jpg(?:\.part)?|source\.jpg|package\.json|ass|ffgraph|cover\.ass|cover\.ffgraph)|frame-[a-f0-9]{24}\.(gray|jpg)|asset-[a-f0-9]{16}\.(wav|mp3|m4a|ogg))$/;
