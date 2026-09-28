import { requireSession } from "@/lib/session";
import { buildStreamUrl } from "@/lib/xtream/urls";
import dns from "node:dns/promises";
import net from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";

const HTTP_TIMEOUT = 12000;
const TCP_TIMEOUT = 8000;
const MAX_REDIRECTS = 5;

/* =========================================================
   SAFE ERROR
========================================================= */

function safeError(err: any) {
  return {
    message: err?.message || null,
    code: err?.code || null,
    causeCode: err?.cause?.code || null,
    causeMessage: err?.cause?.message || null,
  };
}

/* =========================================================
   SAFE TARGET
   Ne retourne JAMAIS le path / user / password
========================================================= */

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

/* =========================================================
   MASK IP
========================================================= */

function maskIp(address: string, family?: number) {
  if (family === 6 || address.includes(":")) {
    return "[IPv6]";
  }

  return address.replace(/\.\d+$/, ".xxx");
}

/* =========================================================
   DNS LOOKUP
========================================================= */

async function lookupHost(hostname: string) {
  try {
    const addresses = await dns.lookup(hostname, {
      all: true,
    });

    return addresses.map((item) => ({
      family: item.family,
      address: maskIp(item.address, item.family),
    }));
  } catch (err: any) {
    return {
      error: safeError(err),
    };
  }
}

/* =========================================================
   TCP TEST
========================================================= */

async function tcpTest(
  hostname: string,
  port: number,
  timeout = TCP_TIMEOUT
) {
  const started = Date.now();

  return new Promise<any>((resolve) => {
    const socket = net.createConnection({
      host: hostname,
      port,
    });

    let finished = false;

    const finish = (result: any) => {
      if (finished) return;

      finished = true;

      try {
        socket.destroy();
      } catch {
        // ignore
      }

      resolve({
        hostname,
        port,
        ms: Date.now() - started,
        ...result,
      });
    };

    socket.setTimeout(timeout);

    socket.once("connect", () => {
      finish({
        ok: true,
        result: "CONNECTED",
      });
    });

    socket.once("timeout", () => {
      finish({
        ok: false,
        result: "TIMEOUT",
      });
    });

    socket.once("error", (err: any) => {
      finish({
        ok: false,
        result: "ERROR",
        error: {
          code: err?.code || null,
          message: err?.message || null,
        },
      });
    });
  });
}

/* =========================================================
   PORT TESTS

   Pour chaque host rencontré :
   - port réellement demandé
   - 80
   - 443
   - 8080

   Pas de doublons.
========================================================= */

async function tcpPortTests(
  hostname: string,
  actualPort: number
) {
  const ports = Array.from(
    new Set([
      actualPort,
      80,
      443,
      8080,
    ])
  );

  const results = [];

  /*
   * Séquentiel volontairement.
   * On évite d'ouvrir plusieurs connexions simultanées
   * vers le fournisseur.
   */
  for (const port of ports) {
    results.push(
      await tcpTest(
        hostname,
        port
      )
    );
  }

  return results;
}

/* =========================================================
   ORIGIN TEST
========================================================= */

async function testOrigin(rawUrl: string) {
  const target = new URL(rawUrl);

  const started = Date.now();

  try {
    const res = await fetch(target.origin, {
      method: "GET",

      headers: {
        "User-Agent": UA,
        Accept: "*/*",
      },

      redirect: "manual",
      cache: "no-store",

      signal: AbortSignal.timeout(
        HTTP_TIMEOUT
      ),
    });

    return {
      ok: true,
      status: res.status,
      ms: Date.now() - started,
      contentType:
        res.headers.get("content-type"),
    };
  } catch (err: any) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: safeError(err),
    };
  }
}

