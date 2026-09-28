
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

async function testFetch(
  name: string,
  url: string,
  timeout = 10000
) {
  const started = Date.now();

  try {
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

    return {
      name,
      ok: true,
      status: res.status,
      ms: Date.now() - started,

      contentType:
        res.headers.get("content-type"),

      location: res.headers.get("location")
        ? "[REDIRECT PRESENT]"
        : null,
    };
  } catch (err: any) {
    return {
      name,
      ok: false,
      ms: Date.now() - started,
      error: safeError(err),
    };
  }
}

export async function GET(req: Request) {
  let creds: any;

  try {
    creds = await requireSession();
  } catch {
    return Response.json(
      {
        ok: false,
        error: "Not authenticated",
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(req.url);

  const id = searchParams.get("id");

  if (!id) {
    return Response.json(
      {
        ok: false,
        error: "Missing stream id",
      },
      { status: 400 }
    );
  }

  try {
    /*
     * Construction exactement identique
     * à /api/hls.
     */
    const liveUrl = buildStreamUrl(
      creds,
      "live",
      id,
      "m3u8"
    );

    const live = new URL(liveUrl);

    /*
     * IMPORTANT :
     * aucune URL contenant user/pass
     * n'est renvoyée au navigateur.
     */
    const origin = live.origin;

    let dnsResult: any = null;

    try {
      const addresses =
        await dns.lookup(live.hostname, {
          all: true,
        });

      dnsResult = addresses.map((item) => ({
        family: item.family,
        /*
         * On masque volontairement
         * une partie de l'IP.
         */
        address:
          item.family === 4
            ? item.address.replace(
                /\.\d+$/,
                ".xxx"
              )
            : "[IPv6]",
      }));
    } catch (err: any) {
      dnsResult = {
        error: safeError(err),
      };
    }

    /*
     * Test 1 :
     * connexion à l'origine uniquement.
     */
    const originTest = await testFetch(
      "origin",
      origin,
      10000
    );

    /*
     * Test 2 :
     * player_api.php.
     *
     * Celui-ci contient les credentials
     * uniquement côté serveur.
     */
    const playerApi = new URL(
      "/player_api.php",
      origin
    );

    playerApi.searchParams.set(
      "username",
      String(creds.username)
    );

    playerApi.searchParams.set(
      "password",
      String(creds.password)
    );

    const apiTest = await testFetch(
      "player_api",
      playerApi.toString(),
      10000
    );

    /*
     * Test 3 :
     * véritable URL Live m3u8.
     */
    const liveTest = await testFetch(
      "live_m3u8",
      liveUrl,
      12000
    );

    return Response.json(
      {
        ok: true,

        target: {
          protocol: live.protocol,
          hostname: live.hostname,

          port:
            live.port ||
            (live.protocol === "https:"
              ? "443"
              : "80"),
        },

        dns: dnsResult,

        tests: [
          originTest,
          apiTest,
          liveTest,
        ],

        /*
         * Confirmation uniquement.
         * Jamais les valeurs.
         */
        credentials: {
          usernamePresent:
            Boolean(creds.username),

          passwordPresent:
            Boolean(creds.password),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err: any) {
    return Response.json(
      {
        ok: false,
        error: safeError(err),
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
