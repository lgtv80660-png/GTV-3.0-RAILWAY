import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_W500 = "https://image.tmdb.org/t/p/w500";
const TMDB_IMAGE_ORIGINAL = "https://image.tmdb.org/t/p/original";

const FANART_BASE = "https://webservice.fanart.tv/v3";

/* =========================================================
   HELPERS
========================================================= */

function pickImage(items?: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const preferred =
    items.find((item) => item?.lang === "fr") ||
    items.find((item) => item?.lang === "en") ||
    items.find((item) => !item?.lang) ||
    items[0];

  return preferred?.url || null;
}

function pickBestBackdrop(items?: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const sorted = [...items].sort((a, b) => {
    const likesA = Number(a?.likes || 0);
    const likesB = Number(b?.likes || 0);

    return likesB - likesA;
  });

  return sorted[0]?.url || null;
}

function buildFanartSeasonPosterMap(items?: any[]) {
  const result: Record<string, string> = {};

  if (!Array.isArray(items)) {
    return result;
  }

  const sorted = [...items].sort((a, b) => {
    const likesA = Number(a?.likes || 0);
    const likesB = Number(b?.likes || 0);

    return likesB - likesA;
  });

  for (const item of sorted) {
    const seasonRaw = String(item?.season ?? "");
    const seasonNumber =
      seasonRaw.replace(/\D/g, "") || seasonRaw;

    if (!seasonNumber || !item?.url) {
      continue;
    }

    if (!result[seasonNumber]) {
      result[seasonNumber] = item.url;
    }
  }

  return result;
}

/* =========================================================
   ROUTE
========================================================= */

