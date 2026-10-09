import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerRoutes } from "./register-routes.js";
import type { UploadOptions } from "../features/uploads/types/upload.js";
import type { YouTubeIngestionOptions } from "../features/youtube-ingestion/types/ingestion.js";
import type { TranscriptionOptions } from "../features/transcription/types/status.js";
import type { ProcessingOptions } from "../features/clip-rendering/types.js";

export function createServer(uploadOptions: UploadOptions = {}, youtubeOptions: YouTubeIngestionOptions = {}, transcriptionOptions: TranscriptionOptions = {}, processingOptions: ProcessingOptions = {}): FastifyInstance {
  const server = Fastify({ logger: true });
  registerRoutes(server, uploadOptions, youtubeOptions, transcriptionOptions, processingOptions);
  return server;
}
