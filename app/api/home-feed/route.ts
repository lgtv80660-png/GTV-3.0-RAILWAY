import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CacheEntry = { expiresAt: number; value: unknown };
const feedCache = new Map<string, CacheEntry>();
const TTL = 10 * 60 * 1000;

function normalizeBase(creds: any) {
  return String(creds?.baseUrl || creds?.url || creds?.serverUrl || "").replace(/\/+$/, "");
}

async function playerApi(baseUrl: string, username: string, password: string, action: string) {
  const url = new URL(`${baseUrl}/player_api.php`);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  url.searchParams.set("action", action);
  const res = await fetch(url, {
    headers: { "User-Agent": "GTV/3.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`${action}: ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function trimMovies(items: any[]) {
  const useful = items.filter((m) => m?.stream_id && m?.stream_icon);
  const byRating = [...useful].sort((a, b) => num(b.rating) - num(a.rating)).slice(0, 36);
  const byAdded = [...useful].sort((a, b) => num(b.added) - num(a.added)).slice(0, 36);
  const map = new Map<string, any>();
  for (const m of [...byRating, ...byAdded]) {
    map.set(String(m.stream_id), {
      stream_id: m.stream_id,
      name: m.name,
      stream_icon: m.stream_icon,
      rating: m.rating,
      rating_5based: m.rating_5based,
      added: m.added,
      category_id: m.category_id,
      container_extension: m.container_extension,
      tmdb: m.tmdb,
      tmdb_id: m.tmdb_id,
      releaseDate: m.releaseDate,
      releasedate: m.releasedate,
      genre: m.genre,
      plot: m.plot,
      description: m.description,
    });
  }
  return [...map.values()].slice(0, 60);
}

function trimSeries(items: any[]) {
  const useful = items.filter((s) => s?.series_id && (s?.cover || s?.backdrop_path?.[0]));
  const best = [...useful]
    .sort((a, b) => (num(b.rating) - num(a.rating)) || (num(b.last_modified) - num(a.last_modified)))
    .slice(0, 48);
  return best.map((s) => ({
    series_id: s.series_id,
    name: s.name,
    cover: s.cover,
    backdrop_path: Array.isArray(s.backdrop_path) ? s.backdrop_path.slice(0, 1) : s.backdrop_path,
    rating: s.rating,
    last_modified: s.last_modified,
    category_id: s.category_id,
    tmdb: s.tmdb,
    tmdb_id: s.tmdb_id,
    releaseDate: s.releaseDate,
    releasedate: s.releasedate,
    genre: s.genre,
    plot: s.plot,
    description: s.description,
  }));
}

export async function GET() {
  try {
    const creds: any = await requireSession();
    const baseUrl = normalizeBase(creds);
    const username = String(creds?.username || creds?.user || "");
    const password = String(creds?.password || creds?.pass || "");
    if (!baseUrl || !username || !password) {
      return NextResponse.json({ error: "Identifiants incomplets" }, { status: 400 });
    }

    const cacheKey = `${baseUrl}|${username}`;
    const cached = feedCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.value, {
        headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
      });
    }

    const [moviesRaw, seriesRaw] = await Promise.all([
      playerApi(baseUrl, username, password, "get_vod_streams").catch(() => []),
      playerApi(baseUrl, username, password, "get_series").catch(() => []),
    ]);

    const value = {
      success: true,
      movies: trimMovies(moviesRaw),
      series: trimSeries(seriesRaw),
    };
    feedCache.set(cacheKey, { expiresAt: Date.now() + TTL, value });

    return NextResponse.json(value, {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Home feed indisponible" },
      { status: 500 },
    );
  }
}
