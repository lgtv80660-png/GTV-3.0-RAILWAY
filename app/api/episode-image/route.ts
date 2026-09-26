import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w780";

/* =========================================================
   CLEAN SHOW NAME
========================================================= */

function cleanShowName(value: string) {
  return value
    .replace(/\(\d{4}\)/g, "")
    .replace(/\(4K.*?\)/gi, "")
    .replace(/\b4K\b/gi, "")
    .replace(/\bUHD\b/gi, "")
    .replace(/\bDV\b/gi, "")
    .replace(/\bHDR\b/gi, "")
    .replace(/\bS\d{1,2}E\d{1,3}\b/gi, "")
    .replace(/[-–—]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   ROUTE
========================================================= */

export async function GET(req: NextRequest) {
  try {
    let tmdbId =
      req.nextUrl.searchParams.get("tmdbId");

    const show =
      req.nextUrl.searchParams.get("show") || "";

    const season =
      req.nextUrl.searchParams.get("season");

    const episode =
      req.nextUrl.searchParams.get("episode");

    const apiKey =
      process.env.TMDB_API_KEY;

    if (
      !apiKey ||
      !season ||
      !episode
    ) {
      return NextResponse.json({
        imageUrl: null,
        overview: null,
        name: null,
      });
    }

    /* =========================================
       RESOLVE TMDB ID IF MISSING
    ========================================= */

    if (!tmdbId && show) {
      const cleanTitle =
        cleanShowName(show);

      const searchRes =
        await fetch(
          `${TMDB_BASE}/search/tv` +
            `?api_key=${apiKey}` +
            `&language=fr-FR` +
            `&query=${encodeURIComponent(cleanTitle)}`,
          {
            next: {
              revalidate: 86400,
            },
          }
        );

      if (searchRes.ok) {
        const searchData =
          await searchRes.json();

        const match =
          searchData?.results?.[0];

        if (match?.id) {
          tmdbId =
            String(match.id);
        }
      }
    }

    if (!tmdbId) {
      return NextResponse.json({
        imageUrl: null,
        overview: null,
        name: null,
      });
    }

    /* =========================================
       FR EPISODE
    ========================================= */

    const frRes =
      await fetch(
        `${TMDB_BASE}/tv/${tmdbId}` +
          `/season/${season}` +
          `/episode/${episode}` +
          `?api_key=${apiKey}` +
          `&language=fr-FR`,
        {
          next: {
            revalidate: 86400,
          },
        }
      );

    const frData =
      frRes.ok
        ? await frRes.json()
        : {};

    /* =========================================
       EN FALLBACK
    ========================================= */

    let enData: any = {};

    if (
      !frData?.overview?.trim() ||
      !frData?.still_path ||
      !frData?.name
    ) {
      const enRes =
        await fetch(
          `${TMDB_BASE}/tv/${tmdbId}` +
            `/season/${season}` +
            `/episode/${episode}` +
            `?api_key=${apiKey}` +
            `&language=en-US`,
          {
            next: {
              revalidate: 86400,
            },
          }
        );

      if (enRes.ok) {
        enData =
          await enRes.json();
      }
    }

    const stillPath =
      frData?.still_path ||
      enData?.still_path ||
      null;

    return NextResponse.json({
      tmdbId:
        Number(tmdbId),

      season:
        Number(season),

      episode:
        Number(episode),

      imageUrl:
        stillPath
          ? `${TMDB_IMAGE}${stillPath}`
          : null,

      name:
        frData?.name ||
        enData?.name ||
        null,

      overview:
        frData?.overview?.trim() ||
        enData?.overview?.trim() ||
        null,

      airDate:
        frData?.air_date ||
        enData?.air_date ||
        null,

      voteAverage:
        frData?.vote_average ||
        enData?.vote_average ||
        null,

      runtime:
        frData?.runtime ||
        enData?.runtime ||
        null,
    });
  } catch (error) {
    console.error(
      "[episode-image]",
      error
    );

    return NextResponse.json({
      imageUrl: null,
      overview: null,
      name: null,
    });
  }
}