// app/api/stream-vod/route.ts

import {
  spawn,
} from "node:child_process";

import {
  requireSession,
} from "@/lib/session";

import {
  NextResponse,
} from "next/server";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

const UA =
  "VLC/3.0.20 LibVLC/3.0.20";

const FFMPEG =
  process.env
    .FFMPEG_PATH ||
  "ffmpeg";

const RAILWAY_URL =
  (
    process.env
      .RAILWAY_PUBLIC_URL ||
    "https://gtv-30-production.up.railway.app"
  ).replace(
    /\/+$/,
    ""
  );

const NO_CACHE_HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",

  Pragma:
    "no-cache",

  Expires:
    "0",

  "Access-Control-Allow-Origin":
    "*",

  "X-Accel-Buffering":
    "no",
};

/* =========================================================
   HELPERS
========================================================= */

function cleanHost(
  value: string
) {
  return String(
    value ||
      ""
  ).replace(
    /\/+$/,
    ""
  );
}

function safeKill(
  process: ReturnType<
    typeof spawn
  >
) {
  try {
    if (
      !process.killed
    ) {
      process.kill(
        "SIGKILL"
      );
    }
  } catch {}
}

async function checkUrl(
  url: string
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      3000
    );

  try {
    const response =
      await fetch(
        url,
        {
          method:
            "HEAD",

          headers: {
            "User-Agent":
              UA,

            Accept:
              "*/*",
          },

          redirect:
            "follow",

          signal:
            controller.signal,
        }
      );

    return (
      response.ok ||
      response.status ===
        206 ||
      response.status ===
        301 ||
      response.status ===
        302
    );
  } catch {
    return false;
  } finally {
    clearTimeout(
      timer
    );
  }
}

/* =========================================================
   INPUT URL
========================================================= */

async function resolveInputUrl({
  host,
  username,
  password,
  type,
  id,
  ext,
}: {
  host: string;
  username: string;
  password: string;
  type: string;
  id: string;
  ext: string;
}) {
  const clean =
    cleanHost(
      host
    );

  const folder =
    type ===
    "series"
      ? "series"
      : "movie";

  const build = (
    extension: string
  ) =>
    `${clean}/${folder}/${encodeURIComponent(
      username
    )}/${encodeURIComponent(
      password
    )}/${encodeURIComponent(
      id
    )}.${extension}`;

  const primary =
    build(
      ext
    );

  /*
    On teste d'abord l'extension connue.
  */

  const primaryOk =
    await checkUrl(
      primary
    );

  if (
    primaryOk
  ) {
    return primary;
  }

  const fallbackExtensions =
    [
      "mkv",
      "mp4",
      "ts",
      "avi",
    ].filter(
      (
        extension
      ) =>
        extension !==
        ext
    );

  for (
    const extension of
    fallbackExtensions
  ) {
    const candidate =
      build(
        extension
      );

    const ok =
      await checkUrl(
        candidate
      );

    if (ok) {
      return candidate;
    }
  }

  /*
    Certains hosts refusent HEAD
    mais acceptent FFmpeg GET.

    On laisse donc quand même FFmpeg
    tenter l'URL principale.
  */

  return primary;
}

/* =========================================================
   GET
========================================================= */

