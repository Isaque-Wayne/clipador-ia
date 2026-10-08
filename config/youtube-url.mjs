const hosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
export function parseYouTubeUrl(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x20\x7f\\]/.test(value.trim())) {
    throw new Error("Informe um link HTTPS válido do YouTube.");
  }
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error("Informe um link HTTPS válido do YouTube."); }
  if (url.protocol !== "https:" || !hosts.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error("Use somente links HTTPS de youtube.com ou youtu.be.");
  }
  let id;
  if (url.hostname === "youtu.be") id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  else if (url.pathname === "/watch" && url.searchParams.getAll("v").length === 1) id = url.searchParams.get("v");
  else id = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error("Use um link de vídeo, youtu.be ou Shorts com ID válido.");
  return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
}
