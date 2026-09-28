import { requireSession } from "@/lib/session";
import { buildStreamUrl } from "@/lib/xtream/urls";
import dns from "node:dns/promises";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";
const MAX_REDIRECTS = 5;
const TIMEOUT = 12000;

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

function maskedAddress(address: string, family: number) {
  if (family === 4) {
    return address.replace(/\.\d+$/, ".xxx");
  }

  return "[IPv6]";
}

async function lookupHost(hostname: string) {
  try {
    const addresses = await dns.lookup(hostname, {
      all: true,
    });

    return addresses.map((item) => ({
      family: item.family,
      address: maskedAddress(
        item.address,
        item.family
      ),
    }));
  } catch (err: any) {
    return {
      error: safeError(err),
    };
  }
}

async function testOrigin(rawUrl: string) {
  const target = new URL(rawUrl);

  const origin = target.origin;

  const started = Date.now();

  try {
    const res = await fetch(origin, {
      method: "GET",

      headers: {
        "User-Agent": UA,
        Accept: "*/*",
      },

      redirect: "manual",
      cache: "no-store",

      signal: AbortSignal.timeout(
        TIMEOUT
      ),
    });

    return {
      ok: true,
      status: res.status,
      ms: Date.now() - started,
    };
  } catch (err: any) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: safeError(err),
    };
  }
}

async function followRedirectChain(
  initialUrl: string
) {
  const steps: any[] = [];

  let currentUrl = initialUrl;

  for (
    let index = 0;
    index <= MAX_REDIRECTS;
    index++
  ) {
    const currentSafe =
      safeTarget(currentUrl);

    if (!currentSafe) {
      steps.push({
        step: index + 1,
        ok: false,
        error: "Invalid URL",
      });

      break;
    }

    /*
     * DNS de chaque serveur rencontré.
     */
    const dnsResult =
      await lookupHost(
        currentSafe.hostname
      );

    const started =
      Date.now();

    try {
      /*
       * IMPORTANT :
       * redirect manual.
       *
       * On contrôle chaque saut
       * nous-mêmes.
       */
      const res = await fetch(
        currentUrl,
        {
          method: "GET",

          headers: {
            "User-Agent": UA,

            Accept:
              "application/vnd.apple.mpegurl, application/x-mpegURL, */*",
          },

          redirect: "manual",

          cache: "no-store",

          signal:
            AbortSignal.timeout(
              TIMEOUT
            ),
        }
      );

      const elapsed =
        Date.now() -
        started;

      const location =
        res.headers.get(
          "location"
        );

      const contentType =
        res.headers.get(
          "content-type"
        );

      const contentLength =
        res.headers.get(
          "content-length"
        );

      /*
       * On ne retourne JAMAIS
       * currentUrl.
       *
       * Seulement :
       * protocol
       * hostname
       * port
       */
      const step: any = {
        step: index + 1,

        target:
          currentSafe,

        dns:
          dnsResult,

        ok: true,

        status:
          res.status,

        ms:
          elapsed,

        contentType:
          contentType ||
          null,

        contentLength:
          contentLength ||
          null,

        redirect:
          Boolean(location),

        redirectTarget:
          null,
      };

      /*
       * REDIRECTION
       */
      if (location) {
        try {
          const nextUrl =
            new URL(
              location,
              currentUrl
            ).toString();

          step.redirectTarget =
            safeTarget(
              nextUrl
            );

          steps.push(step);

          /*
           * On continue avec
           * l'URL COMPLÈTE uniquement
           * côté serveur.
           *
           * Elle ne sera jamais
           * retournée au navigateur.
           */
          currentUrl =
            nextUrl;

          continue;
        } catch {
          step.redirectError =
            "Invalid redirect URL";

          steps.push(step);

          break;
        }
      }

      /*
       * Pas de redirect :
       * on regarde seulement un petit
       * morceau du body pour savoir
       * si on a enfin reçu un M3U8.
       *
       * On ne retourne PAS son contenu.
       */
      let bodyInfo: any = null;

      try {
        const text =
          await res.text();

        bodyInfo = {
          bytes:
            Buffer.byteLength(
              text,
              "utf8"
            ),

          isM3U8:
            text.includes(
              "#EXTM3U"
            ),

          hasExtInf:
            text.includes(
              "#EXTINF"
            ),

          hasStreamInf:
            text.includes(
              "#EXT-X-STREAM-INF"
            ),
        };
      } catch (err: any) {
        bodyInfo = {
          readError:
            safeError(err),
        };
      }

      step.body =
        bodyInfo;

      steps.push(step);

      /*
       * Fin de chaîne.
       */
      break;
    } catch (err: any) {
      steps.push({
        step:
          index + 1,

        target:
          currentSafe,

        dns:
          dnsResult,

        ok: false,

        ms:
          Date.now() -
          started,

        error:
          safeError(err),
      });

      break;
    }
  }

  return steps;
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
  } =
    new URL(req.url);

  const id =
    searchParams.get(
      "id"
    );

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
     * CONSTRUCTION EXACTE
     * DU LIVE
     * =========================
     */

    const liveUrl =
      buildStreamUrl(
        creds,
        "live",
        id,
        "m3u8"
      );

    const initialTarget =
      safeTarget(
        liveUrl
      );

    if (!initialTarget) {
      return Response.json(
        {
          ok: false,
          error:
            "Invalid Live URL",
        },
        {
          status: 500,
        }
      );
    }

    /*
     * =========================
     * TEST ORIGIN INITIAL
     * =========================
     */

    const originTest =
      await testOrigin(
        liveUrl
      );

    /*
     * =========================
     * PLAYER API
     * =========================
     */

    const liveParsed =
      new URL(
        liveUrl
      );

    const playerApi =
      new URL(
        "/player_api.php",
        liveParsed.origin
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

    const playerStarted =
      Date.now();

    let playerApiTest:
      any;

    try {
      const res =
        await fetch(
          playerApi.toString(),
          {
            headers: {
              "User-Agent":
                "GTV/3.0",

              Accept:
                "application/json",
            },

            redirect:
              "manual",

            cache:
              "no-store",

            signal:
              AbortSignal.timeout(
                12000
              ),
          }
        );

      playerApiTest = {
        ok: true,

        status:
          res.status,

        ms:
          Date.now() -
          playerStarted,

        contentType:
          res.headers.get(
            "content-type"
          ),
      };
    } catch (err: any) {
      playerApiTest = {
        ok: false,

        ms:
          Date.now() -
          playerStarted,

        error:
          safeError(err),
      };
    }

    /*
     * =========================
     * CHAÎNE LIVE
     * =========================
     */

    const redirectChain =
      await followRedirectChain(
        liveUrl
      );

    /*
     * =========================
     * RESPONSE SAFE
     * =========================
     */

    return Response.json(
      {
        ok: true,

        streamId:
          id,

        initialTarget,

        originTest,

        playerApiTest,

        redirectChain,

        security: {
          usernameExposed:
            false,

          passwordExposed:
            false,

          fullUrlExposed:
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
