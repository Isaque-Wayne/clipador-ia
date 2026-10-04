import type { FastifyInstance } from "fastify";

export function registerRoutes(server: FastifyInstance): void {
  server.get("/health", async () => {
    return {
      status: "ok",
      project: "Clipador IA",
      message: "API funcionando corretamente.",
    };
  });

  server.get("/about", async () => {
    return {
      name: "Clipador IA",
      version: "0.1.0",
      description: "Plataforma inteligente para análise e criação de cortes de vídeos.",
    };
  });
}