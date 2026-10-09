export const runtime = "nodejs";
import { resolvePipelineTimeouts } from "../../../../../../../config/pipeline-timeouts.mjs";

export async function POST(request: Request): Promise<Response> {
  if (!request.body) return Response.json({ success: false, message: "O vídeo está vazio." }, { status: 400 });
  const headers = new Headers();
  for (const name of ["content-type", "x-file-name", "content-length"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const options: RequestInit & { duplex: "half" } = {
    method: "POST", headers, body: request.body, duplex: "half",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(resolvePipelineTimeouts().upload + 15_000)]),
    redirect: "error",
  };
  try {
    const upstream = await fetch(`${process.env["API_BASE_URL"] ?? "http://127.0.0.1:3001"}/uploads/video`, options);
    return new Response(upstream.body, { status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "O envio foi interrompido ou a API está indisponível." }, { status: 502 });
  }
}
