import {
  spawn,
} from "node:child_process";

import {
  mkdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";

import path from "node:path";
import crypto from "node:crypto";

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

/* =========================================================
   CONFIG
========================================================= */

const UA =
  "VLC/3.0.20 LibVLC/3.0.20";

const FFMPEG =
  process.env
    .FFMPEG_PATH ||
  "ffmpeg";

const RAILWAY_URL = (
  process.env
    .RAILWAY_PUBLIC_URL ||
  ""
).replace(
  /\/+$/,
  ""
);

const ROOT =
  "/tmp/gtv-vod-hls";

const START_TIMEOUT =
  45_000;

/*
 * SAFARI / HLS
 *
 * La playlist doit toujours être relue.
 * Safari recharge index.m3u8 pendant la lecture
 * pour découvrir les nouveaux segments.
 *
 * Aucun cache sur le manifeste.
 */
const HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate, proxy-revalidate",

  Pragma:
    "no-cache",

  Expires:
    "0",

  "Access-Control-Allow-Origin":
    "*",

  "Access-Control-Allow-Headers":
    "Range, Content-Type, Accept",

  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges",

  "X-Content-Type-Options":
    "nosniff",
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

function safe(
  value: string
) {
  return value.replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  );
}

function validSessionId(
  value: string
) {
  return /^[a-zA-Z0-9_-]{20,80}$/.test(
    value
  );
}

