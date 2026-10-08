import { createServer } from "../../apps/api/dist/server/create-server.js";

const options = JSON.parse(process.argv[2]);
const server = createServer(options);
await server.listen({ port: 3011, host: "127.0.0.1" });
process.send?.({ kind: "ready", pid: process.pid });
const timer = setInterval(() => process.send?.({ kind: "memory", at: Date.now(), pid: process.pid, ...process.memoryUsage() }), 200);
process.on("message", async (message) => {
  if (message === "stop") { clearInterval(timer); await server.close(); process.exit(0); }
});

