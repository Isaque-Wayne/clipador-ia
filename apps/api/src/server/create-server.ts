import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { registerRoutes } from "./register-routes.js";

export function createServer(): FastifyInstance {
  const server = Fastify({ logger: true });
  registerRoutes(server);
  return server;
}
