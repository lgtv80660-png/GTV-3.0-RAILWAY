import { requireSession } from "@/lib/session";
import { buildStreamUrl } from "@/lib/xtream/urls";
import dns from "node:dns/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";

function safeError(err: any) {
  return {
    message: err?.message || null,
    code: err?.code || null,
    causeCode: err?.cause?.code || null,
    causeMessage: err?.cause?.message || null,
  };
}

function safeTarget(rawUrl: string) {
  try {
    const url = new URL(rawUrl);

    return {
      protocol: url.protocol,
      hostname: url.hostname,
      port:
        url.port ||
        (url.protocol === "https:" ? "443" : "80"),
    };
  } catch {
    return null;
  }
}

async function testFetch(
  name: string,
  url: string,
  timeout = 10000
) {
  const started = Date.now();

  try {
    /*
     * IMPORTANT:
     * manual = on NE suit PAS automatiquement
     * les redirections.
     *
     * Cela permet de voir où le serveur
     * veut nous envoyer sans exposer
     * l'URL complète.
     */
    const res = await fetch(url, {
      method: "GET",

      headers: {
        "User-Agent": UA,
        Accept: "*/*",
      },

      redirect: "manual",
      cache: "no-store",

      signal: AbortSignal.timeout(timeout),
    });

    const location =
      res.headers.get("location");

    let redirectTarget:
      | {
          protocol: string;
          hostname: string;
          port: string;
        }
      | null = null;

    if (location) {
      try {
        /*
         * Supporte aussi les redirects relatifs.
         */
        const target = new URL(
          location,
          url
        );

        redirectTarget = {
          protocol: target.protocol,
          hostname: target.hostname,

          port:
            target.port ||
            (target.protocol === "https:"
              ? "443"
              : "80"),
        };
      } catch {
        redirectTarget = null;
      }
    }

    return {
      name,

      ok: true,

      status: res.status,

      ms:
        Date.now() -
        started,

      contentType:
        res.headers.get(
          "content-type"
        ),

      redirect: Boolean(location),

      /*
       * AUCUN PATH
       * AUCUN USERNAME
       * AUCUN PASSWORD
       */
      redirectTarget,
    };
  } catch (err: any) {
    return {
      name,

      ok: false,

      ms:
        Date.now() -
        started,

      error:
        safeError(err),
    };
  }
}

export async function GET(
  req: Request
) {
  let creds: any;

  /*
   * =========================
   * SESSION
   * =========================
   */

  try {
    creds =
      await requireSession();
  } catch {
    return Response.json(
      {
        ok: false,
        error:
          "Not authenticated",
      },
      {
        status: 401,
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }

  const {
    searchParams,
  } = new URL(req.url);

  const id =
    searchParams.get("id");

  if (!id) {
    return Response.json(
      {
        ok: false,
        error:
          "Missing stream id",
      },
      {
        status: 400,
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }

  try {
    /*
     * =========================
     * LIVE URL
     * =========================
     *
     * Exactement la même construction
     * que /api/hls.
     */

    const liveUrl =
      buildStreamUrl(
        creds,
        "live",
        id,
        "m3u8"
      );

    const live =
      new URL(liveUrl);

    /*
     * =========================
     * DNS DU HOST PRINCIPAL
     * =========================
     */

    let dnsResult: any;

    try {
      const addresses =
        await dns.lookup(
          live.hostname,
          {
            all: true,
          }
        );

      dnsResult =
        addresses.map(
          (item) => ({
            family:
              item.family,

            /*
             * On masque le dernier
             * octet IPv4.
             */
            address:
              item.family === 4
                ? item.address.replace(
                    /\.\d+$/,
                    ".xxx"
                  )
                : "[IPv6]",
          })
        );
    } catch (err: any) {
      dnsResult = {
        error:
          safeError(err),
      };
    }

    /*
     * =========================
     * TEST 1
     * ORIGIN
     * =========================
     */

    const originTest =
      await testFetch(
        "origin",
        live.origin,
        10000
      );

    /*
     * =========================
     * TEST 2
     * PLAYER API
     * =========================
     */

    const playerApi =
      new URL(
        "/player_api.php",
        live.origin
      );

    playerApi.searchParams.set(
      "username",
      String(
        creds.username
      )
    );

    playerApi.searchParams.set(
      "password",
      String(
        creds.password
      )
    );

    const apiTest =
      await testFetch(
        "player_api",
        playerApi.toString(),
        10000
      );

    /*
     * =========================
     * TEST 3
     * LIVE M3U8
     * =========================
     *
     * redirect: manual
     *
     * On veut connaître le serveur
     * vers lequel gmztv.vercel.app
     * redirige réellement le Live.
     */

    const liveTest =
      await testFetch(
        "live_m3u8",
        liveUrl,
        12000
      );

    /*
     * =========================
     * TEST 4
     * REDIRECT TARGET ORIGIN
     * =========================
     *
     * Si le Live retourne 301/302/etc.,
     * on teste uniquement l'ORIGIN
     * du serveur cible.
     *
     * On n'envoie PAS le chemin Live
     * et donc aucun credential.
     */

    let redirectOriginTest:
      any = null;

    const redirectTarget =
      (liveTest as any)
        ?.redirectTarget;

    if (
      redirectTarget?.protocol &&
      redirectTarget?.hostname
    ) {
      const redirectOrigin =
        `${redirectTarget.protocol}//${redirectTarget.hostname}` +
        (
          redirectTarget.port &&
          !(
            redirectTarget.protocol ===
              "https:" &&
            redirectTarget.port ===
              "443"
          ) &&
          !(
            redirectTarget.protocol ===
              "http:" &&
            redirectTarget.port ===
              "80"
          )
            ? `:${redirectTarget.port}`
            : ""
        );

      redirectOriginTest =
        await testFetch(
          "redirect_origin",
          redirectOrigin,
          12000
        );
    }

    /*
     * =========================
     * RESPONSE
     * =========================
     */

    return Response.json(
      {
        ok: true,

        streamId: id,

        target:
          safeTarget(
            liveUrl
          ),

        dns:
          dnsResult,

        tests: [
          originTest,
          apiTest,
          liveTest,
          ...(redirectOriginTest
            ? [
                redirectOriginTest,
              ]
            : []),
        ],

        credentials: {
          usernamePresent:
            Boolean(
              creds.username
            ),

          passwordPresent:
            Boolean(
              creds.password
            ),

          /*
           * Valeurs jamais affichées.
           */
          valuesExposed:
            false,
        },
      },
      {
        status: 200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",

          "Content-Type":
            "application/json; charset=utf-8",
        },
      }
    );
  } catch (err: any) {
    return Response.json(
      {
        ok: false,

        error:
          safeError(err),
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
