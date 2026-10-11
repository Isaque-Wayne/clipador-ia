import { lstat, readFile } from "node:fs/promises";
import { fileChecksum } from "../clip-rendering/services/clip-storage.js";
import { ProcessingError } from "../processing/services/processing-error.js";
import type { ImageAsset } from "../social-packages/types.js";
export const MAX_IMAGE_BYTES=1024*1024;
export function jpegDimensions(data: Uint8Array) {
  if(data[0]!==0xff||data[1]!==0xd8||data[data.length-2]!==0xff||data[data.length-1]!==0xd9) throw new Error("Invalid JPEG markers");
  for(let offset=2;offset+8<data.length;) {
    if(data[offset]!==0xff) throw new Error("Invalid JPEG segment");
    const marker=data[offset+1]??0; if(marker===0xda||marker===0xd9) break;
    const length=((data[offset+2]??0)<<8)+(data[offset+3]??0); if(length<2||offset+length+2>data.length) throw new Error("Truncated JPEG");
    if([0xc0,0xc1,0xc2].includes(marker)) return {height:((data[offset+5]??0)<<8)+(data[offset+6]??0),width:((data[offset+7]??0)<<8)+(data[offset+8]??0)};
    offset+=length+2;
  }
  throw new Error("JPEG dimensions missing");
}
export async function validateImage(path:string,file:string,expected?:{width:number;height:number}):Promise<ImageAsset> {
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<100||stat.size>MAX_IMAGE_BYTES) throw new ProcessingError("INVALID_OUTPUT","Capa/frame inválido ou acima de 1 MiB.");
  const dimensions=jpegDimensions(await readFile(path));
  if(dimensions.width<1||dimensions.height<1||expected&&(dimensions.width!==expected.width||dimensions.height!==expected.height)) throw new ProcessingError("INVALID_OUTPUT","Dimensões da capa não correspondem ao plano.");
  return {file,size:stat.size,checksum:await fileChecksum(path),...dimensions,mime:"image/jpeg"};
}
