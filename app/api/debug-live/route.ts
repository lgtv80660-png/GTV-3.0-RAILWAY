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
   Jamais de path / username / password
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

function maskIp(
  address: string,
  family?: number
) {
  if (
    family === 6 ||
    address.includes(":")
  ) {
    return "[IPv6]";
  }

  return address.replace(
    /\.\d+$/,
    ".xxx"
  );
}

/* =========================================================
   DNS LOOKUP
========================================================= */

async function lookupHost(
  hostname: string
) {
  try {
    const addresses =
      await dns.lookup(
        hostname,
        {
          all: true,
        }
      );

    return addresses.map(
      (item) => ({
        family:
          item.family,

        address:
          maskIp(
            item.address,
            item.family
          ),
      })
    );
  } catch (err: any) {
    return {
      error:
        safeError(err),
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
  const started =
    Date.now();

  return new Promise<any>(
    (resolve) => {
      const socket =
        net.createConnection({
          host: hostname,
          port,
        });

      let finished =
        false;

      const finish = (
        result: any
      ) => {
        if (finished) {
          return;
        }

        finished = true;

        try {
          socket.destroy();
        } catch {
          // ignore
        }

        resolve({
          hostname,
          port,

          ms:
            Date.now() -
            started,

          ...result,
        });
      };

      socket.setTimeout(
        timeout
      );

      socket.once(
        "connect",
        () => {
          finish({
            ok: true,
            result:
              "CONNECTED",
          });
        }
      );

      socket.once(
        "timeout",
        () => {
          finish({
            ok: false,
            result:
              "TIMEOUT",
          });
        }
      );

      socket.once(
        "error",
        (err: any) => {
          finish({
            ok: false,
            result:
              "ERROR",

            error: {
              code:
                err?.code ||
                null,

              message:
                err?.message ||
                null,
            },
          });
        }
      );
    }
  );
}

/* =========================================================
   TEST PORTS

   Teste :
   - port réellement demandé
   - 80
   - 443
   - 8080
========================================================= */

async function tcpPortTests(
  hostname: string,
  actualPort: number
) {
  const ports =
    Array.from(
      new Set([
        actualPort,
        80,
        443,
        8080,
      ])
    );

  const results: any[] =
    [];

  /*
   * Séquentiel volontairement.
   * On évite plusieurs connexions
   * simultanées au fournisseur.
   */
  for (const port of ports) {
    const result =
      await tcpTest(
        hostname,
        port
      );

    results.push(
      result
    );
  }

  return results;
}

/* =========================================================
   ORIGIN TEST
========================================================= */

async function testOrigin(
  rawUrl: string
) {
  const target =
    new URL(rawUrl);

  const started =
    Date.now();

  try {
    const res =
      await fetch(
        target.origin,
        {
          method:
            "GET",

          headers: {
            "User-Agent":
              UA,

            Accept:
              "*/*",
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

    return {
      ok:
        res.ok,

      status:
        res.status,

      ms:
        Date.now() -
        started,

      contentType:
        res.headers.get(
          "content-type"
        ),

      server:
        res.headers.get(
          "server"
        ),
    };
  } catch (err: any) {
    return {
      ok: false,

      ms:
        Date.now() -
        started,

      error:
        safeError(err),
    };
  }
}

/* =========================================================
   PLAYER API TEST
========================================================= */

async function testPlayerApi(
  liveUrl: string,
  creds: any
) {
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

  const started =
    Date.now();

  try {
    const res =
      await fetch(
        playerApi.toString(),
        {
          method:
            "GET",

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

    return {
      ok:
        res.ok,

      status:
        res.status,

      ms:
        Date.now() -
        started,

      contentType:
        res.headers.get(
          "content-type"
        ),

      server:
        res.headers.get(
          "server"
        ),
    };
  } catch (err: any) {
    return {
      ok: false,

      ms:
        Date.now() -
        started,

      error:
        safeError(err),
    };
  }
}

/* =========================================================
   REDIRECT CHAIN
========================================================= */

async function followRedirectChain(
  initialUrl: string
) {
  const steps: any[] =
    [];

  let currentUrl =
    initialUrl;

  for (
    let index = 0;
    index <= MAX_REDIRECTS;
    index++
  ) {
    /* =====================================================
       TARGET
    ===================================================== */

    const target =
      safeTarget(
        currentUrl
      );

    if (!target) {
      steps.push({
        step:
          index + 1,

        ok:
          false,

        classification:
          "INVALID_URL",

        error:
          "Invalid URL",
      });

      break;
    }

    const port =
      Number(
        target.port
      );

    /* =====================================================
       DNS
    ===================================================== */

    const dnsResult =
      await lookupHost(
        target.hostname
      );

    /* =====================================================
       TCP PORT RÉEL
    ===================================================== */

    const actualTcp =
      await tcpTest(
        target.hostname,
        port
      );

    /* =====================================================
       HTTP FETCH
    ===================================================== */

    const started =
      Date.now();

    try {
      const res =
        await fetch(
          currentUrl,
          {
            method:
              "GET",

            headers: {
              "User-Agent":
                UA,

              Accept:
                "application/vnd.apple.mpegurl, application/x-mpegURL, */*",

              Connection:
                "keep-alive",
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

      const server =
        res.headers.get(
          "server"
        );

      const retryAfter =
        res.headers.get(
          "retry-after"
        );

      const via =
        res.headers.get(
          "via"
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
          ok:
            res.ok,

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

          headers: {
            server:
              server ||
              null,

            retryAfter:
              retryAfter ||
              null,

            via:
              via ||
              null,
          },
        },

        redirect:
          Boolean(
            location
          ),

        redirectTarget:
          null,
      };

      /* ===================================================
         REDIRECT 3XX
      =================================================== */

      if (
        location &&
        res.status >= 300 &&
        res.status < 400
      ) {
        try {
          const nextUrl =
            new URL(
              location,
              currentUrl
            ).toString();

          step.classification =
            "REDIRECT";

          step.redirectTarget =
            safeTarget(
              nextUrl
            );

          steps.push(
            step
          );

          /*
           * L'URL complète reste
           * uniquement côté serveur.
           */
          currentUrl =
            nextUrl;

          continue;
        } catch {
          step.classification =
            "INVALID_REDIRECT";

          step.redirectError =
            "Invalid redirect URL";

          steps.push(
            step
          );

          break;
        }
      }

      /* ===================================================
         HTTP ERROR 4XX / 5XX

         Exemple :
         asmr4k.pro → 503
      =================================================== */

      if (!res.ok) {
        let bodyInfo:
          any = null;

        try {
          const body =
            await res.text();

          bodyInfo = {
            bytes:
              Buffer.byteLength(
                body,
                "utf8"
              ),

            isM3U8:
              body.includes(
                "#EXTM3U"
              ),

            /*
             * Le contenu réel
             * n'est jamais retourné.
             */
            bodyExposed:
              false,
          };
        } catch (
          err: any
        ) {
          bodyInfo = {
            readError:
              safeError(
                err
              ),
          };
        }

        step.classification =
          "UPSTREAM_HTTP_ERROR";

        step.body =
          bodyInfo;

        steps.push(
          step
        );

        break;
      }

      /* ===================================================
         HTTP 2XX
      =================================================== */

      let bodyInfo:
        any = null;

      try {
        const body =
          await res.text();

        bodyInfo = {
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
      } catch (
        err: any
      ) {
        bodyInfo = {
          readError:
            safeError(
              err
            ),
        };
      }

      step.body =
        bodyInfo;

      if (
        bodyInfo?.isM3U8
      ) {
        step.classification =
          "HLS_PLAYLIST_OK";
      } else {
        step.classification =
          "HTTP_OK_NOT_HLS";
      }

      steps.push(
        step
      );

      break;
    } catch (
      err: any
    ) {
      /* ===================================================
         FETCH FAILURE

         Exemple :
         217.60.253.48:8080
         UND_ERR_CONNECT_TIMEOUT
      =================================================== */

      const causeCode =
        err?.cause?.code ||
        err?.code ||
        null;

      /*
       * Seulement maintenant on teste
       * les ports alternatifs.
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

        classification:
          causeCode ===
          "UND_ERR_CONNECT_TIMEOUT"
            ? "UPSTREAM_CONNECT_TIMEOUT"
            : "UPSTREAM_FETCH_ERROR",

        http: {
          ok:
            false,

          ms:
            Date.now() -
            started,

          error:
            safeError(
              err
            ),
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
   MAIN ROUTE
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
        ok:
          false,

        error:
          "Not authenticated",
      },
      {
        status:
          401,

        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }

  /* =======================================================
     STREAM ID
  ======================================================= */

  const {
    searchParams,
  } =
    new URL(
      req.url
    );

  const id =
    searchParams.get(
      "id"
    );

  if (!id) {
    return Response.json(
      {
        ok:
          false,

        error:
          "Missing stream id",
      },
      {
        status:
          400,

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

    if (
      !initialTarget
    ) {
      return Response.json(
        {
          ok:
            false,

          error:
            "Invalid Live URL",
        },
        {
          status:
            500,

          headers: {
            "Cache-Control":
              "no-store",
          },
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
       ORIGIN TEST
    ===================================================== */

    const originTest =
      await testOrigin(
        liveUrl
      );

    /* =====================================================
       PLAYER API TEST
    ===================================================== */

    const playerApiTest =
      await testPlayerApi(
        liveUrl,
        creds
      );

    /* =====================================================
       FOLLOW LIVE CHAIN
    ===================================================== */

    const redirectChain =
      await followRedirectChain(
        liveUrl
      );

    /* =====================================================
       FIND FAILURE
    ===================================================== */

    const failedStep =
      redirectChain.find(
        (step: any) =>
          step?.classification ===
            "UPSTREAM_HTTP_ERROR" ||

          step?.classification ===
            "UPSTREAM_CONNECT_TIMEOUT" ||

          step?.classification ===
            "UPSTREAM_FETCH_ERROR" ||

          step?.classification ===
            "INVALID_REDIRECT" ||

          step?.classification ===
            "INVALID_URL"
      );

    /* =====================================================
       HLS SUCCESS
    ===================================================== */

    const hlsStep =
      redirectChain.find(
        (step: any) =>
          step?.classification ===
          "HLS_PLAYLIST_OK"
      );

    /* =====================================================
       DIAGNOSIS
    ===================================================== */

    let diagnosis:
      any;

    if (failedStep) {
      diagnosis = {
        classification:
          failedStep.classification,

        failedAt:
          failedStep.target ||
          null,

        httpStatus:
          failedStep
            ?.http
            ?.status ??
          null,

        tcp:
          failedStep.tcp ??
          null,

        portTests:
          failedStep
            .diagnosticPortTests ??
          null,
      };
    } else if (hlsStep) {
      diagnosis = {
        classification:
          "HLS_PLAYLIST_OK",

        failedAt:
          null,

        finalTarget:
          hlsStep.target,

        httpStatus:
          hlsStep
            ?.http
            ?.status ??
          200,

        message:
          "Valid HLS playlist received",
      };
    } else {
      diagnosis = {
        classification:
          "NO_NETWORK_FAILURE",

        failedAt:
          null,

        message:
          "Redirect chain completed without a classified network failure",
      };
    }

    /* =====================================================
       SAFE RESPONSE
    ===================================================== */

    return Response.json(
      {
        ok:
          true,

        streamId:
          id,

        initialTarget,

        initialDns,

        initialTcp,

        originTest,

        playerApiTest,

        redirectChain,

        diagnosis,

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
        status:
          200,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate",

          "Content-Type":
            "application/json; charset=utf-8",
        },
      }
    );
  } catch (
    err: any
  ) {
    return Response.json(
      {
        ok:
          false,

        error:
          safeError(
            err
          ),
      },
      {
        status:
          500,

        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }
}
