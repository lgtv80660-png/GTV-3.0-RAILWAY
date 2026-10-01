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
 * IMPORTANT SAFARI
 *
 * Le manifeste HLS doit toujours être relu.
 * Safari recharge régulièrement index.m3u8
 * pour découvrir les nouveaux segments.
 *
 * Aucun cache ici.
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
    await stat(file);

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

  /*
   * Au moins un segment réellement publié.
   */
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
        if (finished) {
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
            if (finished) {
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
          if (finished) {
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
  /*
   * On normalise les fins de lignes.
   *
   * Safari est plus sensible que hls.js aux
   * playlists modifiées à la volée.
   */
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

        if (!line) {
          return "";
        }

        /*
         * Toutes les directives HLS
         * sont conservées exactement.
         */
        if (
          line.startsWith(
            "#"
          )
        ) {
          return line;
        }

        /*
         * On ne transforme que les segments TS.
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

  /*
   * Une playlist texte HLS doit terminer
   * proprement par un retour à la ligne.
   */
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

        /*
         * Safari doit revalider cette playlist.
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

       Safari appelle régulièrement :

       /api/vod-hls?s=SESSION

       IMPORTANT :
       on relit index.m3u8 à CHAQUE requête.
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
         * Le fichier peut momentanément être remplacé
         * par FFmpeg à cause de hls_flags=temp_file.
         *
         * waitForPlaylist() laisse donc une petite
         * fenêtre au rename atomique.
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

    if (!id) {
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
       SUITE DANS PARTIE 2 / 3
    ===================================================== */
      /* =====================================================
       FFMPEG
       APPLE HLS

       OBJECTIFS :

       - H264 compatible Safari
       - AAC stéréo
       - YUV420P
       - GOP régulier
       - keyframe toutes les 2 secondes
       - segments TS indépendants
       - timestamps continus
       - playlist mise à jour pendant l'encodage
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

      "-rw_timeout",
      "60000000",

      /*
       * L'upstream Xtream peut couper
       * momentanément une connexion.
       *
       * FFmpeg doit tenter de reprendre
       * au lieu de terminer immédiatement
       * la session HLS.
       */
      "-reconnect",
      "1",

      "-reconnect_streamed",
      "1",

      "-reconnect_at_eof",
      "1",

      "-reconnect_on_network_error",
      "1",

      "-reconnect_on_http_error",
      "4xx,5xx",

      "-reconnect_delay_max",
      "10",

      /*
       * Génération de timestamps propres
       * et rejet des paquets corrompus.
       */
      "-fflags",
      "+genpts+discardcorrupt",

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
       * Ne jamais laisser passer
       * les attachments MKV,
       * sous-titres intégrés ou
       * autres streams non nécessaires.
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
       * Main 4.1 est largement
       * compatible avec Safari/iPhone.
       */
      "-profile:v",
      "main",

      "-level:v",
      "4.1",

      "-pix_fmt",
      "yuv420p",

      /*
       * Maximum 1080p.
       * Pas d'upscale forcé.
       */
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",

      "-crf",
      "23",

      /* -----------------------------
         GOP / KEYFRAMES
      ----------------------------- */

      /*
       * On désactive les keyframes
       * automatiques liées aux changements
       * de scène.
       */
      "-sc_threshold",
      "0",

      /*
       * Segment = 2 secondes.
       * On force donc une keyframe
       * toutes les 2 secondes.
       */
      "-force_key_frames",
      "expr:gte(t,n_forced*2)",

      /*
       * GOP explicite.
       *
       * 60 correspond à 2 secondes
       * pour une source proche de 30 fps.
       * force_key_frames reste l'autorité
       * principale pour les autres fps.
       */
      "-g",
      "60",

      "-keyint_min",
      "60",

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
       * Resynchronise l'audio en cas
       * de timestamps irréguliers de
       * l'upstream Xtream.
       */
      "-af",
      "aresample=async=1:first_pts=0",

      /* -----------------------------
         TIMESTAMPS
      ----------------------------- */

      "-avoid_negative_ts",
      "make_zero",

      /*
       * Safari tolère beaucoup moins
       * bien les discontinuités temporelles
       * entre les segments qu'un lecteur
       * desktop.
       */
      "-start_at_zero",

      /* -----------------------------
         MPEG-TS
      ----------------------------- */

      /*
       * Réémission régulière des headers
       * MPEG-TS pour que chaque segment
       * soit décodable indépendamment.
       */
      "-mpegts_flags",
      "+resend_headers",

      /* -----------------------------
         HLS
      ----------------------------- */

      "-f",
      "hls",

      /*
       * Segments courts pour réduire
       * le délai de démarrage.
       */
      "-hls_time",
      "2",

      /*
       * On conserve la playlist entière
       * pour une VOD en cours de génération.
       */
      "-hls_list_size",
      "0",

      /*
       * EVENT :
       * la playlist grandit au fur et à
       * mesure que FFmpeg produit les
       * nouveaux segments.
       */
      "-hls_playlist_type",
      "event",

      /*
       * independent_segments :
       * indique à Safari que chaque segment
       * commence sur une image clé.
       *
       * temp_file :
       * FFmpeg écrit d'abord .tmp puis
       * effectue un rename atomique.
       * Safari ne peut donc pas télécharger
       * un segment encore incomplet.
       *
       * append_list :
       * conserve correctement la continuité
       * de la playlist.
       */
      "-hls_flags",
      "independent_segments+temp_file+append_list",

      /*
       * MPEG-TS explicite.
       */
      "-hls_segment_type",
      "mpegts",

      "-start_number",
      "0",

      "-hls_segment_filename",
      segmentPattern,

      playlist,
    ];

    console.log(
      `[VOD HLS START] type=${type} id=${id} ext=${ext} seek=${seek} session=${sessionId}`
    );

    console.log(
      `[VOD HLS PROFILE] id=${id} codec=h264 preset=ultrafast max=1920x1080 hls=2s audio=aac128 safari=1`
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
     * Important :
     *
     * Le process FFmpeg doit continuer
     * après que cette requête HTTP initiale
     * a renvoyé son redirect.
     *
     * On ne lie donc pas son cycle de vie
     * au signal AbortSignal de req.
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
         * Logs importants seulement.
         */
        if (
          /error|failed|invalid|unsupported|could not|conversion failed|no space|killed|prematurely|reconnect/i.test(
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
       ATTENTE PREMIER SEGMENT
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
       * On tue FFmpeg uniquement si
       * le démarrage HLS a réellement
       * échoué.
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
     * Log utile pour le prochain test iPhone.
     *
     * Cela permet de voir combien de segments
     * existaient au moment où Safari a commencé.
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
     * IMPORTANT :
     * ne jamais supprimer le dossier ou tuer FFmpeg
     * après quelques secondes/minutes simplement parce
     * que la requête HTTP initiale est terminée.
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

    /* =====================================================
       REDIRECT PUBLIC RAILWAY

       Safari doit ensuite rester sur :

       /api/vod-hls?s=SESSION

       et recharger CE manifeste pour découvrir
       seg-000001.ts, seg-000002.ts, etc.
    ===================================================== */

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
   HEAD

   Safari/iOS peut effectuer une requête HEAD
   avant ou pendant la lecture du manifeste.

   On renvoie les mêmes règles de cache que GET.
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

    /*
     * HEAD d'une playlist existante.
     */
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
        manifest =
          await waitForPlaylist(
            playlist,
            10_000
          );
      } catch {
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

            "Cache-Control":
              "no-store, no-cache, must-revalidate, max-age=0",

            "X-GTV-Mode":
              "apple-hls-session",

            "X-GTV-Session":
              sessionId,
          },
        }
      );
    }

    /*
     * HEAD sans session :
     * la route existe, mais on ne crée surtout
     * pas un FFmpeg pour une simple requête HEAD.
     */
    return new Response(
      null,
      {
        status: 200,

        headers: {
          ...HEADERS,

          "Content-Type":
            "application/vnd.apple.mpegurl; charset=utf-8",
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

        "Access-Control-Max-Age":
          "86400",
      },
    }
  );
}
