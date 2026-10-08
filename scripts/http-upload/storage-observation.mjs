import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function observeStorage(directory) {
  let bytes = 0;
  const partials = [];
  const uploads = [];
  for (const id of await readdir(directory)) {
    const files = await readdir(join(directory, id));
    for (const file of files) {
      bytes += (await stat(join(directory, id, file))).size;
      if (file.endsWith(".part")) partials.push({ id, file });
    }
    if (files.includes("metadata.json")) uploads.push(JSON.parse(await readFile(join(directory, id, "metadata.json"), "utf8")));
  }
  return { bytes, partials, uploads };
}

export async function waitStorage(directory, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let snapshot;
  do {
    try { snapshot = await observeStorage(directory); if (predicate(snapshot)) return snapshot; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Condição de storage não atendida: ${JSON.stringify(snapshot)}`);
}
