import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { requireSession } from "@/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* =========================================================
   CONFIG
========================================================= */

const UA = "VLC/3.0.20 LibVLC/3.0.20";

const FFMPEG =
  process.env.FFMPEG_PATH ||
  "ffmpeg";

const RAILWAY_URL = (
  process.env.RAILWAY_PUBLIC_URL ||
  ""
).replace(/\/+$/, "");

const ROOT =
  "/tmp/gtv-vod-hls";

const START_TIMEOUT =
  45_000;

const SESSION_REUSE_MAX_AGE =
  4 * 60 * 60 * 1000;

/* =========================================================
   HEADERS
========================================================= */

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
   TYPES
========================================================= */

type HlsProcess =
  ReturnType<typeof spawn>;

type VodHlsSession = {
  key: string;

  sessionId: string;

  type:
    | "movie"
    | "series";

  id: string;

  ext: string;

  seek: number;

  host: string;

  username: string;

  dir: string;

  playlist: string;

  segmentPattern: string;

  ffmpeg:
    HlsProcess | null;

  createdAt: number;

  lastAccessAt: number;

  ready: boolean;

  closed: boolean;
};

/* =========================================================
   GLOBAL SESSION REGISTRY
========================================================= */

declare global {
  // eslint-disable-next-line no-var
  var __gtvVodHlsSessions:
    Map<string, VodHlsSession>
    | undefined;

  // eslint-disable-next-line no-var
  var __gtvVodHlsSessionIds:
    Map<string, VodHlsSession>
    | undefined;
}

const sessionsByKey =
  globalThis.__gtvVodHlsSessions ??
  new Map<string, VodHlsSession>();

const sessionsById =
  globalThis.__gtvVodHlsSessionIds ??
  new Map<string, VodHlsSession>();

globalThis.__gtvVodHlsSessions =
  sessionsByKey;

globalThis.__gtvVodHlsSessionIds =
  sessionsById;

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

