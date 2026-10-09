export const runtime = "nodejs";
import { resolvePipelineTimeouts } from "../../../../../../../config/pipeline-timeouts.mjs";

export async function POST(request: Request): Promise<Response> {
  try {
    const upstream = await fetch(`${process.env["API_BASE_URL"] ?? "http://127.0.0.1:3001"}/ingestions/youtube/jobs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: request.body,
      duplex: "half", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(resolvePipelineTimeouts().request)]),
    } as RequestInit & { duplex: "half" });
    return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return Response.json({ success: false, code: timedOut ? "REQUEST_TIMEOUT" : "API_UNAVAILABLE", message: timedOut
      ? "A criação do job excedeu o tempo de espera da consulta. Isso não confirma falha no download."
      : "Não foi possível conectar à API. Verifique se o serviço está ativo." }, { status: timedOut ? 504 : 502 });
  }
}
