import { createServer } from "./create-server.js";

const server = createServer();

async function startServer(): Promise<void> {
  try {
    const rawPort = process.env["PORT"] ?? "3001";
    const port = Number(rawPort);

    if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT deve ser um inteiro entre 1 e 65535.");
    }

    await server.listen({ port, host: "127.0.0.1" });
  } catch (error: unknown) {
    server.log.error(error);
    await server.close();
    process.exitCode = 1;
  }
}

async function shutdown(): Promise<void> {
  try {
    await server.close();
  } catch (error: unknown) {
    server.log.error(error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });

void startServer();
