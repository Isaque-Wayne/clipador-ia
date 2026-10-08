import { request } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

export function upload({ size, prefix = Buffer.alloc(0), name = "video.mp4", type = "video/mp4",
  delayMs = 0, pauseAfter = Infinity, contentLength = true, port = 3010 }) {
  const started = performance.now();
  let sent = 0;
  let stopped = false;
  let wake;
  const gate = new Promise((resolve) => { wake = resolve; });
  let settle;
  const result = new Promise((resolve) => { settle = resolve; });
  const headers = { "content-type": type, "x-file-name": encodeURIComponent(name) };
  if (contentLength) headers["content-length"] = size;
  const req = request({ host: "127.0.0.1", port, path: port === 3010 ? "/api/uploads/video" : "/uploads/video",
    method: "POST", headers, agent: false }, (res) => {
    stopped = true; wake();
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (chunk) => { body += chunk; });
    res.on("end", () => {
      let data;
      try { data = JSON.parse(body); } catch { data = { raw: body }; }
      settle({ status: res.statusCode, data, elapsedMs: performance.now() - started, sent });
      req.destroy();
    });
    res.on("error", (error) => settle({ status: 0, error: error.message, elapsedMs: performance.now() - started, sent }));
  });
  req.on("error", (error) => {
    if (!stopped) { stopped = true; wake(); settle({ status: 0, error: error.message, elapsedMs: performance.now() - started, sent }); }
  });
  const send = async () => {
    while (sent < size && !stopped) {
      if (sent >= pauseAfter) await gate;
      if (stopped) break;
      const length = Math.min(64 * 1024, size - sent);
      const chunk = Buffer.alloc(length);
      if (sent < prefix.length) prefix.copy(chunk, 0, sent, Math.min(prefix.length, sent + length));
      sent += length;
      if (!req.write(chunk)) await Promise.race([once(req, "drain"), result]);
      if (delayMs) await delay(delayMs);
    }
    if (!stopped) req.end();
  };
  void send().catch((error) => { if (!stopped) req.destroy(error); });
  return { result, release: wake, abort: () => req.destroy(new Error("test client disconnected")), get sent() { return sent; } };
}

