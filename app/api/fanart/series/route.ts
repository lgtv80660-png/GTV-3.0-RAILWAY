import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMDB = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/original";
const FANART = "https://webservice.fanart.tv/v3.2";

type Art = {
  url?: string;
  lang?: string;
  likes?: string | number;
};

type TmdbImage = {
  file_path?: string;
  vote_average?: number;
  vote_count?: number;
  width?: number;
  height?: number;
};

function tmdbImage(path?: string | null) {
  return path ? `${TMDB_IMG}${path}` : null;
}

function scoreFanart(item: Art) {
  const lang = String(item.lang || "").toLowerCase();
  const languageBoost = lang === "fr" ? 300 : lang === "en" ? 200 : lang === "00" ? 100 : 0;
  return languageBoost + Number(item.likes || 0);
}

function bestFanart(items?: Art[]) {
  return [...(items || [])]
    .filter((item) => /^https?:\/\//i.test(String(item?.url || "")))
    .sort((a, b) => scoreFanart(b) - scoreFanart(a))[0]?.url || null;
}

function scoreTmdb(item: TmdbImage) {
  const ratio = item.width && item.height ? item.width / item.height : 0;
  return (ratio >= 1.5 ? 100 : 0) +
    Number(item.vote_average || 0) * 10 +
    Math.min(Number(item.vote_count || 0), 100);
}

function tmdbList(items?: TmdbImage[], limit = 8) {
  return [...(items || [])]
    .filter((item) => item?.file_path)
    .sort((a, b) => scoreTmdb(b) - scoreTmdb(a))
    .map((item) => tmdbImage(item.file_path))
    .filter((url): url is string => Boolean(url))
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, limit);
}

export async function GET(req: NextRequest) {
  const tmdbId = req.nextUrl.searchParams.get("tmdbId");

  if (!tmdbId) {
    return NextResponse.json({ error: "Missing tmdbId" }, { status: 400 });
  }

  const tmdbKey = process.env.TMDB_API_KEY;
  const fanartKey = process.env.FANART_API_KEY;

  if (!tmdbKey) {
    return NextResponse.json(
      { error: "TMDB_API_KEY is not configured" },
      { status: 500 }
    );
  }

  try {
    const base = `${TMDB}/tv/${encodeURIComponent(tmdbId)}`;

    const [detailsRes, imagesRes, externalRes] = await Promise.all([
      fetch(`${base}?api_key=${encodeURIComponent(tmdbKey)}&language=fr-FR`, {
        next: { revalidate: 86400 },
      }),
      fetch(
        `${base}/images?api_key=${encodeURIComponent(tmdbKey)}&include_image_language=fr,en,null`,
        { next: { revalidate: 86400 } }
      ),
      fetch(`${base}/external_ids?api_key=${encodeURIComponent(tmdbKey)}`, {
        next: { revalidate: 86400 },
      }),
    ]);

    if (!detailsRes.ok) {
      return NextResponse.json(
        { error: "TMDB failed" },
        { status: detailsRes.status }
      );
    }

    const details = await detailsRes.json();
    const images = imagesRes.ok ? await imagesRes.json() : {};
    const external = externalRes.ok ? await externalRes.json() : {};
    const tvdbId = external?.tvdb_id ? String(external.tvdb_id) : null;

    let fanart: any = {};
    let fanartOk = false;

    if (fanartKey && tvdbId) {
      const response = await fetch(
        `${FANART}/tv/${encodeURIComponent(tvdbId)}?api_key=${encodeURIComponent(fanartKey)}`,
        { next: { revalidate: 86400 } }
      ).catch(() => null);

      fanartOk = Boolean(response?.ok);
      fanart = response?.ok
        ? await response.json().catch(() => ({}))
        : {};
    }

    const fanartBackdrop =
      bestFanart(fanart?.showbackground) ||
      bestFanart(fanart?.tvthumb);

    const fanartLogo =
      bestFanart(fanart?.hdtvlogo) ||
      bestFanart(fanart?.clearlogo) ||
      bestFanart(fanart?.tvlogo);

    const fanartPoster =
      bestFanart(fanart?.tvposter) ||
      bestFanart(fanart?.seasonposter);

    const tmdbBackdrops = tmdbList(images?.backdrops, 10);
    const tmdbLogos = tmdbList(images?.logos, 6);
    const tmdbPosters = tmdbList(images?.posters, 8);

    const primaryTmdbBackdrop = tmdbImage(details?.backdrop_path);
    const primaryTmdbPoster = tmdbImage(details?.poster_path);

    const backdrops = [
      fanartBackdrop,
      ...tmdbBackdrops,
      primaryTmdbBackdrop,
    ].filter((url, index, all): url is string =>
      Boolean(url) && all.indexOf(url) === index
    );

    const logo = fanartLogo || tmdbLogos[0] || null;
    const poster = fanartPoster || tmdbPosters[0] || primaryTmdbPoster || null;
    const backdrop = backdrops[0] || null;

    return NextResponse.json(
      {
        tmdbId,
        tvdbId,
        logo,
        poster,
        backdrop,
        backdrops,
        source: {
          fanart: fanartOk,
          backdrop: fanartBackdrop
            ? "fanart"
            : tmdbBackdrops[0]
              ? "tmdb-images"
              : primaryTmdbBackdrop
                ? "tmdb"
                : null,
          logo: fanartLogo ? "fanart" : tmdbLogos[0] ? "tmdb-images" : null,
          poster: fanartPoster
            ? "fanart"
            : tmdbPosters[0]
              ? "tmdb-images"
              : primaryTmdbPoster
                ? "tmdb"
                : null,
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        },
      }
    );
  } catch (error) {
    console.error("[fanart/series]", error);
    return NextResponse.json({ error: "Artwork unavailable" }, { status: 502 });
  }
}