export async function GET(req: NextRequest) {
  try {
    const tmdbId =
      req.nextUrl.searchParams.get("tmdbId");

    if (!tmdbId) {
      return NextResponse.json(
        {
          error: "Missing tmdbId",
        },
        {
          status: 400,
        }
      );
    }

    const tmdbApiKey =
      process.env.TMDB_API_KEY;

    const fanartApiKey =
      process.env.FANART_API_KEY;

    if (!tmdbApiKey) {
      return NextResponse.json(
        {
          error: "TMDB_API_KEY missing",
        },
        {
          status: 500,
        }
      );
    }

    /*
      Fanart est utile mais on permet quand même
      à la route de fonctionner sans Fanart :
      TMDB pourra fournir poster/backdrop/saisons.
    */

    /* =====================================================
       TMDB SERIES + EXTERNAL IDS
    ===================================================== */

    const [seriesRes, externalIdsRes] =
      await Promise.all([
        fetch(
          `${TMDB_BASE}/tv/${tmdbId}?api_key=${tmdbApiKey}&language=fr-FR`,
          {
            next: {
              revalidate: 86400,
            },
          }
        ),

        fetch(
          `${TMDB_BASE}/tv/${tmdbId}/external_ids?api_key=${tmdbApiKey}`,
          {
            next: {
              revalidate: 86400,
            },
          }
        ),
      ]);

    if (!seriesRes.ok) {
      return NextResponse.json(
        {
          error: "TMDB series request failed",
        },
        {
          status: seriesRes.status,
        }
      );
    }

    const seriesData =
      await seriesRes.json();

    const externalIdsData =
      externalIdsRes.ok
        ? await externalIdsRes.json()
        : {};

    const tvdbId =
      externalIdsData?.tvdb_id || null;

    /* =====================================================
       TMDB FALLBACKS
    ===================================================== */

    const tmdbBackdrop =
      seriesData?.backdrop_path
        ? `${TMDB_IMAGE_ORIGINAL}${seriesData.backdrop_path}`
        : null;

    const tmdbPoster =
      seriesData?.poster_path
        ? `${TMDB_IMAGE_W500}${seriesData.poster_path}`
        : null;

    /* =====================================================
       TMDB SEASONS
    ===================================================== */

    const tmdbSeasons: Record<
      string,
      {
        poster: string | null;
        name: string;
        episodeCount?: number;
      }
    > = {};

    if (
      Array.isArray(seriesData?.seasons)
    ) {
      for (
        const season of
        seriesData.seasons
      ) {
        const seasonNumber =
          Number(
            season?.season_number
          );

        /*
          Saison 0 = Specials.
          On peut la garder si tu veux,
          mais ici on l'ignore.
        */

        if (
          !seasonNumber ||
          seasonNumber < 1
        ) {
          continue;
        }

        const key =
          String(seasonNumber);

        tmdbSeasons[key] = {
          poster:
            season?.poster_path
              ? `${TMDB_IMAGE_W500}${season.poster_path}`
              : null,

          name:
            season?.name ||
            `Saison ${seasonNumber}`,

          episodeCount:
            typeof season?.episode_count ===
            "number"
              ? season.episode_count
              : undefined,
        };
      }
    }

    /* =====================================================
       SI PAS FANART
    ===================================================== */

    if (
      !fanartApiKey ||
      !tvdbId
    ) {
      return NextResponse.json({
        tvdbId,

        logo: null,

        backdrop:
          tmdbBackdrop,

        poster:
          tmdbPoster,

        seasons:
          tmdbSeasons,

        source: {
          fanart: false,
          tmdb: true,
        },
      });
    }

    /* =====================================================
       FANART
    ===================================================== */

    const fanartRes =
      await fetch(
        `${FANART_BASE}/tv/${tvdbId}?api_key=${fanartApiKey}`,
        {
          next: {
            revalidate: 86400,
          },
        }
      );

    /*
      Si Fanart échoue :
      fallback TMDB, pas d'erreur fatale.
    */

    if (!fanartRes.ok) {
      return NextResponse.json({
        tvdbId,

        logo: null,

        backdrop:
          tmdbBackdrop,

        poster:
          tmdbPoster,

        seasons:
          tmdbSeasons,

        source: {
          fanart: false,
          tmdb: true,
        },
      });
    }

    const fanart =
      await fanartRes.json();

    /* =====================================================
       LOGO
    ===================================================== */

    const logo =
      pickImage(
        fanart?.hdtvlogo
      ) ||
      pickImage(
        fanart?.clearlogo
      ) ||
      pickImage(
        fanart?.tvlogo
      ) ||
      null;

    /* =====================================================
       BACKDROP
    ===================================================== */

    const fanartBackdrop =
      pickBestBackdrop(
        fanart?.showbackground
      ) ||
      pickBestBackdrop(
        fanart?.tvthumb
      ) ||
      null;

    const backdrop =
      fanartBackdrop ||
      tmdbBackdrop;

    /* =====================================================
       POSTER PRINCIPAL
    ===================================================== */

    const fanartPoster =
      pickImage(
        fanart?.tvposter
      );

    const poster =
      fanartPoster ||
      tmdbPoster;

    /* =====================================================
       SEASON POSTERS FANART
    ===================================================== */

    const fanartSeasonPosters =
      buildFanartSeasonPosterMap(
        fanart?.seasonposter
      );

    /* =====================================================
       MERGE SEASONS
       Fanart > TMDB
    ===================================================== */

    const seasonNumbers =
      new Set<string>([
        ...Object.keys(
          tmdbSeasons
        ),
        ...Object.keys(
          fanartSeasonPosters
        ),
      ]);

    const seasons: Record<
      string,
      {
        poster: string | null;
        name: string;
        episodeCount?: number;
      }
    > = {};

    for (
      const seasonNumber of
      seasonNumbers
    ) {
      seasons[seasonNumber] = {
        poster:
          fanartSeasonPosters[
            seasonNumber
          ] ||
          tmdbSeasons[
            seasonNumber
          ]?.poster ||
          poster ||
          null,

        name:
          tmdbSeasons[
            seasonNumber
          ]?.name ||
          `Saison ${seasonNumber}`,

        episodeCount:
          tmdbSeasons[
            seasonNumber
          ]?.episodeCount,
      };
    }

    /* =====================================================
       RESPONSE
    ===================================================== */

    return NextResponse.json({
      tmdbId:
        Number(tmdbId),

      tvdbId,

      logo,

      backdrop,

      poster,

      seasons,

      source: {
        fanart: true,
        tmdb: true,
      },
    });
  } catch (error) {
    console.error(
      "[GTV FANART SERIES]",
      error
    );

    return NextResponse.json(
      {
        logo: null,
        backdrop: null,
        poster: null,
        seasons: {},
        error:
          "Unable to load artwork",
      },
      {
        status: 200,
      }
    );
  }
}