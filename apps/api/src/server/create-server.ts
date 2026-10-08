import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerRoutes } from "./register-routes.js";
import type { UploadOptions } from "../features/uploads/types/upload.js";
import type { YouTubeIngestionOptions } from "../features/youtube-ingestion/types/ingestion.js";

export function createServer(uploadOptions: UploadOptions = {}, youtubeOptions: YouTubeIngestionOptions = {}): FastifyInstance {
  const server = Fastify({ logger: true });
  registerRoutes(server, uploadOptions, youtubeOptions);
  return server;
}
