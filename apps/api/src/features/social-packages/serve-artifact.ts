import { open } from "node:fs/promises";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ClipStorage } from "../clip-rendering/services/clip-storage.js";
import type { UploadService } from "../uploads/services/receive-video.js";
import { ProcessingError } from "../processing/services/processing-error.js";
import { UploadValidationError } from "../uploads/utils/validate-video.js";
type Request=FastifyRequest<{Params:{id:string;batchId:string;candidateId:string};Querystring:{download?:string}}>;
export function servePackageArtifact(storage:ClipStorage,uploads:UploadService,kind:"thumbnail"|"metadata"|"sourceFrame") {
  return async(request:Request,reply:FastifyReply)=> {
    let release:(()=>void)|undefined,streaming=false;
    try {
      release=uploads.holdProject(request.params.id.toLowerCase());
      const {asset,path}=await storage.artifact(request.params.id.toLowerCase(),request.params.batchId.toLowerCase(),request.params.candidateId,kind);
      const file=await open(path,"r");
      if((await file.stat()).size!==asset.size) {await file.close();throw new ProcessingError("INVALID_OUTPUT","Artefato alterado antes da leitura.",409);}
      reply.header("Content-Type",kind==="metadata" ? "application/json; charset=utf-8" : "image/jpeg").header("Content-Length",asset.size).header("Cache-Control","no-store")
        .header("X-Content-Type-Options","nosniff").header("Content-Disposition",`${request.query.download==="1" ? "attachment" : "inline"}; filename="${asset.file}"`);
      const stream=file.createReadStream({autoClose:true});stream.once("close",()=>release?.());streaming=true;
      return reply.send(stream);
    } catch(error) {
      if(error instanceof ProcessingError) return reply.code(error.statusCode).send({success:false,code:error.code,message:error.message});
      if(error instanceof UploadValidationError) return reply.code(error.statusCode).send({success:false,code:"PROJECT_BUSY",message:error.message});
      if(error instanceof Error&&"code" in error&&error.code==="ENOENT") return reply.code(404).send({success:false,code:"NOT_FOUND",message:"Artefato não encontrado."});
      request.log.error(error);return reply.code(500).send({success:false,code:"INTERNAL_ERROR",message:"Não foi possível ler o pacote."});
    } finally {if(!streaming) release?.();}
  };
}
