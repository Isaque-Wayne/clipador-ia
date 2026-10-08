export function isUploadId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function sanitizeFilename(name: string): string {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  const stem = name.slice(0, name.lastIndexOf("."));
  const safe = stem.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_")
    .replace(/^[._-]+/, "").slice(0, 180);
  // O nome é apenas metadado; o caminho físico usa exclusivamente UUID e extensão permitida.
  const safeStem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `video_${safe}` : safe || "video";
  return `${safeStem}${extension}`;
}
