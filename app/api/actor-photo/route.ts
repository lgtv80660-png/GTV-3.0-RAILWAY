import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
type Entry = { expiresAt: number; value: any };
const cache = new Map<string, Entry>();
const TTL = 24 * 60 * 60 * 1000;

function response(value: any) {
  return NextResponse.json(value, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}

export async function GET(req: NextRequest) {
  try {
    const name = req.nextUrl.searchParams.get("name")?.trim();
    if (!name) return response({ photoUrl: null, bio: null });

    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return response(hit.value);

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) return response({ photoUrl: null, bio: null });

    const search = new URL(`${TMDB_BASE}/search/person`);
    search.searchParams.set("api_key", apiKey);
    search.searchParams.set("query", name);
    search.searchParams.set("language", "fr-FR");

    const searchRes = await fetch(search, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
    if (!searchRes.ok) return response({ photoUrl: null, bio: null });
    const searchData = await searchRes.json();
    const person = searchData?.results?.[0];
    if (!person?.id) return response({ photoUrl: null, bio: null });

    const detailsUrl = (lang: string) => `${TMDB_BASE}/person/${person.id}?api_key=${apiKey}&language=${lang}`;
    const frRes = await fetch(detailsUrl("fr-FR"), { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
    const frData = frRes.ok ? await frRes.json() : {};
    let enData: any = {};
    if (!frData?.biography?.trim()) {
      const enRes = await fetch(detailsUrl("en-US"), { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
      if (enRes.ok) enData = await enRes.json();
    }

    const profilePath = frData?.profile_path || enData?.profile_path || person?.profile_path;
    const value = {
      id: person.id,
      name: frData?.name || enData?.name || person?.name || name,
      photoUrl: profilePath ? `${TMDB_IMAGE}${profilePath}` : null,
      bio: frData?.biography?.trim() || enData?.biography?.trim() || null,
      birthday: frData?.birthday || enData?.birthday || null,
      placeOfBirth: frData?.place_of_birth || enData?.place_of_birth || null,
      knownFor: frData?.known_for_department || enData?.known_for_department || null,
    };
    cache.set(key, { expiresAt: Date.now() + TTL, value });
    return response(value);
  } catch {
    return response({ photoUrl: null, bio: null });
  }
}
