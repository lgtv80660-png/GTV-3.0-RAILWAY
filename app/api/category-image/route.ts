import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CacheEntry = { expiresAt: number; imageUrl: string | null };
const cache = new Map<string, CacheEntry>();
const TTL = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let category = (searchParams.get("query") || "").trim();
    const TMDB_KEY = process.env.TMDB_API_KEY;
    if (!TMDB_KEY || !category) return NextResponse.json({ imageUrl: null });

    const cacheKey = category.toLowerCase();
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return NextResponse.json({ imageUrl: hit.imageUrl }, {
        headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
      });
    }

    if (cacheKey === "tous les films") category = "Inception";

    const searchTMDB = async (query: string) => {
      const searchUrl = new URL("https://api.themoviedb.org/3/search/movie");
      searchUrl.searchParams.set("api_key", TMDB_KEY);
      searchUrl.searchParams.set("query", query);
      searchUrl.searchParams.set("language", "fr-FR");
      searchUrl.searchParams.set("page", "1");
      const res = await fetch(searchUrl, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
      if (!res.ok) return null;
      const data = await res.json();
      const movie = data.results?.find((m: any) => m.backdrop_path);
      return movie ? `https://image.tmdb.org/t/p/w500${movie.backdrop_path}` : null;
    };

    let imageUrl = await searchTMDB(category);
    if (!imageUrl) {
      const words = category.split(/[\s/\-|_]+/);
      const firstSignificantWord = words.find((w) => w.length > 2 && !["les", "des", "aux"].includes(w.toLowerCase()));
      if (firstSignificantWord && firstSignificantWord !== category) imageUrl = await searchTMDB(firstSignificantWord);
    }
    if (!imageUrl) {
      const firstWord = category.split(/[\s/\-|_]+/)[0];
      if (firstWord && firstWord !== category) imageUrl = await searchTMDB(firstWord);
    }

    const value = imageUrl || null;
    cache.set(cacheKey, { expiresAt: Date.now() + TTL, imageUrl: value });
    return NextResponse.json({ imageUrl: value }, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ imageUrl: null });
  }
}
