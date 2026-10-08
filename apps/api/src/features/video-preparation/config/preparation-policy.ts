export function preparationTimeoutMs(): number {
  const value = Number(process.env["VIDEO_PREPARATION_TIMEOUT_MS"] ?? 300_000);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
    throw new Error("VIDEO_PREPARATION_TIMEOUT_MS deve ser um inteiro positivo até 2147483647.");
  return value;
}
