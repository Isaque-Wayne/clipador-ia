import type { FastifyInstance } from "fastify";

export function registerRoutes(server: FastifyInstance): void {
  server.get("/health", async () => ({ status: "ok" as const }));
}
