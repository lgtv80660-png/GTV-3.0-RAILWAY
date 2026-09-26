import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { expiresAt: number; value: unknown };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function ttlFor(action: string) {
  if (action.includes("categories")) return 30 * 60 * 1000;
  if (action === "get_live_streams") return 10 * 60 * 1000;
  if (action === "get_vod_streams" || action === "get_series") return 15 * 60 * 1000;
  if (action.includes("info")) return 15 * 60 * 1000;
  return 2 * 60 * 1000;
}

function cacheable(action: string) {
  return [
    "get_live_categories",
    "get_live_streams",
    "get_vod_categories",
    "get_vod_streams",
    "get_series_categories",
    "get_series",
    "get_vod_info",
    "get_series_info",
  ].includes(action);
}

export async function GET(req: Request) {
  let creds: any;
  try {
    creds = await requireSession();
  } catch {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "";
    const baseUrl = String(creds?.baseUrl || creds?.url || creds?.serverUrl || "").replace(/\/+$/, "");
    const username = String(creds?.username || creds?.user || "");
    const password = String(creds?.password || creds?.pass || "");

    if (!baseUrl || !username || !password) {
      return NextResponse.json({ error: "Identifiants incomplets" }, { status: 400 });
    }

    const forwarded = new URLSearchParams();
    searchParams.forEach((value, key) => {
      if (key !== "action") forwarded.append(key, value);
    });
    const cacheKey = `${baseUrl}|${username}|${action}|${forwarded.toString()}`;

    if (cacheable(action)) {
      const hit = cache.get(cacheKey);
      if (hit && hit.expiresAt > Date.now()) {
        return NextResponse.json(hit.value, {
          headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300", "x-gtv-cache": "hit" },
        });
      }
    }

    const load = async () => {
      const url = new URL(`${baseUrl}/player_api.php`);
      url.searchParams.set("username", username);
      url.searchParams.set("password", password);
      if (action) url.searchParams.set("action", action);
      forwarded.forEach((value, key) => url.searchParams.append(key, value));

      const res = await fetch(url.toString(), {
        headers: { "User-Agent": "GTV/3.0" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw Object.assign(new Error(`Erreur IPTV (${res.status})`), { status: res.status });
      return res.json();
    };

    let promise = inflight.get(cacheKey);
    if (!promise) {
      promise = load();
      inflight.set(cacheKey, promise);
    }

    let data: unknown;
    try {
      data = await promise;
    } finally {
      inflight.delete(cacheKey);
    }

    if (cacheable(action)) cache.set(cacheKey, { expiresAt: Date.now() + ttlFor(action), value: data });

    return NextResponse.json(data, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=180", "x-gtv-cache": "miss" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Erreur serveur" }, { status: err?.status || 500 });
  }
}
