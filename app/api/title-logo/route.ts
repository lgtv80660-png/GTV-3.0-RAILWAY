import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LogoCacheEntry = {
  expiresAt: number;
  logoUrl: string | null;
  tmdbId: string | null;
};

const logoCache = new Map<string, LogoCacheEntry>();
const LOGO_TTL = 24 * 60 * 60 * 1000;

function cleanMediaTitle(title: string) {
  return title
    .replace(/\|.*?\|/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s*[-|]\s*\b(19|20)\d{2}\b/g, "")
    .replace(/\b(Saison|Season|S)\s*\d+\b/gi, "")
    .replace(
      /\b(2160p|1080p|720p|4k|uhd|fhd|hd|hdr|vostfr|vost|vf|vff|vfi|multi|truefrench|french)\b/gi,
      ""
    )
    .replace(/[-_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeYear(value: string | null) {
  if (!value) return null;

  const match = value.match(/\b(19|20)\d{2}\b/);
  return match?.[0] || null;
}

async function getTmdbLogo(
  type: string,
  tmdbId: string,
  key: string
): Promise<string | null> {
  try {
    const url =
      `https://api.themoviedb.org/3/${type}/${tmdbId}/images` +
      `?api_key=${key}&include_image_language=fr,en,null`;

    const res = await fetch(url, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const logos = Array.isArray(data?.logos) ? data.logos : [];

    if (!logos.length) return null;

    const best =
      logos.find((logo: any) => logo.iso_639_1 === "fr") ||
      logos.find((logo: any) => logo.iso_639_1 === "en") ||
      logos[0];

    return best?.file_path
      ? `https://image.tmdb.org/t/p/w500${best.file_path}`
      : null;
  } catch {
    return null;
  }
}

async function searchTmdb(
  type: string,
  title: string,
  year: string | null,
  key: string
): Promise<string | null> {
  try {
    const url = new URL(
      `https://api.themoviedb.org/3/search/${type}`
    );

    url.searchParams.set("api_key", key);
    url.searchParams.set("query", title);
    url.searchParams.set("language", "fr-FR");

    // TMDB utilise year pour movie et first_air_date_year pour tv.
    if (year) {
      if (type === "movie") {
        url.searchParams.set("year", year);
      } else {
        url.searchParams.set("first_air_date_year", year);
      }
    }

    const res = await fetch(url.toString(), {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(7000),
    });

    if (!res.ok) return null;

    const data = await res.json();
    const results = Array.isArray(data?.results)
      ? data.results
      : [];

    if (!results.length) return null;

    /*
      Si l'année est disponible, on privilégie explicitement
      un résultat correspondant à cette année.
    */
    let best = results[0];

    if (year) {
      const exactYear = results.find((item: any) => {
        const date =
          type === "movie"
            ? item?.release_date
            : item?.first_air_date;

        return String(date || "").startsWith(year);
      });

      if (exactYear) {
        best = exactYear;
      }
    }

    return best?.id ? String(best.id) : null;
  } catch {
    return null;
  }
}

async function getFanartLogo(
  type: string,
  tmdbId: string,
  tmdbKey: string,
  fanartKey: string
): Promise<string | null> {
  try {
    let fanartQueryId = tmdbId;

    /*
      Fanart movie => TMDB ID
      Fanart TV    => TVDB ID
    */
    if (type === "tv") {
      const extRes = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${tmdbKey}`,
        {
          next: { revalidate: 86400 },
          signal: AbortSignal.timeout(7000),
        }
      );

      if (!extRes.ok) return null;

      const extData = await extRes.json();

      if (!extData?.tvdb_id) return null;

      fanartQueryId = String(extData.tvdb_id);
    }

    const fanartUrl =
      type === "movie"
        ? `https://webservice.fanart.tv/v3/movies/${fanartQueryId}?api_key=${fanartKey}`
        : `https://webservice.fanart.tv/v3/tv/${fanartQueryId}?api_key=${fanartKey}`;

    const fanartRes = await fetch(fanartUrl, {
      next: { revalidate: 86400 },
      signal: AbortSignal.timeout(7000),
    });

    if (!fanartRes.ok) return null;

    const data = await fanartRes.json();

    const logos =
      type === "movie"
        ? [
            ...(Array.isArray(data?.hdmovielogo)
              ? data.hdmovielogo
              : []),
            ...(Array.isArray(data?.movielogo)
              ? data.movielogo
              : []),
          ]
        : [
            ...(Array.isArray(data?.hdtvlogo)
              ? data.hdtvlogo
              : []),
            ...(Array.isArray(data?.clearlogo)
              ? data.clearlogo
              : []),
            ...(Array.isArray(data?.tvlogo)
              ? data.tvlogo
              : []),
          ];

    if (!logos.length) return null;

    const best =
      logos.find((logo: any) => logo.lang === "fr") ||
      logos.find((logo: any) => logo.lang === "en") ||
      logos.find((logo: any) => logo.lang === "00") ||
      logos[0];

    return best?.url || null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const providedTmdbId = searchParams.get("tmdbId");
    const title = searchParams.get("title") || "";
    const requestedType = searchParams.get("type") || "tv";
    const year = normalizeYear(searchParams.get("year"));

    const type =
      requestedType === "movie"
        ? "movie"
        : "tv";

    const TMDB_KEY = process.env.TMDB_API_KEY;
    const FANART_KEY = process.env.FANART_API_KEY;

    if (!TMDB_KEY) {
      return NextResponse.json({
        logoUrl: null,
        tmdbId: null,
      });
    }

    const cleanTitle = cleanMediaTitle(title);

    const cacheKey = [
      type,
      providedTmdbId || "",
      cleanTitle,
      year || "",
    ]
      .join("|")
      .toLowerCase();

    const cached = logoCache.get(cacheKey);

    if (
      cached &&
      cached.expiresAt > Date.now()
    ) {
      return NextResponse.json(
        {
          logoUrl: cached.logoUrl,
          tmdbId: cached.tmdbId,
        },
        {
          headers: {
            "Cache-Control":
              "public, max-age=3600, stale-while-revalidate=86400",
          },
        }
      );
    }

    let finalTmdbId =
      providedTmdbId &&
      providedTmdbId !== "0" &&
      providedTmdbId !== "null"
        ? providedTmdbId
        : null;

    let tmdbLogoUrl: string | null = null;

    /*
      1. Vérification éventuelle de l'ID fourni.

      IMPORTANT :
      on ne considère plus "absence de logo" comme preuve
      que l'ID TMDB est faux.
    */
    if (finalTmdbId) {
      try {
        const verifyUrl =
          `https://api.themoviedb.org/3/${type}/${finalTmdbId}` +
          `?api_key=${TMDB_KEY}`;

        const verifyRes = await fetch(verifyUrl, {
          next: { revalidate: 86400 },
          signal: AbortSignal.timeout(7000),
        });

        if (!verifyRes.ok) {
          finalTmdbId = null;
        }
      } catch {
        finalTmdbId = null;
      }
    }

    /*
      2. Pas d'ID Xtream fiable :
         recherche TMDB par titre + année.
    */
    if (!finalTmdbId && cleanTitle) {
      finalTmdbId = await searchTmdb(
        type,
        cleanTitle,
        year,
        TMDB_KEY
      );
    }

    /*
      3. Logo TMDB.
    */
    if (finalTmdbId) {
      tmdbLogoUrl = await getTmdbLogo(
        type,
        finalTmdbId,
        TMDB_KEY
      );
    }

    /*
      4. Fanart.
    */
    let fanartLogoUrl: string | null = null;

    if (finalTmdbId && FANART_KEY) {
      fanartLogoUrl = await getFanartLogo(
        type,
        finalTmdbId,
        TMDB_KEY,
        FANART_KEY
      );
    }

    const logoUrl =
      fanartLogoUrl ||
      tmdbLogoUrl ||
      null;

    logoCache.set(cacheKey, {
      expiresAt: Date.now() + LOGO_TTL,
      logoUrl,
      tmdbId: finalTmdbId,
    });

    return NextResponse.json(
      {
        logoUrl,

        // IMPORTANT POUR LE HERO
        tmdbId: finalTmdbId,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=3600, stale-while-revalidate=86400",
        },
      }
    );
  } catch (error) {
    console.error("[title-logo]", error);

    return NextResponse.json({
      logoUrl: null,
      tmdbId: null,
    });
  }
}