async function exists(
  file: string
) {
  try {
    await stat(
      file
    );

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   PLAYLIST VALIDATION
========================================================= */

function playlistIsReady(
  content: string
) {
  if (
    !content.includes(
      "#EXTM3U"
    )
  ) {
    return false;
  }

  if (
    !content.includes(
      "#EXTINF"
    )
  ) {
    return false;
  }

  if (
    !/seg-\d+\.ts/i.test(
      content
    )
  ) {
    return false;
  }

  return true;
}

/* =========================================================
   WAIT PLAYLIST
========================================================= */

async function waitForPlaylist(
  playlist: string,
  timeout = START_TIMEOUT
) {
  const started =
    Date.now();

  while (
    Date.now() -
      started <
    timeout
  ) {
    if (
      await exists(
        playlist
      )
    ) {
      try {
        const content =
          await readFile(
            playlist,
            "utf8"
          );

        if (
          playlistIsReady(
            content
          )
        ) {
          return content;
        }
      } catch {}
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          100
        )
    );
  }

  throw new Error(
    "Timeout génération playlist HLS"
  );
}

/* =========================================================
   WAIT FFMPEG STARTUP
========================================================= */

async function waitForHlsStartup(
  playlist: string,

  ff: ReturnType<
    typeof spawn
  >,

  getStderr:
    () => string,

  timeout =
    START_TIMEOUT
) {
  return new Promise<string>(
    (
      resolve,
      reject
    ) => {
      let finished =
        false;

      const started =
        Date.now();

      const finish = (
        callback:
          () => void
      ) => {
        if (
          finished
        ) {
          return;
        }

        finished =
          true;

        clearInterval(
          timer
        );

        callback();
      };

      const timer =
        setInterval(
          async () => {
            if (
              finished
            ) {
              return;
            }

            if (
              Date.now() -
                started >=
              timeout
            ) {
              finish(
                () =>
                  reject(
                    new Error(
                      "Timeout génération playlist HLS"
                    )
                  )
              );

              return;
            }

            if (
              !(
                await exists(
                  playlist
                )
              )
            ) {
              return;
            }

            try {
              const content =
                await readFile(
                  playlist,
                  "utf8"
                );

              if (
                playlistIsReady(
                  content
                )
              ) {
                finish(
                  () =>
                    resolve(
                      content
                    )
                );
              }
            } catch {}
          },
          100
        );

      timer.unref?.();

      ff.once(
        "error",
        (
          error
        ) => {
          finish(
            () =>
              reject(
                new Error(
                  `FFmpeg impossible à démarrer: ${error.message}`
                )
              )
          );
        }
      );

      ff.once(
        "close",
        (
          code,
          signal
        ) => {
          if (
            finished
          ) {
            return;
          }

          const details =
            getStderr()
              .trim()
              .slice(
                -5000
              );

          finish(
            () =>
              reject(
                new Error(
                  [
                    "FFmpeg fermé avant création HLS.",

                    `code=${
                      code ??
                      "null"
                    }`,

                    `signal=${
                      signal ??
                      "null"
                    }`,

                    details
                      ? `stderr=${details}`
                      : "",
                  ]
                    .filter(
                      Boolean
                    )
                    .join(
                      " "
                    )
                )
              )
          );
        }
      );
    }
  );
}

/* =========================================================
   MANIFEST REWRITE
========================================================= */

function rewriteManifest(
  manifest: string,
  sessionId: string
) {
  const normalized =
    manifest.replace(
      /\r\n/g,
      "\n"
    );

  const lines =
    normalized.split(
      "\n"
    );

  const rewritten =
    lines.map(
      (
        rawLine
      ) => {
        const line =
          rawLine.trim();

        if (
          !line
        ) {
          return "";
        }

        /*
         * Conserver toutes les directives HLS.
         */
        if (
          line.startsWith(
            "#"
          )
        ) {
          return line;
        }

        /*
         * Seuls les segments MPEG-TS sont réécrits.
         */
        const cleanLine =
          line.split(
            "?"
          )[0];

        const file =
          path.basename(
            cleanLine
          );

        if (
          !/^seg-\d+\.ts$/i.test(
            file
          )
        ) {
          return line;
        }

        return (
          `/api/vod-hls-seg` +
          `?s=${encodeURIComponent(
            sessionId
          )}` +
          `&f=${encodeURIComponent(
            file
          )}`
        );
      }
    );

  return (
    rewritten.join(
      "\n"
    ) + "\n"
  );
}

/* =========================================================
   MANIFEST RESPONSE
========================================================= */

function manifestResponse(
  manifest: string,
  sessionId: string
) {
  const body =
    rewriteManifest(
      manifest,
      sessionId
    );

  return new Response(
    body,
    {
      status: 200,

      headers: {
        ...HEADERS,

        "Content-Type":
          "application/vnd.apple.mpegurl; charset=utf-8",

        "Cache-Control":
          "no-store, no-cache, must-revalidate, max-age=0",

        "X-GTV-Mode":
          "apple-hls-session",

        "X-GTV-Session":
          sessionId,

        "X-GTV-Manifest-Time":
          String(
            Date.now()
          ),
      },
    }
  );
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
    } = url;

    /* =====================================================
       MODE 1
       PLAYLIST D'UNE SESSION EXISTANTE
    ===================================================== */

    const requestedSession =
      searchParams.get(
        "s"
      );

    if (
      requestedSession
    ) {
      const sessionId =
        safe(
          requestedSession
        );

      if (
        !sessionId ||
        !validSessionId(
          sessionId
        ) ||
        sessionId !==
          requestedSession
      ) {
        return new Response(
          "Session HLS invalide",
          {
            status: 400,
            headers:
              HEADERS,
          }
        );
      }

      const dir =
        path.join(
          ROOT,
          sessionId
        );

      const playlist =
        path.join(
          dir,
          "index.m3u8"
        );

      let manifest:
        string;

      try {
        /*
         * Avec temp_file, FFmpeg remplace
         * index.m3u8 atomiquement.
         *
         * On laisse une courte fenêtre à FFmpeg.
         */
        manifest =
          await waitForPlaylist(
            playlist,
            10_000
          );
      } catch {
        console.warn(
          `[VOD HLS PLAYLIST NOT FOUND] session=${sessionId}`
        );

        return new Response(
          "Session HLS introuvable ou expirée",
          {
            status: 404,
            headers:
              HEADERS,
          }
        );
      }

      console.log(
        `[VOD HLS PLAYLIST] session=${sessionId}`
      );
      
      console.log(
  `[VOD HLS MANIFEST CONTENT] session=${sessionId}\n${manifest}`
);
      return manifestResponse(
        manifest,
        sessionId
      );
    }

    /* =====================================================
       MODE 2
       NOUVELLE SESSION
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
        ) || 0
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

    if (
      !id
    ) {
      return new Response(
        "ID manquant",
        {
          status: 400,
          headers:
            HEADERS,
        }
      );
    }

    /* =====================================================
       PREMIER APPEL
       APP / CLOUDFLARE
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
            status: 401,
            headers:
              HEADERS,
          }
        );
      }

      const host =
        cleanHost(
          session?.baseUrl ||
            session?.url ||
            session?.serverUrl ||
            session?.host ||
            ""
        );

      const username =
        session?.username ||
        session?.user ||
        "";

      const password =
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
            status: 400,
            headers:
              HEADERS,
          }
        );
      }

      if (
        !RAILWAY_URL
      ) {
        return new Response(
          "RAILWAY_PUBLIC_URL manquante",
          {
            status: 500,
            headers:
              HEADERS,
          }
        );
      }

      const target =
        new URL(
          "/api/vod-hls",
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
        seek > 0
      ) {
        target.searchParams.set(
          "t",
          String(
            seek
          )
        );
      }

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
        `[VOD HLS REDIRECT] ${type} id=${id} seek=${seek} -> ${target.origin}`
      );

      return NextResponse.redirect(
        target,
        302
      );
    }

    /* =====================================================
       RAILWAY DIRECT
    ===================================================== */

    const host =
      cleanHost(
        directHost
      );

    const username =
      directUser;

    const password =
      directPass;

    if (
      !host ||
      !username ||
      !password
    ) {
      return new Response(
        "Paramètres Railway incomplets",
        {
          status: 400,
          headers:
            HEADERS,
        }
      );
    }

    if (
      !RAILWAY_URL
    ) {
      return new Response(
        "RAILWAY_PUBLIC_URL manquante",
        {
          status: 500,
          headers:
            HEADERS,
        }
      );
    }

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
       SESSION HLS
    ===================================================== */

    const sessionId =
      safe(
        crypto.randomUUID()
      );

    const dir =
      path.join(
        ROOT,
        sessionId
      );

    await mkdir(
      dir,
      {
        recursive:
          true,
      }
    );

    const playlist =
      path.join(
        dir,
        "index.m3u8"
      );

    const segmentPattern =
      path.join(
        dir,
        "seg-%06d.ts"
      );

    /* =====================================================
       CONTINUE DIRECTEMENT AVEC PARTIE 2 / 3
    ===================================================== */
      /* =====================================================
       FFMPEG
       APPLE HLS

       OBJECTIFS :

       - H264 compatible Safari
       - AAC stéréo
       - YUV420P
       - segments MPEG-TS indépendants
       - keyframe toutes les 2 secondes
       - timeline HLS stable
       - reconnexion Xtream sans recréer la session
       - aucun GOP fixe dépendant du framerate
    ===================================================== */

    const args = [
      "-hide_banner",

      "-loglevel",
      "warning",

      "-nostdin",

      /* -----------------------------
         XTREAM HTTP
      ----------------------------- */

      "-user_agent",
      UA,

      /*
       * Timeout lecture réseau :
       * 15 secondes.
       */
      "-rw_timeout",
      "15000000",

      /*
       * Reconnexion automatique lorsque
       * Xtream ferme prématurément la connexion.
       */
      "-reconnect",
      "1",

      "-reconnect_streamed",
      "1",

      /*
       * L'upstream Xtream annonce une taille
       * complète puis coupe parfois avant la fin.
       */
      "-reconnect_at_eof",
      "1",

      "-reconnect_on_network_error",
      "1",

      "-reconnect_on_http_error",
      "4xx,5xx",

      /*
       * Plusieurs coupures ont été observées
       * pendant une même VOD.
       */
      "-reconnect_max_retries",
      "50",

      /*
       * On évite une attente exponentielle
       * trop importante entre deux tentatives.
       */
      "-reconnect_delay_max",
      "2",

      "-reconnect_delay_total_max",
      "300",

      /* -----------------------------
         ANALYSE INPUT
      ----------------------------- */

      /*
       * IMPORTANT :
       *
       * On ne force plus +genpts ici.
       *
       * Les logs ont montré que l'input Xtream
       * reprend après les coupures HTTP.
       *
       * On laisse donc le demuxer conserver
       * les timestamps de la VOD.
       */
      "-fflags",
      "+discardcorrupt",

      "-analyzeduration",
      "10000000",

      "-probesize",
      "10000000",

      /* -----------------------------
         SEEK
      ----------------------------- */

      ...(seek > 0
        ? [
            "-ss",
            String(
              seek
            ),
          ]
        : []),

      /* -----------------------------
         INPUT
      ----------------------------- */

      "-i",
      inputUrl,

      /* -----------------------------
         MAP
      ----------------------------- */

      "-map",
      "0:v:0?",

      "-map",
      "0:a:0?",

      /*
       * Aucun sous-titre / attachment /
       * flux secondaire dans le HLS Safari.
       */
      "-sn",
      "-dn",

      /* -----------------------------
         VIDEO
      ----------------------------- */

      "-c:v",
      "libx264",

      "-preset",
      "ultrafast",

      /*
       * Profil compatible iPhone / Safari.
       */
      "-profile:v",
      "main",

      "-level:v",
      "4.1",

      "-pix_fmt",
      "yuv420p",

      /*
       * Maximum 1080p.
       * Aucun upscale forcé.
       */
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",

      "-crf",
      "23",

      /* -----------------------------
         KEYFRAMES
      ----------------------------- */

      /*
       * On évite les keyframes supplémentaires
       * sur changement de scène afin que les
       * frontières HLS restent prévisibles.
       */
      "-sc_threshold",
      "0",

      /*
       * Une keyframe toutes les 2 secondes,
       * indépendamment du framerate source.
       *
       * IMPORTANT :
       *
       * on a volontairement supprimé :
       *
       *   -g 60
       *   -keyint_min 60
       *
       * car une source 23.976 / 24 / 25 fps
       * ne doit pas recevoir un GOP supposant
       * arbitrairement 30 fps.
       */
      "-force_key_frames",
      "expr:gte(t,n_forced*2)",

      /* -----------------------------
         AUDIO
      ----------------------------- */

      "-c:a",
      "aac",

      "-ac",
      "2",

      "-b:a",
      "128k",

      "-ar",
      "48000",

      /*
       * Maintient l'audio aligné avec
       * la timeline de sortie.
       */
      "-af",
      "aresample=async=1:first_pts=0",

      /* -----------------------------
         TIMESTAMPS
      ----------------------------- */

      /*
       * Les timestamps négatifs éventuels
       * sont déplacés dans une plage exploitable.
       *
       * On conserve cette protection,
       * mais on ne force plus -start_at_zero.
       */
      "-avoid_negative_ts",
      "make_non_negative",

      /*
       * IMPORTANT :
       *
       * SUPPRIMÉ :
       *
       *   -start_at_zero
       *
       * Cette option n'apporte rien ici sans
       * une stratégie copyts et pouvait rendre
       * le traitement de la timeline ambigu.
       */

      /* -----------------------------
         HLS
      ----------------------------- */

      "-f",
      "hls",

      /*
       * Cible : environ 2 secondes
       * par segment.
       */
      "-hls_time",
      "2",

      /*
       * Playlist EVENT complète.
       *
       * Aucun segment historique n'est retiré :
       * nécessaire pour une VOD progressive
       * et pour les seeks arrière.
       */
      "-hls_list_size",
      "0",

      "-hls_playlist_type",
      "event",

      /*
       * IMPORTANT :
       *
       * independent_segments :
       * les segments commencent sur une
       * image clé.
       *
       * temp_file :
       * Safari ne peut pas récupérer un
       * segment pendant son écriture.
       *
       * PAS de append_list.
       */
      "-hls_flags",
      "independent_segments+temp_file",

      /*
       * Segments MPEG-TS pour le HLS natif
       * Safari.
       */
      "-hls_segment_type",
      "mpegts",

      /*
       * Numérotation monotone depuis zéro.
       */
      "-start_number",
      "0",

      /*
       * IMPORTANT :
       *
       * On ne passe plus :
       *
       *   -mpegts_flags +resend_headers
       *
       * au muxer HLS principal.
       *
       * Le muxer HLS contrôle lui-même
       * la création des segments MPEG-TS.
       */
      "-hls_segment_filename",
      segmentPattern,

      playlist,
    ];

    console.log(
      `[VOD HLS START] type=${type} id=${id} ext=${ext} seek=${seek} session=${sessionId}`
    );

    console.log(
      `[VOD HLS PROFILE] id=${id} codec=h264 preset=ultrafast max=1920x1080 hls=2s audio=aac128 safari=1 timeline=stable-v2`
    );

    /* =====================================================
       SPAWN FFMPEG
    ===================================================== */

    const ff =
      spawn(
        /* turbopackIgnore: true */
        FFMPEG,
        args,
        {
          stdio: [
            "ignore",
            "ignore",
            "pipe",
          ],
        }
      );

    let stderr = "";

    /*
     * FFmpeg doit continuer à fonctionner
     * après le redirect de la requête initiale.
     *
     * Il n'est donc volontairement PAS lié
     * au AbortSignal de req.
     */

    ff.stderr.on(
      "data",
      (
        chunk
      ) => {
        const text =
          chunk.toString();

        stderr +=
          text;

        if (
          stderr.length >
          30000
        ) {
          stderr =
            stderr.slice(
              -30000
            );
        }

        /*
         * Logs importants uniquement.
         */
        if (
          /error|failed|invalid|unsupported|could not|conversion failed|no space|killed|prematurely|reconnect|timestamp|non-monotonous|discontinuity/i.test(
            text
          )
        ) {
          console.warn(
            `[VOD HLS FFMPEG] type=${type} id=${id} session=${sessionId} ${text.trim()}`
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
          `[VOD HLS FFMPEG ERROR] type=${type} id=${id} session=${sessionId}`,
          error
        );
      }
    );

    ff.on(
      "close",
      (
        code,
        signal
      ) => {
        console.log(
          `[VOD HLS CLOSED] type=${type} id=${id} session=${sessionId} code=${code} signal=${signal}`
        );

        if (
          stderr.trim()
        ) {
          console.log(
            `[VOD HLS STDERR] type=${type} id=${id}\n${stderr}`
          );
        }
      }
    );

    /* =====================================================
       ATTENTE DÉMARRAGE HLS
    ===================================================== */

    try {
      await waitForHlsStartup(
        playlist,
        ff,
        () =>
          stderr,
        START_TIMEOUT
      );
    } catch (
      error
    ) {
      /*
       * FFmpeg n'est tué ici que si la création
       * initiale du HLS a réellement échoué.
       */
      if (
        ff.exitCode ===
          null &&
        ff.signalCode ===
          null
      ) {
        console.error(
          `[VOD HLS STARTUP TIMEOUT] type=${type} id=${id} session=${sessionId}`
        );

        try {
          ff.kill(
            "SIGKILL"
          );
        } catch {}
      }

      await rm(
        dir,
        {
          recursive:
            true,

          force:
            true,
        }
      ).catch(
        () => {}
      );

      throw error;
    }

    /* =====================================================
       VALIDATION DU PREMIER MANIFESTE
    ===================================================== */

    let initialManifest =
      "";

    try {
      initialManifest =
        await readFile(
          playlist,
          "utf8"
        );
    } catch (
      error
    ) {
      console.error(
        `[VOD HLS INITIAL PLAYLIST READ ERROR] session=${sessionId}`,
        error
      );
    }

    if (
      !playlistIsReady(
        initialManifest
      )
    ) {
      if (
        ff.exitCode ===
          null &&
        ff.signalCode ===
          null
      ) {
        try {
          ff.kill(
            "SIGKILL"
          );
        } catch {}
      }

      await rm(
        dir,
        {
          recursive:
            true,

          force:
            true,
        }
      ).catch(
        () => {}
      );

      throw new Error(
        "Playlist HLS initiale invalide"
      );
    }

    /*
     * Compte les segments présents lorsque
     * Safari reçoit le manifeste initial.
     */
    const initialSegments =
      initialManifest
        .split(
          "\n"
        )
        .filter(
          (
            line
          ) =>
            /^seg-\d+\.ts/i.test(
              line.trim()
            )
        )
        .length;

    console.log(
      `[VOD HLS INITIAL] session=${sessionId} segments=${initialSegments}`
    );

    /* =====================================================
       URL PUBLIQUE DU MANIFESTE
    ===================================================== */

    const sessionPlaylistUrl =
      new URL(
        "/api/vod-hls",
        RAILWAY_URL
      );

    sessionPlaylistUrl
      .searchParams
      .set(
        "s",
        sessionId
      );

    /* =====================================================
       CLEANUP
    ===================================================== */

    /*
     * Une session VOD peut rester plusieurs heures.
     *
     * La fin de la requête HTTP initiale ne doit
     * surtout pas tuer FFmpeg.
     */
    const cleanup =
      setTimeout(
        async () => {
          try {
            if (
              ff.exitCode ===
                null &&
              ff.signalCode ===
                null
            ) {
              ff.kill(
                "SIGKILL"
              );
            }
          } catch {}

          await rm(
            dir,
            {
              recursive:
                true,

              force:
                true,
            }
          ).catch(
            () => {}
          );

          console.log(
            `[VOD HLS CLEANUP] session=${sessionId}`
          );
        },

        4 *
          60 *
          60 *
          1000
      );

    cleanup.unref?.();

    /* =====================================================
       READY
    ===================================================== */

    console.log(
      `[VOD HLS READY] type=${type} id=${id} session=${sessionId}`
    );

    console.log(
      `[VOD HLS MANIFEST] session=${sessionId} -> ${sessionPlaylistUrl.toString()}`
    );

    /*
     * Safari reste ensuite sur :
     *
     * /api/vod-hls?s=SESSION
     *
     * Cette URL relit le manifeste généré par
     * CE même process FFmpeg.
     */
    return NextResponse.redirect(
      sessionPlaylistUrl,
      {
        status: 302,

        headers: {
          "Cache-Control":
            "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );

  } catch (
    error: any
  ) {
    console.error(
      "[VOD-HLS]",
      error
    );

    return new Response(
      `Erreur VOD HLS: ${
        error?.message ||
        "unknown"
      }`,
      {
        status: 500,

        headers:
          HEADERS,
      }
    );
  }
}

/* =========================================================
   CONTINUE DIRECTEMENT AVEC PARTIE 3 / 3
========================================================= */
/* =========================================================
   HEAD

   Safari / iOS peut effectuer une requête HEAD
   avant ou pendant la lecture du manifeste.

   IMPORTANT :
   une requête HEAD sans session ne doit jamais
   démarrer une nouvelle instance FFmpeg.
========================================================= */

export async function HEAD(
  req: Request
) {
  try {
    const url =
      new URL(
        req.url
      );

    const requestedSession =
      url.searchParams.get(
        "s"
      );

    /* =====================================================
       HEAD D'UNE SESSION EXISTANTE
    ===================================================== */

    if (
      requestedSession
    ) {
      const sessionId =
        safe(
          requestedSession
        );

      if (
        !sessionId ||
        !validSessionId(
          sessionId
        ) ||
        sessionId !==
          requestedSession
      ) {
        return new Response(
          null,
          {
            status: 400,

            headers:
              HEADERS,
          }
        );
      }

      const dir =
        path.join(
          ROOT,
          sessionId
        );

      const playlist =
        path.join(
          dir,
          "index.m3u8"
        );

      let manifest:
        string;

      try {
        /*
         * Avec temp_file, FFmpeg peut être
         * précisément entre l'écriture du .tmp
         * et son rename atomique.
         *
         * On laisse donc une courte fenêtre
         * avant de considérer la session absente.
         */
        manifest =
          await waitForPlaylist(
            playlist,
            10_000
          );
      } catch {
        console.warn(
          `[VOD HLS HEAD NOT FOUND] session=${sessionId}`
        );

        return new Response(
          null,
          {
            status: 404,

            headers:
              HEADERS,
          }
        );
      }

      const rewritten =
        rewriteManifest(
          manifest,
          sessionId
        );

      return new Response(
        null,
        {
          status: 200,

          headers: {
            ...HEADERS,

            "Content-Type":
              "application/vnd.apple.mpegurl; charset=utf-8",

            "Content-Length":
              String(
                Buffer.byteLength(
                  rewritten,
                  "utf8"
                )
              ),

            /*
             * Safari doit toujours revalider
             * le manifeste EVENT.
             */
            "Cache-Control":
              "no-store, no-cache, must-revalidate, max-age=0",

            "X-GTV-Mode":
              "apple-hls-session",

            "X-GTV-Session":
              sessionId,

            "X-GTV-Manifest-Time":
              String(
                Date.now()
              ),
          },
        }
      );
    }

    /* =====================================================
       HEAD SANS SESSION

       La route existe mais on ne démarre surtout
       pas FFmpeg pour une simple requête HEAD.
    ===================================================== */

    return new Response(
      null,
      {
        status: 200,

        headers: {
          ...HEADERS,

          "Content-Type":
            "application/vnd.apple.mpegurl; charset=utf-8",

          "Cache-Control":
            "no-store, no-cache, must-revalidate, max-age=0",

          "X-GTV-Mode":
            "apple-hls",
        },
      }
    );

  } catch (
    error
  ) {
    console.error(
      "[VOD HLS HEAD]",
      error
    );

    return new Response(
      null,
      {
        status: 500,

        headers:
          HEADERS,
      }
    );
  }
}

/* =========================================================
   OPTIONS

   CORS / Safari
========================================================= */

export async function OPTIONS() {
  return new Response(
    null,
    {
      status: 204,

      headers: {
        ...HEADERS,

        "Access-Control-Allow-Methods":
          "GET, HEAD, OPTIONS",

        "Access-Control-Allow-Headers":
          "Range, Content-Type, Accept",

        "Access-Control-Expose-Headers":
          "Content-Length, Content-Range, Accept-Ranges",

        "Access-Control-Max-Age":
          "86400",
      },
    }
  );
}