/* =========================================================
   REDIRECT CHAIN
========================================================= */

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
    const target =
      safeTarget(currentUrl);

    if (!target) {
      steps.push({
        step: index + 1,
        ok: false,
        error: "Invalid URL",
      });

      break;
    }

    const port =
      Number(target.port);

    /* ==============================
       DNS
    ============================== */

    const dnsResult =
      await lookupHost(
        target.hostname
      );

    /* ==============================
       TCP DU PORT RÉEL

       Important :
       ici on teste seulement le port
       réellement utilisé par le flux.

       Les tests 80/443/8080 complets
       seront faits séparément sur le
       serveur qui échoue.
    ============================== */

    const actualTcp =
      await tcpTest(
        target.hostname,
        port
      );

    const started =
      Date.now();

    try {
      /* ==============================
         HTTP
      ============================== */

      const res =
        await fetch(
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
                HTTP_TIMEOUT
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

      const step: any = {
        step:
          index + 1,

        target,

        dns:
          dnsResult,

        tcp:
          actualTcp,

        http: {
          ok: true,

          status:
            res.status,

          ms:
            elapsed,

          contentType:
            res.headers.get(
              "content-type"
            ),

          contentLength:
            res.headers.get(
              "content-length"
            ),
        },

        redirect:
          Boolean(location),

        redirectTarget:
          null,
      };

      /* ==============================
         REDIRECT
      ============================== */

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

      /* ==============================
         FINAL RESPONSE
      ============================== */

      try {
        const body =
          await res.text();

        step.body = {
          bytes:
            Buffer.byteLength(
              body,
              "utf8"
            ),

          isM3U8:
            body.includes(
              "#EXTM3U"
            ),

          hasExtInf:
            body.includes(
              "#EXTINF"
            ),

          hasStreamInf:
            body.includes(
              "#EXT-X-STREAM-INF"
            ),
        };
      } catch (err: any) {
        step.body = {
          readError:
            safeError(err),
        };
      }

      steps.push(step);

      break;
    } catch (err: any) {
      /*
       * HTTP a échoué.
       *
       * C'est ici qu'on lance les tests
       * supplémentaires 80/443/8080.
       */

      const portTests =
        await tcpPortTests(
          target.hostname,
          port
        );

      steps.push({
        step:
          index + 1,

        target,

        dns:
          dnsResult,

        tcp:
          actualTcp,

        http: {
          ok: false,

          ms:
            Date.now() -
            started,

          error:
            safeError(err),
        },

        diagnosticPortTests:
          portTests,
      });

      break;
    }
  }

  return steps;
}

/* =========================================================
   ROUTE
========================================================= */

export async function GET(
  req: Request
) {
  let creds: any;

  /* =======================================================
     SESSION
  ======================================================= */

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
    /* =====================================================
       BUILD LIVE URL
    ===================================================== */

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

    /* =====================================================
       INITIAL DNS
    ===================================================== */

    const initialDns =
      await lookupHost(
        initialTarget.hostname
      );

    /* =====================================================
       INITIAL TCP
    ===================================================== */

    const initialTcp =
      await tcpTest(
        initialTarget.hostname,
        Number(
          initialTarget.port
        )
      );

    /* =====================================================
       ORIGIN
    ===================================================== */

    const originTest =
      await testOrigin(
        liveUrl
      );

    /* =====================================================
       PLAYER API
    ===================================================== */

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
            method: "GET",

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
                HTTP_TIMEOUT
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

    /* =====================================================
       REDIRECT CHAIN + TCP
    ===================================================== */

    const redirectChain =
      await followRedirectChain(
        liveUrl
      );

    /* =====================================================
       FIND FAILED HOST
    ===================================================== */

    const failedStep =
      redirectChain.find(
        (step: any) =>
          step?.http?.ok ===
          false
      );

    /* =====================================================
       RESPONSE
    ===================================================== */

    return Response.json(
      {
        ok: true,

        streamId:
          id,

        initialTarget,

        initialDns,

        initialTcp,

        originTest,

        playerApiTest,

        redirectChain,

        diagnosis:
          failedStep
            ? {
                failedAt:
                  failedStep.target,

                tcp:
                  failedStep.tcp,

                portTests:
                  failedStep
                    .diagnosticPortTests ||
                  null,
              }
            : {
                failedAt:
                  null,

                message:
                  "Redirect chain completed without connection failure",
              },

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
