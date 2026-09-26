import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";

function decodeToken(token: string) {
  let base64 = token.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  return Buffer.from(base64, "base64").toString("utf8");
}

export async function GET(req: Request) {
  try {
    await requireSession();
  } catch {
    return new Response("Not authenticated", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const token = searchParams.get("t");
  const rawUrl = searchParams.get("url");
  let targetUrl = "";

  try {
    targetUrl = rawUrl ? decodeURIComponent(rawUrl) : token ? decodeToken(token) : "";
  } catch {
    return new Response("Invalid segment token", { status: 400 });
  }
  if (!targetUrl) return new Response("Segment URL/Token required", { status: 400 });

  try {
    const upstreamRes = await fetch(targetUrl, {
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    if (!upstreamRes.ok || !upstreamRes.body) {
      return new Response("Segment stream unavailable", { status: upstreamRes.status || 502 });
    }

    const headers = new Headers();
    headers.set("Content-Type", upstreamRes.headers.get("content-type") || "video/mp2t");
    headers.set("Cache-Control", "private, max-age=30");
    headers.set("Access-Control-Allow-Origin", "*");
    const length = upstreamRes.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    // Flux direct : pas de copie ArrayBuffer complète en mémoire sur Railway.
    return new Response(upstreamRes.body, { status: 200, headers });
  } catch (err: any) {
    return new Response(`Segment Proxy Error: ${err?.message || "fetch failed"}`, { status: 502 });
  }
}
