import {
  NextRequest,
  NextResponse,
} from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* =========================================================
   TYPES
========================================================= */

type CinePubGrid = {
  r1: number;
  r2: number;
  c1: number;
  c2: number;
};

type CinePubAd = {
  id: number;

  client?: string;

  client_logo?: string | null;

  name?: string;

  regie_type?: "vod" | "live";

  format?: string;

  asset_url?: string;

  click_url?: string | null;

  grid?: CinePubGrid | null;

  duration_seconds?: number;

  trigger_type?: string;

  trigger_time?: number;

  audio?: boolean;

  media?: string;

  device?: string;

  scenario_id?: number | null;

  [key: string]: unknown;
};

type CinePubResponse = {
  status?: string;

  mode?: string;

  scenario?: unknown;

  ads?: CinePubAd[];

  message?: string;

  [key: string]: unknown;
};

/* =========================================================
   CONFIG
========================================================= */

/**
 * IMPORTANT :
 *
 * Cette URL vient UNIQUEMENT de Railway :
 *
 * PHP_ADSERVER_URL=
 * https://ton-serveur/cinepub-studio/api.php
 *
 * Aucun domaine CinePub n'est écrit en dur ici.
 */
function getAdServerUrl(): string {
  const value =
    process.env.PHP_ADSERVER_URL?.trim();

  if (!value) {
    throw new Error(
      "PHP_ADSERVER_URL is not configured"
    );
  }

  return value;
}

/* =========================================================
   URL HELPERS
========================================================= */

/**
 * Transforme :
 *
 * uploads/client/campaign/video/ad.webm
 *
 * en :
 *
 * https://serveur/cinepub-studio/uploads/...
 *
 * en utilisant automatiquement l'URL de l'API.
 */
function resolveRemoteUrl(
  value: string | null | undefined,
  apiUrl: string
): string | null {
  if (!value) {
    return null;
  }

  const trimmed =
    String(value).trim();

  if (!trimmed) {
    return null;
  }

  /*
   * URL déjà absolue.
   */
  if (
    trimmed.startsWith("https://") ||
    trimmed.startsWith("http://")
  ) {
    /*
     * On préfère HTTPS lorsque l'API
     * a accidentellement retourné HTTP.
     */
    return trimmed.replace(
      /^http:\/\//i,
      "https://"
    );
  }

  try {
    /*
     * Exemple :
     *
     * apiUrl =
     * https://host/cinepub-studio/api.php
     *
     * value =
     * uploads/test/pub.webm
     *
     * résultat =
     * https://host/cinepub-studio/uploads/test/pub.webm
     */
    return new URL(
      trimmed.replace(/^\/+/, ""),
      apiUrl
    ).href;
  } catch {
    return trimmed;
  }
}

/* =========================================================
   EMPTY RESPONSE
========================================================= */

function emptyResponse(
  message?: string
) {
  return NextResponse.json(
    {
      status: "empty",
      mode: "none",
      scenario: null,
      ads: [],
      ...(message
        ? { message }
        : {}),
    },
    {
      status: 200,

      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );
}

/* =========================================================
   GET /api/ad
========================================================= */

export async function GET(
  request: NextRequest
) {
  try {
    /* =====================================================
       PARAMS APP
    ===================================================== */

    const {
      searchParams,
    } = new URL(request.url);

    const media =
      searchParams.get("media") ||
      "movie";

    const device =
      searchParams.get("device") ||
      "tv";

    /* =====================================================
       ADSERVER
    ===================================================== */

    const baseUrl =
      getAdServerUrl();

    const remoteUrl =
      new URL(baseUrl);

    /*
     * Studio 4
     */
    remoteUrl.searchParams.set(
      "media",
      media
    );

    remoteUrl.searchParams.set(
      "device",
      device
    );

    /*
     * Si demain CinePub reçoit
     * d'autres paramètres utiles,
     * on peut les transférer ici.
     */
    const passthroughParams = [
      "channel_id",
      "content_id",
      "category_id",
    ];

    for (
      const key of passthroughParams
    ) {
      const value =
        searchParams.get(key);

      if (value) {
        remoteUrl.searchParams.set(
          key,
          value
        );
      }
    }

    /* =====================================================
       CALL CINEPUB STUDIO
    ===================================================== */

    const response =
      await fetch(
        remoteUrl.toString(),
        {
          method: "GET",

          cache: "no-store",

          headers: {
            Accept:
              "application/json",

            "User-Agent":
              "GTV-3.0-CinePubProxy/4.0",
          },
        }
      );

    /* =====================================================
       HTTP ERROR
    ===================================================== */

    if (!response.ok) {
      console.error(
        "[CinePub Proxy] HTTP error:",
        response.status,
        response.statusText
      );

      return emptyResponse(
        "AdServer indisponible"
      );
    }

    /* =====================================================
       PARSE JSON
    ===================================================== */

    let data: CinePubResponse;

    try {
      data =
        (await response.json()) as CinePubResponse;
    } catch (error) {
      console.error(
        "[CinePub Proxy] Invalid JSON:",
        error
      );

      return emptyResponse(
        "Réponse AdServer invalide"
      );
    }

    /* =====================================================
       PAS DE PUB
    ===================================================== */

    if (
      data?.status !== "success"
    ) {
      return NextResponse.json(
        {
          ...data,

          status:
            data?.status ||
            "empty",

          mode:
            data?.mode ||
            "none",

          scenario:
            data?.scenario ??
            null,

          ads:
            Array.isArray(
              data?.ads
            )
              ? data.ads
              : [],
        },
        {
          status: 200,

          headers: {
            "Cache-Control":
              "no-store, no-cache, must-revalidate, proxy-revalidate",
            Pragma:
              "no-cache",
            Expires:
              "0",
          },
        }
      );
    }

    /* =====================================================
       NORMALIZE ADS[]
    ===================================================== */

    const rawAds =
      Array.isArray(data.ads)
        ? data.ads
        : [];

    const normalizedAds =
      rawAds.map(
        (
          ad: CinePubAd
        ): CinePubAd => {
          const normalized:
            CinePubAd = {
            ...ad,
          };

          /* -----------------------------------------------
             ASSET
          ------------------------------------------------ */

          if (
            typeof ad.asset_url ===
            "string"
          ) {
            normalized.asset_url =
              resolveRemoteUrl(
                ad.asset_url,
                baseUrl
              ) || "";
          }

          /* -----------------------------------------------
             CLIENT LOGO
          ------------------------------------------------ */

          if (
            typeof ad.client_logo ===
            "string"
          ) {
            normalized.client_logo =
              resolveRemoteUrl(
                ad.client_logo,
                baseUrl
              );
          }

          /* -----------------------------------------------
             LIVE = AUDIO HARD OFF

             Même si une mauvaise valeur
             arrive depuis PHP.
          ------------------------------------------------ */

          if (
            ad.regie_type ===
              "live" ||
            media === "live"
          ) {
            normalized.audio =
              false;
          }

          return normalized;
        }
      );

    /* =====================================================
       FINAL RESPONSE
    ===================================================== */

    return NextResponse.json(
      {
        ...data,

        status:
          "success",

        mode:
          data.mode ||
          "campaign",

        scenario:
          data.scenario ??
          null,

        ads:
          normalizedAds,
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, proxy-revalidate",

          Pragma:
            "no-cache",

          Expires:
            "0",
        },
      }
    );
  } catch (error) {
    console.error(
      "[CinePub Proxy] Error:",
      error
    );

    return emptyResponse(
      "Erreur lors du traitement de la publicité"
    );
  }
}