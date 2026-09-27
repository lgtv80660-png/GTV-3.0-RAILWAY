import { spawn } from "node:child_process";
import { requireSession } from "@/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "VLC/3.0.20 LibVLC/3.0.20";

const FFMPEG =
  process.env.FFMPEG_PATH ||
  "ffmpeg";

const RAILWAY_URL =
  (
    process.env.RAILWAY_PUBLIC_URL ||
    ""
  ).replace(/\/+$/, "");

const HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate",

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
    value || ""
  ).replace(
    /\/+$/,
    ""
  );
}

function killProcess(
  ff: ReturnType<typeof spawn>
) {
  try {
    if (!ff.killed) {
      ff.kill("SIGKILL");
    }
  } catch {}
}

/* =========================================================
   ROUTE
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
    } = url;

    /* =====================================================
       PARAMS
    ===================================================== */

    const type =
      searchParams.get(
        "type"
      ) === "series"
        ? "series"
        : "movie";

    const id =
      searchParams.get(
        "id"
      );

    const ext =
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

    const seek =
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
          status: 400,
          headers: HEADERS,
        }
      );
    }

    /* =====================================================
       DIRECT RAILWAY PARAMS
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

    let host =
      "";

    let username =
      "";

    let password =
      "";

    /* =====================================================
       PREMIER APPEL
       Cloudflare / frontend
       -> Railway direct
    ===================================================== */

    if (
      !directHost ||
      !directUser ||
      !directPass
    ) {
      let session:
        any;

      try {
        session =
          await requireSession();
      } catch {
        return new Response(
          "Non autorisé",
          {
            status:
              401,

            headers:
              HEADERS,
          }
        );
      }

      host =
        session?.baseUrl ||
        session?.url ||
        session?.serverUrl ||
        session?.host ||
        "";

      username =
        session?.username ||
        session?.user ||
        "";

      password =
        session?.password ||
        session?.pass ||
        "";

      if (
        !host ||
        !username ||
        !password
      ) {
        return new Response(
          "Identifiants Xtream incomplets",
          {
            status:
              400,

            headers:
              HEADERS,
          }
        );
      }

      host =
        cleanHost(
          host
        );

      if (!RAILWAY_URL) {
        return new Response(
          "RAILWAY_PUBLIC_URL manquante",
          {
            status:
              500,

            headers:
              HEADERS,
          }
        );
      }

      const target =
        new URL(
          "/api/stream-vod",
          RAILWAY_URL
        );

      target.searchParams.set(
        "type",
        type
      );

      target.searchParams.set(
        "id",
        id
      );

      target.searchParams.set(
        "ext",
        ext
      );

      if (
        seek >
        0
      ) {
        target.searchParams.set(
          "t",
          String(
            seek
          )
        );
      }

      /*
       * URLSearchParams encode
       * automatiquement.
       */
      target.searchParams.set(
        "_h",
        host
      );

      target.searchParams.set(
        "_u",
        username
      );

      target.searchParams.set(
        "_p",
        password
      );

      console.log(
        `[VOD REDIRECT] ${type} id=${id} seek=${seek}`
      );

      return NextResponse.redirect(
        target,
        302
      );
    }

    /* =====================================================
       SECOND APPEL
       Browser -> Railway direct
    ===================================================== */

    /*
     * IMPORTANT :
     *
     * searchParams.get() a déjà
     * décodé les paramètres URL.
     *
     * Donc PAS de decodeURIComponent()
     * ici.
     */

    host =
      cleanHost(
        directHost
      );

    username =
      directUser;

    password =
      directPass;

    if (
      !host ||
      !username ||
      !password
    ) {
      return new Response(
        "Paramètres Railway incomplets",
        {
          status:
            400,

          headers:
            HEADERS,
        }
      );
    }

    /* =====================================================
       XTREAM INPUT URL
    ===================================================== */

    const folder =
      type ===
      "series"
        ? "series"
        : "movie";

    const inputUrl =
      `${host}/${folder}/` +
      `${encodeURIComponent(
        username
      )}/` +
      `${encodeURIComponent(
        password
      )}/` +
      `${encodeURIComponent(
        id
      )}.${ext}`;

    /* =====================================================
       FFMPEG
    ===================================================== */

    const args = [
      "-hide_banner",

      /*
       * Pendant debug :
       * warning donne plus d'informations
       * que error.
       */
      "-loglevel",
      "warning",

      "-nostdin",

      /* ===============================================
         HTTP / XTREAM
      =============================================== */

      "-user_agent",
      UA,

      /*
       * 60 secondes.
       *
       * L'ancienne valeur 10000000
       * = seulement 10 secondes.
       */
      "-rw_timeout",
      "60000000",

      /*
       * Reconnexion HTTP automatique.
       */
      "-reconnect",
      "1",

      "-reconnect_streamed",
      "1",

      "-reconnect_at_eof",
      "1",

      "-reconnect_delay_max",
      "10",

      /* ===============================================
         INPUT
      =============================================== */

      "-fflags",
      "+genpts+discardcorrupt",

      /*
       * Un peu plus généreux afin
       * d'éviter les flux mal détectés.
       */
      "-analyzeduration",
      "5000000",

      "-probesize",
      "5000000",

      /*
       * SEEK
       */
      ...(seek > 0
        ? [
            "-ss",
            String(
              seek
            ),
          ]
        : []),

      "-i",
      inputUrl,

      /* ===============================================
         STREAM MAP
      =============================================== */

      "-map",
      "0:v:0?",

      "-map",
      "0:a:0?",

      /* ===============================================
         VIDEO
      =============================================== */

      /*
       * Pas de réencodage vidéo :
       * beaucoup moins de CPU Railway.
       */
      "-c:v",
      "copy",

      /* ===============================================
         AUDIO
      =============================================== */

      "-c:a",
      "aac",

      "-ac",
      "2",

      "-b:a",
      "128k",

      "-af",
      "aresample=async=1:first_pts=0",

      /* ===============================================
         TIMESTAMPS
      =============================================== */

      "-avoid_negative_ts",
      "make_zero",

      /* ===============================================
         MP4 STREAMING
      =============================================== */

      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof+omit_tfhd_offset",

      /*
       * Nouveau fragment environ
       * toutes les 2 secondes.
       */
      "-frag_duration",
      "2000000",

      /*
       * Envoie les paquets immédiatement
       * au navigateur.
       */
      "-flush_packets",
      "1",

      "-f",
      "mp4",

      "pipe:1",
    ];

    console.log(
      `[VOD START] type=${type} id=${id} ext=${ext} seek=${seek}`
    );

    /* =====================================================
       SPAWN
    ===================================================== */

    const ff =
      spawn(
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

    /* =====================================================
       STDERR
    ===================================================== */

    ff.stderr.on(
      "data",
      (
        chunk
      ) => {
        const message =
          chunk.toString();

        stderr +=
          message;

        /*
         * Évite que Railway stocke
         * des Mo de logs en mémoire.
         */
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

    /* =====================================================
       PROCESS ERROR
    ===================================================== */

    ff.on(
      "error",
      (
        error
      ) => {
        console.error(
          `[VOD FFMPEG SPAWN ERROR] type=${type} id=${id}`,
          error
        );
      }
    );

    /* =====================================================
       PROCESS CLOSE
    ===================================================== */

    ff.on(
      "close",
      (
        code,
        signal
      ) => {
        console.log(
          `[VOD FFMPEG CLOSED] type=${type} id=${id} code=${code} signal=${signal}`
        );

        if (
          stderr.trim()
        ) {
          console.log(
            `[VOD FFMPEG STDERR] type=${type} id=${id}\n${stderr}`
          );
        }
      }
    );

    /* =====================================================
       RESPONSE STREAM
    ===================================================== */

    const stream =
      new ReadableStream<
        Uint8Array
      >({
        start(
          controller
        ) {
          /*
           * FFmpeg -> Browser
           */
          ff.stdout.on(
            "data",
            (
              chunk:
                Buffer
            ) => {
              try {
                controller.enqueue(
                  new Uint8Array(
                    chunk
                  )
                );
              } catch {
                killProcess(
                  ff
                );
              }
            }
          );

          /*
           * Fin normale du stdout.
           */
          ff.stdout.on(
            "end",
            () => {
              try {
                controller.close();
              } catch {}
            }
          );

          /*
           * Erreur stdout.
           */
          ff.stdout.on(
            "error",
            (
              error
            ) => {
              console.error(
                `[VOD STDOUT ERROR] type=${type} id=${id}`,
                error
              );

              try {
                controller.error(
                  error
                );
              } catch {}

              killProcess(
                ff
              );
            }
          );
        },

        /*
         * Le navigateur a réellement
         * abandonné le body.
         */
        cancel(
          reason
        ) {
          console.log(
            `[VOD STREAM CANCEL] type=${type} id=${id}`,
            reason || ""
          );

          killProcess(
            ff
          );
        },
      });

    /*
     * IMPORTANT :
     *
     * Pour le moment on NE tue PAS
     * FFmpeg avec req.signal.
     *
     * Sur certaines configurations
     * Next/Railway le Request.signal
     * peut être déclenché alors que le
     * body vidéo est encore utilisé.
     *
     * Le cancel() du ReadableStream
     * reste responsable de fermer FFmpeg
     * quand le navigateur abandonne
     * réellement le flux.
     */

    /* =====================================================
       RESPONSE
    ===================================================== */

    return new Response(
      stream,
      {
        status:
          200,

        headers: {
          ...HEADERS,

          "Content-Type":
            "video/mp4",

          "Content-Disposition":
            "inline",

          /*
           * Ce flux est généré à la volée.
           * Les seeks passent par ?t=
           * et redémarrent FFmpeg.
           */
          "Accept-Ranges":
            "none",

          "X-GTV-Mode":
            "stable-remux",

          "X-GTV-Seek":
            String(
              seek
            ),
        },
      }
    );
  } catch (
    error:
      any
  ) {
    console.error(
      "[STREAM-VOD]",
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
          HEADERS,
      }
    );
  }
}
