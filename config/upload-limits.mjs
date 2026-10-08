// Compartilhado pela API, web, proxy e testes; não depende de Node.js no navegador.
export const UPLOAD_MAX_FILE_BYTES = 4_294_967_296;
export const UPLOAD_QUOTA_BYTES = 17_179_869_184;

function bytesFromEnvironment(environment, name, fallback) {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) {
    throw new Error(`Configuração ${name} inválida: use bytes como inteiro positivo seguro.`);
  }
  return Number(raw);
}

export function resolveUploadLimits(environment = {}) {
  const maxFileBytes = bytesFromEnvironment(environment, "UPLOAD_MAX_FILE_BYTES", UPLOAD_MAX_FILE_BYTES);
  const quotaBytes = bytesFromEnvironment(environment, "UPLOAD_QUOTA_BYTES", UPLOAD_QUOTA_BYTES);
  const unit = [[1024 ** 3, "GiB"], [1024 ** 2, "MiB"], [1024, "KiB"]]
    .find(([bytes]) => maxFileBytes % bytes === 0);
  const maxFileLabel = unit ? `${maxFileBytes / unit[0]} ${unit[1]}` : `${maxFileBytes} bytes`;
  return { maxFileBytes, quotaBytes, maxFileLabel,
    sizeError: `O vídeo deve ter no máximo ${maxFileLabel}.` };
}
