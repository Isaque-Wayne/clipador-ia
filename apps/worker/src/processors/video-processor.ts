import type { PendingVideoJob } from "../jobs/video-job.js";

export function prepareVideoProcessing(job: PendingVideoJob): {
  job: PendingVideoJob;
  processingEnabled: false;
  message: string;
} {
  return { job: { ...job }, processingEnabled: false,
    message: "Job pendente. O processamento de vídeo ainda não foi implementado." };
}
