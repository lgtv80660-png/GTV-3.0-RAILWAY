import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { requireSession } from "@/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "VLC/3.0.20 LibVLC/3.0.20";

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

const HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Access-Control-Allow-Origin":
    "*",
};

/* =========================================================
   HELPERS
========================================================= */

function cleanHost(
  value: string
) {
  return String(
    value || ""
  ).replace(/\/+$/, "");
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
   WAIT PLAYLIST
========================================================= */

async function waitForPlaylist(
  playlist: string,
  timeout = START_TIMEOUT
) {
  const started =
    Date.now();

  while (
    Date.now() - started <
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
          content.includes(
            "#EXTM3U"
          ) &&
          content.includes(
            "#EXTINF"
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
  getStderr: () => string,
  timeout = START_TIMEOUT
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
        callback: () => void
      ) => {
        if (finished) {
          return;
        }

        finished = true;

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
              finish(() =>
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
                content.includes(
                  "#EXTM3U"
                ) &&
                content.includes(
                  "#EXTINF"
                )
              ) {
                finish(() =>
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
        (error) => {
          finish(() =>
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

          finish(() =>
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
                  .join(" ")
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
  return manifest.replace(
    /^(?!#)(.+\.ts)(?:\?.*)?$/gm,
    (line) => {
      const cleanLine =
        line
          .trim()
          .split("?")[0];

      const file =
        path.basename(
          cleanLine
        );

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

       /api/vod-hls?s=SESSION
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

      manifest =
        rewriteManifest(
          manifest,
          sessionId
        );

      console.log(
        `[VOD HLS PLAYLIST] session=${sessionId}`
      );

      return new Response(
        manifest,
        {
          status: 200,

          headers: {
            ...HEADERS,

            "Content-Type":
              "application/vnd.apple.mpegurl; charset=utf-8",

            "X-GTV-Mode":
              "apple-hls-session",

            "X-GTV-Session":
              sessionId,
          },
        }
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
      let session: any;

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
        recursive: true,
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
       FFMPEG
       APPLE HLS

       H264
       AAC
       YUV420P
       MAX 1080P
       ULTRAFAST
       SEGMENTS 2 SEC
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

      "-reconnect",
      "1",

      "-reconnect_streamed",
      "1",

      "-reconnect_at_eof",
      "1",

      "-reconnect_delay_max",
      "10",

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

      /* -----------------------------
         VIDEO
      ----------------------------- */

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

      /* -----------------------------
         GOP
      ----------------------------- */

      "-sc_threshold",
      "0",

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

      "-af",
      "aresample=async=1:first_pts=0",

      /* -----------------------------
         TIMESTAMPS
      ----------------------------- */

      "-avoid_negative_ts",
      "make_zero",

      /* -----------------------------
         HLS
      ----------------------------- */

      "-f",
      "hls",

      "-hls_time",
      "2",

      "-hls_list_size",
      "0",

      "-hls_playlist_type",
      "event",

      "-hls_flags",
      "independent_segments",

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
      `[VOD HLS PROFILE] id=${id} codec=h264 preset=ultrafast max=1920x1080 hls=2s audio=aac128`
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

    ff.stderr.on(
      "data",
      (chunk) => {
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

        if (
          /error|failed|invalid|unsupported|could not|conversion failed|no space|killed/i.test(
            text
          )
        ) {
          console.warn(
            `[VOD HLS FFMPEG] type=${type} id=${id} ${text.trim()}`
          );
        }
      }
    );

    ff.on(
      "error",
      (error) => {
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
        () => stderr,
        START_TIMEOUT
      );
    } catch (
      error
    ) {
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
          recursive: true,
          force: true,
        }
      ).catch(
        () => {}
      );

      throw error;
    }

    /* =====================================================
       HLS READY

       IMPORTANT :
       NE JAMAIS UTILISER req.url ICI.

       Railway peut exposer req.url avec :
       localhost:8080

       La playlist publique doit TOUJOURS utiliser :
       RAILWAY_PUBLIC_URL
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
       LOG FINAL
    ===================================================== */

    console.log(
      `[VOD HLS READY] type=${type} id=${id} session=${sessionId}`
    );

    console.log(
      `[VOD HLS MANIFEST] session=${sessionId} -> ${sessionPlaylistUrl.toString()}`
    );

    /* =====================================================
       REDIRECT PUBLIC RAILWAY

       Exemple attendu :

       https://xxxx.up.railway.app/api/vod-hls?s=...
    ===================================================== */

    return NextResponse.redirect(
      sessionPlaylistUrl,
      302
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
