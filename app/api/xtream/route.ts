import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================================================
   CACHE
========================================================= */

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const cache =
  new Map<string, CacheEntry>();

/* =========================================================
   CACHE TTL
========================================================= */

function ttlFor(action: string) {
  if (action.includes("categories")) {
    return 30 * 60 * 1000;
  }

  if (action === "get_live_streams") {
    return 10 * 60 * 1000;
  }

  if (
    action === "get_vod_streams" ||
    action === "get_series"
  ) {
    return 15 * 60 * 1000;
  }

  if (action.includes("info")) {
    return 15 * 60 * 1000;
  }

  return 2 * 60 * 1000;
}

/* =========================================================
   CACHEABLE ACTIONS
========================================================= */

function cacheable(action: string) {
  return [
    "get_live_categories",
    "get_live_streams",
    "get_vod_categories",
    "get_vod_streams",
    "get_series_categories",
    "get_series",
    "get_vod_info",
    "get_series_info",
  ].includes(action);
}

/* =========================================================
   GET
========================================================= */

export async function GET(req: Request) {
  /* =======================================================
     AUTH
  ======================================================= */

  let creds: any;

  try {
    creds =
      await requireSession();
  } catch {
    return NextResponse.json(
      {
        error: "Non authentifié",
      },
      {
        status: 401,
      }
    );
  }

  try {
    const {
      searchParams,
    } = new URL(req.url);

    const action =
      searchParams.get("action") || "";

    /* =====================================================
       XTREAM CREDENTIALS
    ===================================================== */

    const baseUrl = String(
      creds?.baseUrl ||
        creds?.url ||
        creds?.serverUrl ||
        ""
    ).replace(/\/+$/, "");

    const username = String(
      creds?.username ||
        creds?.user ||
        ""
    );

    const password = String(
      creds?.password ||
        creds?.pass ||
        ""
    );

    if (
      !baseUrl ||
      !username ||
      !password
    ) {
      return NextResponse.json(
        {
          error:
            "Identifiants incomplets",
        },
        {
          status: 400,
        }
      );
    }

    /* =====================================================
       FORWARDED PARAMETERS
    ===================================================== */

    const forwarded =
      new URLSearchParams();

    searchParams.forEach(
      (value, key) => {
        if (key !== "action") {
          forwarded.append(
            key,
            value
          );
        }
      }
    );

    /* =====================================================
       CACHE KEY
    ===================================================== */

    const cacheKey =
      `${baseUrl}|` +
      `${username}|` +
      `${action}|` +
      `${forwarded.toString()}`;

    /* =====================================================
       CACHE HIT
    ===================================================== */

    if (cacheable(action)) {
      const hit =
        cache.get(cacheKey);

      if (
        hit &&
        hit.expiresAt >
          Date.now()
      ) {
        return NextResponse.json(
          hit.value,
          {
            status: 200,

            headers: {
              "Cache-Control":
                "private, max-age=60, stale-while-revalidate=300",

              "x-gtv-cache":
                "hit",
            },
          }
        );
      }

      /*
       * Supprime éventuellement
       * l'entrée expirée.
       */
      if (hit) {
        cache.delete(
          cacheKey
        );
      }
    }

    /* =====================================================
       XTREAM URL
    ===================================================== */

    const upstreamUrl =
      new URL(
        `${baseUrl}/player_api.php`
      );

    upstreamUrl.searchParams.set(
      "username",
      username
    );

    upstreamUrl.searchParams.set(
      "password",
      password
    );

    if (action) {
      upstreamUrl.searchParams.set(
        "action",
        action
      );
    }

    forwarded.forEach(
      (value, key) => {
        upstreamUrl.searchParams.append(
          key,
          value
        );
      }
    );

    /* =====================================================
       FETCH XTREAM

       IMPORTANT:
       - aucun inflight global
       - timeout local
       - chaque requête est indépendante
    ===================================================== */

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => {
          controller.abort();
        },
        12_000
      );

    let res: Response;

    try {
      res = await fetch(
        upstreamUrl.toString(),
        {
          method: "GET",

          headers: {
            "User-Agent":
              "GTV/3.0",

            Accept:
              "application/json, text/plain, */*",
          },

          cache:
            "no-store",

          signal:
            controller.signal,
        }
      );
    } catch (error: any) {
      if (
        controller.signal.aborted
      ) {
        return NextResponse.json(
          {
            error:
              "Timeout serveur Xtream",
          },
          {
            status: 504,

            headers: {
              "Cache-Control":
                "no-store",
            },
          }
        );
      }

      console.error(
        "[XTREAM FETCH ERROR]",
        action,
        error?.message ||
          error
      );

      return NextResponse.json(
        {
          error:
            "Connexion au serveur Xtream impossible",
        },
        {
          status: 502,

          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    } finally {
      clearTimeout(
        timeout
      );
    }

    /* =====================================================
       HTTP ERROR
    ===================================================== */

    if (!res.ok) {
      console.warn(
        `[XTREAM UPSTREAM] action=${action || "auth"} status=${res.status}`
      );

      return NextResponse.json(
        {
          error:
            `Erreur IPTV (${res.status})`,
        },
        {
          status:
            res.status,

          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    /* =====================================================
       READ RESPONSE
    ===================================================== */

    let data:
      unknown;

    try {
      const text =
        await res.text();

      if (!text) {
        return NextResponse.json(
          {
            error:
              "Réponse Xtream vide",
          },
          {
            status: 502,

            headers: {
              "Cache-Control":
                "no-store",
            },
          }
        );
      }

      try {
        data =
          JSON.parse(text);
      } catch {
        console.error(
          `[XTREAM JSON ERROR] action=${action || "auth"} length=${text.length}`
        );

        return NextResponse.json(
          {
            error:
              "Réponse Xtream invalide",
          },
          {
            status: 502,

            headers: {
              "Cache-Control":
                "no-store",
            },
          }
        );
      }
    } catch (
      error: any
    ) {
      console.error(
        "[XTREAM READ ERROR]",
        action,
        error?.message ||
          error
      );

      return NextResponse.json(
        {
          error:
            "Impossible de lire la réponse Xtream",
        },
        {
          status: 502,

          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    /* =====================================================
       SAVE CACHE
    ===================================================== */

    if (cacheable(action)) {
      cache.set(
        cacheKey,
        {
          expiresAt:
            Date.now() +
            ttlFor(action),

          value:
            data,
        }
      );
    }

    /* =====================================================
       SUCCESS
    ===================================================== */

    return NextResponse.json(
      data,
      {
        status: 200,

        headers: {
          "Cache-Control":
            "private, max-age=30, stale-while-revalidate=180",

          "x-gtv-cache":
            "miss",
        },
      }
    );
  } catch (
    error: any
  ) {
    console.error(
      "[XTREAM ROUTE ERROR]",
      error?.message ||
        error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "Erreur serveur",
      },
      {
        status: 500,

        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }
}