function validSegmentName(
  value: string
) {
  return /^seg-\d+\.ts$/i.test(
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
   SESSION KEY
========================================================= */

function createSessionKey(
  host: string,
  username: string,
  password: string,
  type:
    | "movie"
    | "series",
  id: string,
  ext: string,
  seek: number
) {
  const passwordFingerprint =
    crypto
      .createHash("sha256")
      .update(password)
      .digest("hex")
      .slice(0, 16);

  return [
    cleanHost(host),
    username,
    passwordFingerprint,
    type,
    id,
    ext,
    String(seek),
  ].join("|");
}

/* =========================================================
   SESSION REGISTRY
========================================================= */

function registerSession(
  session: VodHlsSession
) {
  sessionsByKey.set(
    session.key,
    session
  );

  sessionsById.set(
    session.sessionId,
    session
  );
}

function unregisterSession(
  session: VodHlsSession
) {
  const currentByKey =
    sessionsByKey.get(
      session.key
    );

  if (
    currentByKey?.sessionId ===
    session.sessionId
  ) {
    sessionsByKey.delete(
      session.key
    );
  }

  const currentById =
    sessionsById.get(
      session.sessionId
    );

  if (
    currentById?.sessionId ===
    session.sessionId
  ) {
    sessionsById.delete(
      session.sessionId
    );
  }
}

function processIsAlive(
  session: VodHlsSession
) {
  const ff =
    session.ffmpeg;

  if (!ff) {
    return !session.closed;
  }

  return (
    ff.exitCode === null &&
    ff.signalCode === null &&
    !session.closed
  );
}

/* =========================================================
   REMOVE SESSION
========================================================= */

async function removeSession(
  session: VodHlsSession,
  options?: {
    killProcess?: boolean;
    removeFiles?: boolean;
    reason?: string;
  }
) {
  const killProcess =
    options?.killProcess ??
    false;

  const removeFiles =
    options?.removeFiles ??
    false;

  const reason =
    options?.reason ||
    "unknown";

  unregisterSession(
    session
  );

  if (
    killProcess
  ) {
    const ff =
      session.ffmpeg;

    if (
      ff &&
      ff.exitCode === null &&
      ff.signalCode === null
    ) {
      console.log(
        `[VOD HLS KILL] session=${session.sessionId} reason=${reason}`
      );

      try {
        ff.kill(
          "SIGKILL"
        );
      } catch {}
    }
  }

  session.closed =
    true;

  if (
    removeFiles
  ) {
    await rm(
      session.dir,
      {
        recursive:
          true,

        force:
          true,
      }
    ).catch(
      () => {}
    );
  }
}

/* =========================================================
   PRUNE
========================================================= */

async function pruneSessions() {
  const now =
    Date.now();

  const sessions =
    Array.from(
      sessionsById.values()
    );

  for (
    const session
    of sessions
  ) {
    const age =
      now -
      session.createdAt;

    if (
      session.closed ||
      !processIsAlive(
        session
      )
    ) {
      await removeSession(
        session,
        {
          killProcess:
            false,

          removeFiles:
            false,

          reason:
            "process-closed",
        }
      );

      continue;
    }

    if (
      age >
      SESSION_REUSE_MAX_AGE
    ) {
      await removeSession(
        session,
        {
          killProcess:
            true,

          removeFiles:
            true,

          reason:
            "max-age",
        }
      );
    }
  }
}

/* =========================================================
   REUSE
========================================================= */

async function findReusableSession(
  key: string
) {
  const session =
    sessionsByKey.get(
      key
    );

  if (!session) {
    return null;
  }

  if (
    session.closed
  ) {
    unregisterSession(
      session
    );

    return null;
  }

  if (
    !processIsAlive(
      session
    )
  ) {
    console.log(
      `[VOD HLS REUSE DEAD] session=${session.sessionId}`
    );

    unregisterSession(
      session
    );

    return null;
  }

  const age =
    Date.now() -
    session.createdAt;

  if (
    age >
    SESSION_REUSE_MAX_AGE
  ) {
    await removeSession(
      session,
      {
        killProcess:
          true,

        removeFiles:
          true,

        reason:
          "reuse-expired",
      }
    );

    return null;
  }

  session.lastAccessAt =
    Date.now();

  return session;
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
  timeout =
    START_TIMEOUT
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
      (
        resolve
      ) =>
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
   PURE HLS MANIFEST REWRITE

   AVANT :
   /api/vod-hls-seg?s=SESSION&f=seg-000001.ts

   MAINTENANT :
   /api/vod-hls?s=SESSION&seg=seg-000001.ts

   Playlist + segments sont servis par UNE SEULE route HLS.
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

        if (
          line.startsWith(
            "#"
          )
        ) {
          return line;
        }

        const cleanLine =
          line.split(
            "?"
          )[0];

        const file =
          path.basename(
            cleanLine
          );

        if (
          !validSegmentName(
            file
          )
        ) {
          return line;
        }

        return (
          `/api/vod-hls` +
          `?s=${encodeURIComponent(
            sessionId
          )}` +
          `&seg=${encodeURIComponent(
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
      status:
        200,

      headers: {
        ...HEADERS,

        "Content-Type":
          "application/vnd.apple.mpegurl; charset=utf-8",

        "Cache-Control":
          "no-store, no-cache, must-revalidate, max-age=0",

        "X-GTV-Mode":
          "pure-hls",

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
   SESSION PLAYLIST URL
========================================================= */

function createSessionPlaylistUrl(
  sessionId: string
) {
  const target =
    new URL(
      "/api/vod-hls",
      RAILWAY_URL
    );

  target.searchParams.set(
    "s",
    sessionId
  );

  return target;
}

/* =========================================================
   REDIRECT SESSION
========================================================= */

function redirectToSession(
  session: VodHlsSession,
  reused:
    boolean
) {
  session.lastAccessAt =
    Date.now();

  const target =
    createSessionPlaylistUrl(
      session.sessionId
    );

  console.log(
    reused
      ? `[VOD HLS REUSE] type=${session.type} id=${session.id} seek=${session.seek} session=${session.sessionId}`
      : `[VOD HLS MANIFEST] session=${session.sessionId} -> ${target.toString()}`
  );

  return NextResponse.redirect(
    target,
    {
      status:
        302,

      headers: {
        "Cache-Control":
          "no-store, no-cache, must-revalidate, max-age=0",

        "X-GTV-HLS-Session":
          session.sessionId,

        "X-GTV-HLS-Reused":
          reused
            ? "1"
            : "0",
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

    await pruneSessions();

    /* =====================================================
       MODE 1
       SESSION HLS EXISTANTE
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
            status:
              400,

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

      const registeredSession =
        sessionsById.get(
          sessionId
        );

      if (
        registeredSession
      ) {
        registeredSession.lastAccessAt =
          Date.now();
      }

      /* =====================================================
         MODE 1A
         SEGMENT HLS DIRECT

         Plus aucun /api/vod-hls-seg.
      ===================================================== */

      const requestedSegment =
        searchParams.get(
          "seg"
        );

      if (
        requestedSegment
      ) {
        const file =
          path.basename(
            requestedSegment
          );

        if (
          !validSegmentName(
            file
          ) ||
          file !==
            requestedSegment
        ) {
          return new Response(
            "Segment HLS invalide",
            {
              status:
                400,

              headers:
                HEADERS,
            }
          );
        }

        const segmentPath =
          path.join(
            dir,
            file
          );

        try {
          const segment =
            await readFile(
              segmentPath
            );

          /*
           * IMPORTANT :
           * aucun log par segment.
           */

          return new Response(
            segment,
            {
              status:
                200,

              headers: {
                ...HEADERS,

                "Content-Type":
                  "video/mp2t",

                "Content-Length":
                  String(
                    segment.length
                  ),

                "Accept-Ranges":
                  "bytes",

                "Cache-Control":
                  "no-store, no-cache, must-revalidate, max-age=0",

                "X-GTV-Mode":
                  "pure-hls-segment",

                "X-GTV-Session":
                  sessionId,
              },
            }
          );
        } catch {
          return new Response(
            "Segment HLS introuvable",
            {
              status:
                404,

              headers:
                HEADERS,
            }
          );
        }
      }

      /* =====================================================
         MODE 1B
         PLAYLIST HLS
      ===================================================== */

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
        console.warn(
          `[VOD HLS PLAYLIST NOT FOUND] session=${sessionId}`
        );

        if (
          registeredSession
        ) {
          unregisterSession(
            registeredSession
          );
        }

        return new Response(
          "Session HLS introuvable ou expirée",
          {
            status:
              404,

            headers:
              HEADERS,
          }
        );
      }

      /*
       * PAS DE DUMP DU MANIFESTE.
       */

      return manifestResponse(
        manifest,
        sessionId
      );
    }

    /* =====================================================
       MODE 2
       NOUVELLE DEMANDE VOD
    ===================================================== */

    const type:
      | "movie"
      | "series" =
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
          status:
            400,

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
            status:
              401,

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
            status:
              400,

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
            status:
              500,

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
          status:
            400,

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
          status:
            500,

          headers:
            HEADERS,
        }
      );
    }

    /* =====================================================
       SESSION KEY
    ===================================================== */

    const sessionKey =
      createSessionKey(
        host,
        username,
        password,
        type,
        id,
        ext,
        seek
      );

    /* =====================================================
       REUSE
    ===================================================== */

    const reusableSession =
      await findReusableSession(
        sessionKey
      );

    if (
      reusableSession
    ) {
      console.log(
        `[VOD HLS REUSE REQUEST] type=${type} id=${id} seek=${seek} session=${reusableSession.sessionId} ready=${reusableSession.ready ? 1 : 0}`
      );

      return redirectToSession(
        reusableSession,
        true
      );
    }

    /* =====================================================
       INPUT XTREAM
    ===================================================== */

    const folder =
      type === "series"
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
       NOUVELLE SESSION
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

    const vodSession:
      VodHlsSession = {
        key:
          sessionKey,

        sessionId,

        type,

        id,

        ext,

        seek,

        host,

        username,

        dir,

        playlist,

        segmentPattern,

        ffmpeg:
          null,

        createdAt:
          Date.now(),

        lastAccessAt:
          Date.now(),

        ready:
          false,

        closed:
          false,
      };

    registerSession(
      vodSession
    );

    console.log(
      `[VOD HLS SESSION REGISTER] type=${type} id=${id} seek=${seek} session=${sessionId}`
    );

    /* =====================================================
       FFMPEG — PURE HLS

       On conserve volontairement le profil du cas 841199.
    ===================================================== */

    const args = [
      "-hide_banner",

      "-loglevel",
      "warning",

      "-nostdin",

      /* XTREAM */

      "-user_agent",
      UA,

      "-rw_timeout",
      "15000000",

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

      "-reconnect_max_retries",
      "50",

      "-reconnect_delay_max",
      "2",

      "-reconnect_delay_total_max",
      "300",

      /* INPUT ANALYSIS */

      "-fflags",
      "+discardcorrupt",

      "-analyzeduration",
      "10000000",

      "-probesize",
      "10000000",

      /* SEEK */

      ...(seek > 0
        ? [
            "-ss",
            String(
              seek
            ),
          ]
        : []),

      /* INPUT */

      "-i",
      inputUrl,

      /* MAP */

      "-map",
      "0:v:0?",

      "-map",
      "0:a:0?",

      "-sn",
      "-dn",

      /* VIDEO */

      "-c:v",
      "libx264",

      "-preset",
      "ultrafast",

      "-profile:v",
      "main",

      "-level:v",
      "4.1",

      "-pix_fmt",
      "yuv420p",

      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",

      "-crf",
      "23",

      /* KEYFRAMES */

      "-sc_threshold",
      "0",

      "-force_key_frames",
      "expr:gte(t,n_forced*2)",

      /* AUDIO */

      "-c:a",
      "aac",

      "-ac",
      "2",

      "-b:a",
      "128k",

      "-ar",
      "48000",

      "-af",
      "aresample=async=1:first_pts=0",

      /* TIMESTAMPS */

      "-avoid_negative_ts",
      "make_non_negative",

      /* HLS */

      "-f",
      "hls",

      "-hls_time",
      "2",

      "-hls_list_size",
      "0",

      "-hls_playlist_type",
      "event",

      "-hls_flags",
      "independent_segments+temp_file",

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
      `[VOD HLS PROFILE] id=${id} codec=h264 preset=ultrafast max=1920x1080 hls=2s audio=aac128 safari=1 mode=pure-hls reuse=1`
    );

    /* =====================================================
       SPAWN
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

    vodSession.ffmpeg =
      ff;

    console.log(
      `[VOD HLS SPAWN] type=${type} id=${id} session=${sessionId} pid=${ff.pid ?? "unknown"} active=${sessionsById.size}`
    );

    let stderr =
      "";

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
         * Seulement les événements FFmpeg utiles.
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
        vodSession.closed =
          true;

        vodSession.ready =
          false;

        unregisterSession(
          vodSession
        );

        console.log(
          `[VOD HLS CLOSED] type=${type} id=${id} session=${sessionId} pid=${ff.pid ?? "unknown"} code=${code} signal=${signal} active=${sessionsById.size}`
        );

        /*
         * PAS de dump complet stderr ici.
         * Les erreurs importantes sont déjà logguées plus haut.
         */
      }
    );

    /* =====================================================
       STARTUP
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
      console.error(
        `[VOD HLS STARTUP FAILED] type=${type} id=${id} session=${sessionId}`
      );

      unregisterSession(
        vodSession
      );

      vodSession.closed =
        true;

      vodSession.ready =
        false;

      if (
        ff.exitCode ===
          null &&
        ff.signalCode ===
          null
      ) {
        console.log(
          `[VOD HLS KILL] session=${sessionId} reason=startup-failed`
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
       INITIAL MANIFEST
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
      unregisterSession(
        vodSession
      );

      vodSession.closed =
        true;

      vodSession.ready =
        false;

      if (
        ff.exitCode ===
          null &&
        ff.signalCode ===
          null
      ) {
        console.log(
          `[VOD HLS KILL] session=${sessionId} reason=invalid-initial-playlist`
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

      throw new Error(
        "Playlist HLS initiale invalide"
      );
    }

    vodSession.ready =
      true;

    vodSession.lastAccessAt =
      Date.now();

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
       CLEANUP 4H
    ===================================================== */

    const cleanup =
      setTimeout(
        async () => {
          unregisterSession(
            vodSession
          );

          vodSession.ready =
            false;

          vodSession.closed =
            true;

          if (
            ff.exitCode ===
              null &&
            ff.signalCode ===
              null
          ) {
            console.log(
              `[VOD HLS KILL] session=${sessionId} reason=4h-cleanup`
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

          console.log(
            `[VOD HLS CLEANUP] session=${sessionId}`
          );
        },

        SESSION_REUSE_MAX_AGE
      );

    cleanup.unref?.();

    /* =====================================================
       READY
    ===================================================== */

    console.log(
      `[VOD HLS READY] type=${type} id=${id} session=${sessionId}`
    );

    return redirectToSession(
      vodSession,
      false
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
        status:
          500,

        headers:
          HEADERS,
      }
    );
  }
}
/* =========================================================
   HEAD

   HLS direct :
   - playlist : ?s=SESSION
   - segment  : ?s=SESSION&seg=seg-XXXXXX.ts

   HEAD ne démarre jamais FFmpeg.
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
       HEAD SESSION
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
            status:
              400,

            headers:
              HEADERS,
          }
        );
      }

      const registeredSession =
        sessionsById.get(
          sessionId
        );

      if (
        registeredSession
      ) {
        registeredSession.lastAccessAt =
          Date.now();
      }

      const dir =
        path.join(
          ROOT,
          sessionId
        );

      /* =====================================================
         HEAD SEGMENT
      ===================================================== */

      const requestedSegment =
        url.searchParams.get(
          "seg"
        );

      if (
        requestedSegment
      ) {
        const file =
          path.basename(
            requestedSegment
          );

        if (
          !validSegmentName(
            file
          ) ||
          file !==
            requestedSegment
        ) {
          return new Response(
            null,
            {
              status:
                400,

              headers:
                HEADERS,
            }
          );
        }

        const segmentPath =
          path.join(
            dir,
            file
          );

        try {
          const info =
            await stat(
              segmentPath
            );

          return new Response(
            null,
            {
              status:
                200,

              headers: {
                ...HEADERS,

                "Content-Type":
                  "video/mp2t",

                "Content-Length":
                  String(
                    info.size
                  ),

                "Accept-Ranges":
                  "bytes",

                "Cache-Control":
                  "no-store, no-cache, must-revalidate, max-age=0",

                "X-GTV-Mode":
                  "pure-hls-segment",

                "X-GTV-Session":
                  sessionId,
              },
            }
          );
        } catch {
          return new Response(
            null,
            {
              status:
                404,

              headers:
                HEADERS,
            }
          );
        }
      }

      /* =====================================================
         HEAD PLAYLIST
      ===================================================== */

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
        console.warn(
          `[VOD HLS HEAD NOT FOUND] session=${sessionId}`
        );

        if (
          registeredSession
        ) {
          unregisterSession(
            registeredSession
          );
        }

        return new Response(
          null,
          {
            status:
              404,

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
          status:
            200,

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
              "pure-hls",

            "X-GTV-Session":
              sessionId,

            "X-GTV-HLS-Registered":
              registeredSession
                ? "1"
                : "0",

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

       Ne crée aucune session.
       Ne lance jamais FFmpeg.
    ===================================================== */

    return new Response(
      null,
      {
        status:
          200,

        headers: {
          ...HEADERS,

          "Content-Type":
            "application/vnd.apple.mpegurl; charset=utf-8",

          "Cache-Control":
            "no-store, no-cache, must-revalidate, max-age=0",

          "X-GTV-Mode":
            "pure-hls",
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
        status:
          500,

        headers:
          HEADERS,
      }
    );
  }
}

/* =========================================================
   OPTIONS
========================================================= */

export async function OPTIONS() {
  return new Response(
    null,
    {
      status:
        204,

      headers: {
        ...HEADERS,

        "Access-Control-Allow-Methods":
          "GET, HEAD, OPTIONS",

        "Access-Control-Allow-Headers":
          "Range, Content-Type, Accept",

        "Access-Control-Expose-Headers":
          "Content-Length, Content-Range, Accept-Ranges, X-GTV-Mode, X-GTV-Session, X-GTV-HLS-Session, X-GTV-HLS-Reused, X-GTV-HLS-Registered",

        "Access-Control-Max-Age":
          "86400",
      },
    }
  );
}