export async function GET(
  req: Request
) {
  try {
    const url =
      new URL(
        req.url
      );

    const {
      searchParams,
    } =
      url;

    const rawType =
      searchParams.get(
        "type"
      ) ||
      "movie";

    const type =
      rawType ===
      "series"
        ? "series"
        : "movie";

    const id =
      searchParams.get(
        "id"
      );

    const originalExt =
      (
        searchParams.get(
          "ext"
        ) ||
        "mkv"
      )
        .toLowerCase()
        .replace(
          /[^a-z0-9]/g,
          ""
        ) ||
      "mkv";

    const rawSeek =
      Number(
        searchParams.get(
          "t"
        ) ||
          0
      );

    const t =
      Number.isFinite(
        rawSeek
      )
        ? Math.max(
            0,
            Math.floor(
              rawSeek
            )
          )
        : 0;

    if (!id) {
      return new Response(
        "ID manquant",
        {
          status:
            400,

          headers:
            NO_CACHE_HEADERS,
        }
      );
    }

    /* =====================================================
       CREDENTIALS DIRECTES RAILWAY
    ===================================================== */

    const directHost =
      searchParams.get(
        "_h"
      );

    const directUser =
      searchParams.get(
        "_u"
      );

    const directPass =
      searchParams.get(
        "_p"
      );

    let rawHost =
      "";

    let username =
      "";

    let password =
      "";

    /* =====================================================
       VERCEL -> RAILWAY
    ===================================================== */

    if (
      !directHost ||
      !directUser ||
      !directPass
    ) {
      let sessionData:
        any;

      try {
        sessionData =
          await requireSession();
      } catch {
        return new Response(
          "Non autorisé",
          {
            status:
              401,

            headers:
              NO_CACHE_HEADERS,
          }
        );
      }

      const creds =
        sessionData?.user ||
        sessionData;

      rawHost =
        creds?.baseUrl ||
        creds?.url ||
        creds?.serverUrl ||
        creds?.server ||
        creds?.host ||
        "";

      username =
        creds?.username ||
        creds?.user ||
        "";

      password =
        creds?.password ||
        creds?.pass ||
        "";

      if (
        !rawHost ||
        !username ||
        !password
      ) {
        return new Response(
          "Identifiants Xtream incomplets",
          {
            status:
              400,

            headers:
              NO_CACHE_HEADERS,
          }
        );
      }

      const railwayUrl =
        new URL(
          "/api/stream-vod",
          RAILWAY_URL
        );

      railwayUrl.searchParams.set(
        "type",
        type
      );

      railwayUrl.searchParams.set(
        "id",
        id
      );

      railwayUrl.searchParams.set(
        "ext",
        originalExt
      );

      if (
        t > 0
      ) {
        railwayUrl.searchParams.set(
          "t",
          String(
            t
          )
        );
      }

      railwayUrl.searchParams.set(
        "_h",
        rawHost
      );

      railwayUrl.searchParams.set(
        "_u",
        username
      );

      railwayUrl.searchParams.set(
        "_p",
        password
      );

      return NextResponse.redirect(
        railwayUrl,
        {
          status:
            302,

          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    /* =====================================================
       RAILWAY
    ===================================================== */

    rawHost =
      cleanHost(
        decodeURIComponent(
          directHost
        )
      );

    username =
      decodeURIComponent(
        directUser
      );

    password =
      decodeURIComponent(
        directPass
      );

    if (
      !rawHost ||
      !username ||
      !password
    ) {
      return new Response(
        "Paramètres Railway incomplets",
        {
          status:
            400,

          headers:
            NO_CACHE_HEADERS,
        }
      );
    }

    /* =====================================================
       FIND INPUT
    ===================================================== */

    const inputUrl =
      await resolveInputUrl({
        host:
          rawHost,

        username,

        password,

        type,

        id,

        ext:
          originalExt,
      });

    /* =====================================================
       FFMPEG

       VIDEO :
       COPY uniquement.

       AUDIO :
       AAC stéréo.

       AUDIO ASYNC :
       corrige trous / petites dérives
       de timestamps AC3 / EAC3 / DTS.

       SEEK :
       -ss AVANT -i.
    ===================================================== */

    const args = [
      "-hide_banner",

      "-loglevel",
      "error",

      "-nostdin",

      "-user_agent",
      UA,

      /*
        Génère des timestamps si la source MKV
        en a de mauvais ou certains manquent.
      */
      "-fflags",
      "+genpts",

      /*
        Réduit les blocages réseau
        sur certaines sources.
      */
      "-rw_timeout",
      "15000000",

      /*
        Seek serveur rapide.
      */
      ...(t >
      0
        ? [
            "-ss",
            String(
              t
            ),
          ]
        : []),

      "-i",
      inputUrl,

      /*
        Première vidéo.
      */
      "-map",
      "0:v:0",

      /*
        Première piste audio si disponible.
      */
      "-map",
      "0:a:0?",

      /*
        VIDEO = ZERO TRANSCODAGE.
      */
      "-c:v",
      "copy",

      /*
        AUDIO -> AAC.
      */
      "-c:a",
      "aac",

      /*
        Correction de dérive / microcoupures audio.
      */
      "-af",
      "aresample=async=1000:min_hard_comp=0.100:first_pts=0",

      /*
        Stéréo universelle navigateur.
      */
      "-ac",
      "2",

      /*
        Bon compromis qualité / CPU / réseau.
      */
      "-b:a",
      "160k",

      /*
        Évite timestamps négatifs
        après input seek.
      */
      "-avoid_negative_ts",
      "make_zero",

      /*
        Laisse le muxeur attendre suffisamment
        audio + vidéo sans créer de trous.
      */
      "-max_interleave_delta",
      "0",

      /*
        MP4 fragmenté lisible immédiatement.
      */
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",

      /*
        Sortie streaming.
      */
      "-f",
      "mp4",

      "pipe:1",
    ];

    console.log(
      `[GTV STREAM-VOD] ${type} id=${id} ext=${originalExt} seek=${t}s`
    );

    const ff =
      spawn(
        /* turbopackIgnore: true */
        FFMPEG,
        args,
        {
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
        }
      );

    let stderr =
      "";

    let streamClosed =
      false;

    ff.stderr.on(
      "data",
      (
        chunk
      ) => {
        stderr +=
          chunk.toString();

        if (
          stderr.length >
          12000
        ) {
          stderr =
            stderr.slice(
              -12000
            );
        }
      }
    );

    ff.on(
      "close",
      (
        code,
        signal
      ) => {
        if (
          code !==
            0 &&
          code !==
            null &&
          signal !==
            "SIGKILL"
        ) {
          console.error(
            `[GTV FFMPEG] close code=${code} signal=${signal}`,
            stderr
          );
        }
      }
    );

    ff.on(
      "error",
      (
        error
      ) => {
        console.error(
          "[GTV FFMPEG] spawn error",
          error
        );
      }
    );

    /* =====================================================
       STREAM AVEC BACKPRESSURE

       Important pour éviter :
       - RAM qui monte
       - pipe qui sature
       - à-coups inutiles
    ===================================================== */

    const stream =
      new ReadableStream<
        Uint8Array
      >({
        start(
          controller
        ) {
          ff.stdout.on(
            "data",
            (
              chunk:
                Buffer
            ) => {
              if (
                streamClosed
              ) {
                return;
              }

              try {
                controller.enqueue(
                  new Uint8Array(
                    chunk
                  )
                );

                /*
                  Si le navigateur ne consomme
                  plus assez vite, on pause stdout.

                  pull() le relancera.
                */
                if (
                  controller.desiredSize !==
                    null &&
                  controller.desiredSize <=
                    0
                ) {
                  ff.stdout.pause();
                }
              } catch {
                streamClosed =
                  true;

                safeKill(
                  ff
                );
              }
            }
          );

          ff.stdout.on(
            "end",
            () => {
              if (
                streamClosed
              ) {
                return;
              }

              streamClosed =
                true;

              try {
                controller.close();
              } catch {}
            }
          );

          ff.stdout.on(
            "error",
            (
              error
            ) => {
              if (
                streamClosed
              ) {
                return;
              }

              streamClosed =
                true;

              try {
                controller.error(
                  error
                );
              } catch {}

              safeKill(
                ff
              );
            }
          );

          ff.on(
            "error",
            (
              error
            ) => {
              if (
                streamClosed
              ) {
                return;
              }

              streamClosed =
                true;

              try {
                controller.error(
                  error
                );
              } catch {}
            }
          );
        },

        pull() {
          try {
            if (
              ff.stdout
                .isPaused()
            ) {
              ff.stdout.resume();
            }
          } catch {}
        },

        cancel() {
          streamClosed =
            true;

          safeKill(
            ff
          );
        },
      });

    /* =====================================================
       CLIENT ABORT
    ===================================================== */

    const abortHandler =
      () => {
        streamClosed =
          true;

        safeKill(
          ff
        );
      };

    if (
      req.signal
        .aborted
    ) {
      abortHandler();
    } else {
      req.signal.addEventListener(
        "abort",
        abortHandler,
        {
          once:
            true,
        }
      );
    }

    /* =====================================================
       RESPONSE
    ===================================================== */

    return new Response(
      stream,
      {
        status:
          200,

        headers: {
          ...NO_CACHE_HEADERS,

          "Content-Type":
            "video/mp4",

          "Content-Disposition":
            "inline",

          "Accept-Ranges":
            "none",

          "X-GTV-Mode":
            "video-copy-audio-aac",

          "X-GTV-Seek":
            String(
              t
            ),
        },
      }
    );
  } catch (
    error:
      any
  ) {
    console.error(
      "[GTV STREAM-VOD]",
      error
    );

    return new Response(
      `Erreur VOD: ${
        error?.message ||
        "unknown"
      }`,
      {
        status:
          500,

        headers:
          NO_CACHE_HEADERS,
      }
    );
  }
}