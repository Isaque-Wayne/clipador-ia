export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const upstream = await fetch(`${process.env["API_BASE_URL"] ?? "http://127.0.0.1:3001"}/ingestions/youtube`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: request.body,
      duplex: "half", redirect: "error", signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    } as RequestInit & { duplex: "half" });
    return new Response(upstream.body, { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ success: false, message: "A ingestão foi interrompida ou a API está indisponível." }, { status: 502 });
  }
}
