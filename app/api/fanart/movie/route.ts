import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_ORIGINAL = "https://image.tmdb.org/t/p/original";
const FANART_BASE = "https://webservice.fanart.tv/v3";

function pickBest(items?: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return [...items]
    .sort(
      (a, b) =>
        Number(b?.likes || 0) -
        Number(a?.likes || 0)
    )[0]?.url || null;
}

function pickLocalized(items?: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const sorted = [...items].sort(
    (a, b) =>
      Number(b?.likes || 0) -
      Number(a?.likes || 0)
  );

  return (
    sorted.find((item) => item?.lang === "fr")?.url ||
    sorted.find((item) => item?.lang === "en")?.url ||
    sorted.find((item) => !item?.lang)?.url ||
    sorted[0]?.url ||
    null
  );
}

export async function GET(req: NextRequest) {
  const tmdbId =
    req.nextUrl.searchParams.get("tmdbId");

  if (!tmdbId) {
    return NextResponse.json(
      { error: "Missing tmdbId" },
      { status: 400 }
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

  try {
    /* ==========================================
       TMDB
    ========================================== */

    const [movieRes, imagesRes] =
      await Promise.all([
        fetch(
          `${TMDB_BASE}/movie/${encodeURIComponent(
            tmdbId
          )}?api_key=${tmdbApiKey}&language=fr-FR`,
          {
            next: {
              revalidate: 86400,
            },
          }
        ),

        fetch(
          `${TMDB_BASE}/movie/${encodeURIComponent(
            tmdbId
          )}/images?api_key=${tmdbApiKey}&include_image_language=fr,en,null`,
          {
            next: {
              revalidate: 86400,
            },
          }
        ),
      ]);

    if (!movieRes.ok) {
      return NextResponse.json(
        {
          error: "TMDB failed",
        },
        {
          status: movieRes.status,
        }
      );
    }

    const movieData =
      await movieRes.json();

    const imagesData =
      imagesRes.ok
        ? await imagesRes.json()
        : {};

    /* ==========================================
       TMDB FALLBACKS
    ========================================== */

    const tmdbBackdrop =
      movieData?.backdrop_path
        ? `${TMDB_IMAGE_ORIGINAL}${movieData.backdrop_path}`
        : null;

    const tmdbPoster =
      movieData?.poster_path
        ? `${TMDB_IMAGE_ORIGINAL}${movieData.poster_path}`
        : null;

    const tmdbLogoPath =
      Array.isArray(imagesData?.logos)
        ? [...imagesData.logos].sort(
            (a: any, b: any) =>
              Number(b?.vote_average || 0) -
              Number(a?.vote_average || 0)
          )[0]?.file_path
        : null;

    const tmdbLogo =
      tmdbLogoPath
        ? `${TMDB_IMAGE_ORIGINAL}${tmdbLogoPath}`
        : null;

    /* ==========================================
       FANART.TV

       Si aucune clé Fanart :
       on continue normalement avec TMDB.
    ========================================== */

    if (!fanartApiKey) {
      return NextResponse.json({
        tmdbId: Number(tmdbId),

        logo: tmdbLogo,

        poster: tmdbPoster,

        backdrop: tmdbBackdrop,

        source: {
          fanart: false,
          tmdb: true,
        },
      });
    }

    let fanart: any = null;

    try {
      const fanartRes =
        await fetch(
          `${FANART_BASE}/movies/${encodeURIComponent(
            tmdbId
          )}?api_key=${encodeURIComponent(
            fanartApiKey
          )}`,
          {
            next: {
              revalidate: 86400,
            },
          }
        );

      if (fanartRes.ok) {
        fanart =
          await fanartRes.json();
      }
    } catch {
      fanart = null;
    }

    /* ==========================================
       FANART WALLPAPER
    ========================================== */

    const fanartBackdrop =
      pickBest(
        fanart?.moviebackground
      );

    /* ==========================================
       FANART LOGO
    ========================================== */

    const fanartLogo =
      pickLocalized(
        fanart?.hdmovielogo
      ) ||
      pickLocalized(
        fanart?.movielogo
      );

    /* ==========================================
       FANART POSTER
    ========================================== */

    const fanartPoster =
      pickLocalized(
        fanart?.movieposter
      );

    /* ==========================================
       FINAL PRIORITY

       FANART > TMDB
    ========================================== */

    const backdrop =
      fanartBackdrop ||
      tmdbBackdrop;

    const logo =
      fanartLogo ||
      tmdbLogo;

    const poster =
      fanartPoster ||
      tmdbPoster;

    return NextResponse.json({
      tmdbId:
        Number(tmdbId),

      logo,

      poster,

      backdrop,

      source: {
        fanart:
          Boolean(fanart),

        backdrop:
          fanartBackdrop
            ? "fanart"
            : tmdbBackdrop
              ? "tmdb"
              : null,

        logo:
          fanartLogo
            ? "fanart"
            : tmdbLogo
              ? "tmdb"
              : null,

        poster:
          fanartPoster
            ? "fanart"
            : tmdbPoster
              ? "tmdb"
              : null,
      },
    });
  } catch (error) {
    console.error(
      "[GTV FANART MOVIE]",
      error
    );

    return NextResponse.json(
      {
        logo: null,
        poster: null,
        backdrop: null,
        error:
          "Unable to load movie artwork",
      },
      {
        status: 200,
      }
    );
  }
}
