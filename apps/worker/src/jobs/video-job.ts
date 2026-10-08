import { randomUUID } from "node:crypto";

export interface PendingVideoJob {
  id: string;
  kind: "process-video";
  uploadId: string;
  status: "pending";
  createdAt: string;
}

export function createPendingVideoJob(uploadId: string): PendingVideoJob {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    throw new Error("ID de upload inválido para o job de vídeo.");
  }
  return { id: randomUUID(), kind: "process-video", uploadId: uploadId.toLowerCase(),
    status: "pending", createdAt: new Date().toISOString() };
}
