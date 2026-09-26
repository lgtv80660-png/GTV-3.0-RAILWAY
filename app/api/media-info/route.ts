import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";

function normalizeHost(value: string) {
  return String(value || "").replace(/\/+$/, "");
}

function durationTextToSeconds(value: unknown) {
  if (!value) return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const text = String(value).trim();

  // Si c'est déjà un nombre de secondes
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    return Number.isFinite(n) ? n : 0;
  }

  // HH:MM:SS
  const parts = text.split(":").map(Number);

  if (
    parts.length === 3 &&
    parts.every((v) => Number.isFinite(v))
  ) {
    const [h, m, s] = parts;

    return h * 3600 + m * 60 + s;
  }

  // MM:SS
  if (
    parts.length === 2 &&
    parts.every((v) => Number.isFinite(v))
  ) {
    const [m, s] = parts;

    return m * 60 + s;
  }

  return 0;
}

function extractDuration(info: any) {
  if (!info) return 0;

  const candidates = [
    info.duration_secs,
    info.duration_sec,
    info.duration_seconds,
    info.duration,
    info.runtime,
  ];

  for (const value of candidates) {
    const seconds = durationTextToSeconds(value);

    if (seconds > 0) {
      return seconds;
    }
  }

  return 0;
}

export async function GET(req: Request) {
  try {
    /* =====================================================
       SESSION XTREAM
    ===================================================== */

    let sessionData: any;

    try {
      sessionData = await requireSession();
    } catch {
      return Response.json(
        {
          ok: false,
          error: "Non authentifié",
          duration: 0,
        },
        {
          status: 401,
        }
      );
    }

    const creds =
      sessionData?.user ||
      sessionData;

    const host = normalizeHost(
      creds?.baseUrl ||
        creds?.url ||
        creds?.serverUrl ||
        creds?.server ||
        creds?.host ||
        ""
    );

    const username =
      creds?.username ||
      creds?.user ||
      "";

    const password =
      creds?.password ||
      creds?.pass ||
      "";

    if (
      !host ||
      !username ||
      !password
    ) {
      return Response.json(
        {
          ok: false,
          error: "Identifiants Xtream incomplets",
          duration: 0,
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       QUERY
    ===================================================== */

    const { searchParams } =
      new URL(req.url);

    const type =
      searchParams.get("type") ||
      "movie";

    const id =
      searchParams.get("id");

    const seriesId =
      searchParams.get("seriesId");

    const episodeId =
      searchParams.get("episodeId") ||
      id;

    if (!id && !seriesId) {
      return Response.json(
        {
          ok: false,
          error: "ID manquant",
          duration: 0,
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       FILM
    ===================================================== */

    if (type === "movie") {
      const apiUrl =
        `${host}/player_api.php` +
        `?username=${encodeURIComponent(username)}` +
        `&password=${encodeURIComponent(password)}` +
        `&action=get_vod_info` +
        `&vod_id=${encodeURIComponent(String(id))}`;

      const response =
        await fetch(apiUrl, {
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
          },
          cache: "no-store",
        });

      if (!response.ok) {
        return Response.json(
          {
            ok: false,
            error: `Xtream VOD info ${response.status}`,
            duration: 0,
          },
          {
            status: 502,
          }
        );
      }

      const data =
        await response.json();

      const info =
        data?.info ||
        data?.movie_data ||
        data ||
        {};

      const duration =
        extractDuration(info) ||
        extractDuration(data?.movie_data);

      return Response.json({
        ok: true,
        type: "movie",
        id,
        duration,

        // pratique pour debug
        durationText:
          info?.duration ||
          data?.movie_data?.duration ||
          null,
      });
    }

    /* =====================================================
       SÉRIE
    ===================================================== */

    if (type === "series") {
      if (!seriesId) {
        return Response.json(
          {
            ok: false,
            error:
              "seriesId requis pour récupérer la durée d'un épisode",
            duration: 0,
          },
          {
            status: 400,
          }
        );
      }

      const apiUrl =
        `${host}/player_api.php` +
        `?username=${encodeURIComponent(username)}` +
        `&password=${encodeURIComponent(password)}` +
        `&action=get_series_info` +
        `&series_id=${encodeURIComponent(seriesId)}`;

      const response =
        await fetch(apiUrl, {
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
          },
          cache: "no-store",
        });

      if (!response.ok) {
        return Response.json(
          {
            ok: false,
            error: `Xtream series info ${response.status}`,
            duration: 0,
          },
          {
            status: 502,
          }
        );
      }

      const data =
        await response.json();

      const episodes =
        data?.episodes ||
        {};

      let foundEpisode: any =
        null;

      /* ===============================================
         episodes peut être :

         {
           "1": [...],
           "2": [...]
         }
      =============================================== */

      for (const seasonEpisodes of Object.values(
        episodes
      )) {
        if (
          !Array.isArray(
            seasonEpisodes
          )
        ) {
          continue;
        }

        const found =
          seasonEpisodes.find(
            (episode: any) =>
              String(
                episode?.id ??
                  episode?.stream_id ??
                  ""
              ) ===
              String(
                episodeId
              )
          );

        if (found) {
          foundEpisode =
            found;

          break;
        }
      }

      if (!foundEpisode) {
        return Response.json({
          ok: false,
          type: "series",
          seriesId,
          episodeId,
          duration: 0,
          error:
            "Épisode introuvable dans get_series_info",
        });
      }

      const duration =
        extractDuration(
          foundEpisode?.info
        ) ||
        extractDuration(
          foundEpisode
        );

      return Response.json({
        ok: true,

        type: "series",

        seriesId,

        episodeId,

        duration,

        season:
          foundEpisode?.season ??
          null,

        episode:
          foundEpisode?.episode_num ??
          foundEpisode?.episode ??
          null,

        durationText:
          foundEpisode?.info
            ?.duration ||
          foundEpisode?.duration ||
          null,
      });
    }

    return Response.json(
      {
        ok: false,
        error: "Type inconnu",
        duration: 0,
      },
      {
        status: 400,
      }
    );
  } catch (error: any) {
    console.error(
      "[GTV MEDIA INFO]",
      error
    );

    return Response.json(
      {
        ok: false,
        duration: 0,
        error:
          error?.message ||
          "Erreur media-info",
      },
      {
        status: 500,
      }
    );
  }
}