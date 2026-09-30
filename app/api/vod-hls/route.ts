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

const UA = "VLC/3.0.20 LibVLC/3.0.20";
const FFMPEG =
  process.env.FFMPEG_PATH || "ffmpeg";

const RAILWAY_URL = (
  process.env.RAILWAY_PUBLIC_URL || ""
).replace(/\/+$/, "");

const ROOT = "/tmp/gtv-vod-hls";

const HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Access-Control-Allow-Origin": "*",
};

function cleanHost(value: string) {
  return String(value || "").replace(/\/+$/, "");
}

function safe(value: string) {
  return value.replace(
    /[^a-zA-Z0-9_-]/g,
    "",
  );
}

function validSessionId(value: string) {
  return /^[a-zA-Z0-9_-]{20,80}$/.test(
    value,
  );
}

async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function waitForPlaylist(
  playlist: string,
  timeout = 30_000,
) {
  const started = Date.now();

  while (
    Date.now() - started < timeout
  ) {
    if (await exists(playlist)) {
      try {
        const content =
          await readFile(
            playlist,
            "utf8",
          );

        if (
          content.includes("#EXTM3U") &&
          content.includes("#EXTINF")
        ) {
          return content;
        }
      } catch {}
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 150),
    );
  }

  throw new Error(
    "Timeout génération playlist HLS",
  );
}

/*
 * Réécrit :
 *
 * seg-000001.ts
 *
 * vers :
 *
 * /api/vod-hls-seg?s=SESSION&f=seg-000001.ts
 */
function rewriteManifest(
  manifest: string,
  sessionId: string,
) {
  return manifest.replace(
    /^(?!#)(.+\.ts)(?:\?.*)?$/gm,
    (line) => {
      const cleanLine =
        line.trim().split("?")[0];

      const file =
        path.basename(cleanLine);

      return (
        `/api/vod-hls-seg` +
        `?s=${encodeURIComponent(
          sessionId,
        )}` +
        `&f=${encodeURIComponent(
          file,
        )}`
      );
    },
  );
}

/*
 * ============================================================
 * GET
 * ============================================================
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { searchParams } = url;

    /*
     * ========================================================
     * MODE 1
     *
     * Safari recharge une session HLS existante.
     *
     * /api/vod-hls?s=SESSION
     *
     * IMPORTANT :
     * on ne démarre PAS un nouveau FFmpeg.
     * On relit le index.m3u8 de la même session.
     * ========================================================
     */

    const requestedSession =
      searchParams.get("s");

    if (requestedSession) {
      const sessionId =
        safe(requestedSession);

      if (
        !sessionId ||
        !validSessionId(sessionId) ||
        sessionId !== requestedSession
      ) {
        return new Response(
          "Session HLS invalide",
          {
            status: 400,
            headers: HEADERS,
          },
        );
      }

      const dir = path.join(
        ROOT,
        sessionId,
      );

      const playlist = path.join(
        dir,
        "index.m3u8",
      );

      /*
       * Safari peut demander le manifest
       * pendant que FFmpeg est en train
       * d'écrire le prochain segment.
       *
       * On attend légèrement si nécessaire.
       */
      let manifest: string;

      try {
        manifest =
          await waitForPlaylist(
            playlist,
            10_000,
          );
      } catch {
        return new Response(
          "Session HLS introuvable ou expirée",
          {
            status: 404,
            headers: HEADERS,
          },
        );
      }

      manifest =
        rewriteManifest(
          manifest,
          sessionId,
        );

      console.log(
        `[VOD HLS PLAYLIST] session=${sessionId}`,
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
        },
      );
    }

    /*
     * ========================================================
     * MODE 2
     *
     * Création d'une nouvelle session.
     * ========================================================
     */

    const type =
      searchParams.get("type") ===
      "series"
        ? "series"
        : "movie";

    const id =
      searchParams.get("id");

    const ext =
      (
        searchParams.get("ext") ||
        "mkv"
      )
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") ||
      "mkv";

    const rawSeek = Number(
      searchParams.get("t") || 0,
    );

    const seek =
      Number.isFinite(rawSeek)
        ? Math.max(
            0,
            Math.floor(rawSeek),
          )
        : 0;

    if (!id) {
      return new Response(
        "ID manquant",
        {
          status: 400,
          headers: HEADERS,
        },
      );
    }

    /*
     * ========================================================
     * Premier appel :
     * application / Cloudflare
     *
     * On récupère la session Xtream,
     * puis on redirige vers Railway.
     * ========================================================
     */

    const directHost =
      searchParams.get("_h");

    const directUser =
      searchParams.get("_u");

    const directPass =
      searchParams.get("_p");

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
            headers: HEADERS,
          },
        );
      }

      const host =
        cleanHost(
          session?.baseUrl ||
            session?.url ||
            session?.serverUrl ||
            session?.host ||
            "",
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
            headers: HEADERS,
          },
        );
      }

      if (!RAILWAY_URL) {
        return new Response(
          "RAILWAY_PUBLIC_URL manquante",
          {
            status: 500,
            headers: HEADERS,
          },
        );
      }

      const target =
        new URL(
          "/api/vod-hls",
          RAILWAY_URL,
        );

      target.searchParams.set(
        "type",
        type,
      );

      target.searchParams.set(
        "id",
        id,
      );

      target.searchParams.set(
        "ext",
        ext,
      );

      if (seek > 0) {
        target.searchParams.set(
          "t",
          String(seek),
        );
      }

      target.searchParams.set(
        "_h",
        host,
      );

      target.searchParams.set(
        "_u",
        username,
      );

      target.searchParams.set(
        "_p",
        password,
      );

      console.log(
        `[VOD HLS REDIRECT] ${type} id=${id} seek=${seek}`,
      );

      return NextResponse.redirect(
        target,
        302,
      );
    }

    /*
     * ========================================================
     * Railway direct.
     * ========================================================
     */

    const host =
      cleanHost(directHost);

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
          headers: HEADERS,
        },
      );
    }

    const folder =
      type === "series"
        ? "series"
        : "movie";

    const inputUrl =
      `${host}/${folder}/` +
      `${encodeURIComponent(
        username,
      )}/` +
      `${encodeURIComponent(
        password,
      )}/` +
      `${encodeURIComponent(
        id,
      )}.${ext}`;

    /*
     * ========================================================
     * Création session HLS.
     * ========================================================
     */

    const sessionId =
      safe(
        crypto.randomUUID(),
      );

    const dir =
      path.join(
        ROOT,
        sessionId,
      );

    await mkdir(
      dir,
      {
        recursive: true,
      },
    );

    const playlist =
      path.join(
        dir,
        "index.m3u8",
      );

    const segmentPattern =
      path.join(
        dir,
        "seg-%06d.ts",
      );

    /*
     * ========================================================
     * FFmpeg
     *
     * Le but :
     *
     * Xtream
     *    ↓
     * H264 + AAC
     *    ↓
     * MPEG-TS HLS
     *    ↓
     * Safari / iPhone
     * ========================================================
     */

    const args = [
      "-hide_banner",

      "-loglevel",
      "warning",

      "-nostdin",

      /*
       * Xtream HTTP
       */
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
      "5000000",

      "-probesize",
      "5000000",

      /*
       * Resume.
       */
      ...(seek > 0
        ? [
            "-ss",
            String(seek),
          ]
        : []),

      "-i",
      inputUrl,

      /*
       * Première vidéo.
       */
      "-map",
      "0:v:0?",

      /*
       * Premier audio.
       */
      "-map",
      "0:a:0?",

      /*
       * ======================================================
       * VIDEO APPLE
       *
       * PAS de -c:v copy.
       *
       * Dolby Vision / HEVC / MKV /
       * profils non compatibles Safari
       * deviennent H264.
       * ======================================================
       */
      "-c:v",
      "libx264",

      /*
       * Railway :
       * superfast réduit fortement
       * la charge CPU par rapport
       * à veryfast.
       */
      "-preset",
      "superfast",

      "-profile:v",
      "high",

      "-level",
      "4.1",

      "-pix_fmt",
      "yuv420p",

      /*
       * Qualité.
       */
      "-crf",
      "21",

      /*
       * GOP HLS.
       */
      "-sc_threshold",
      "0",

      "-force_key_frames",
      "expr:gte(t,n_forced*4)",

      /*
       * ======================================================
       * AUDIO APPLE
       * ======================================================
       */
      "-c:a",
      "aac",

      "-ac",
      "2",

      "-b:a",
      "160k",

      "-ar",
      "48000",

      "-af",
      "aresample=async=1:first_pts=0",

      /*
       * Timestamps.
       */
      "-avoid_negative_ts",
      "make_zero",

      /*
       * ======================================================
       * HLS
       * ======================================================
       */
      "-f",
      "hls",

      "-hls_time",
      "4",

      /*
       * On garde tous les segments.
       */
      "-hls_list_size",
      "0",

      /*
       * Playlist progressive :
       * Safari la recharge pendant
       * que FFmpeg continue.
       */
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
      `[VOD HLS START] type=${type} id=${id} ext=${ext} seek=${seek} session=${sessionId}`,
    );

    /*
     * Turbopack peut afficher un warning
     * de tracing ici.
     *
     * Ce n'est pas une erreur TypeScript.
     */
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
        },
      );

    let stderr = "";

    ff.stderr.on(
      "data",
      (chunk) => {
        stderr +=
          chunk.toString();

        if (
          stderr.length >
          12000
        ) {
          stderr =
            stderr.slice(
              -12000,
            );
        }
      },
    );

    ff.on(
      "error",
      (error) => {
        console.error(
          `[VOD HLS FFMPEG ERROR] type=${type} id=${id} session=${sessionId}`,
          error,
        );
      },
    );

    ff.on(
      "close",
      (
        code,
        signal,
      ) => {
        console.log(
          `[VOD HLS CLOSED] type=${type} id=${id} session=${sessionId} code=${code} signal=${signal}`,
        );

        if (
          stderr.trim()
        ) {
          console.log(
            `[VOD HLS STDERR] type=${type} id=${id}\n${stderr}`,
          );
        }
      },
    );

    /*
     * ========================================================
     * On attend seulement que le premier
     * segment soit disponible.
     *
     * FFmpeg continue ensuite.
     * ========================================================
     */

    try {
      await waitForPlaylist(
        playlist,
        30_000,
      );
    } catch (error) {
      try {
        ff.kill(
          "SIGKILL",
        );
      } catch {}

      await rm(
        dir,
        {
          recursive: true,
          force: true,
        },
      ).catch(
        () => {},
      );

      throw error;
    }

    /*
     * ========================================================
     * IMPORTANT
     *
     * On ne renvoie PLUS directement
     * une copie du manifest.
     *
     * On redirige Safari vers :
     *
     * /api/vod-hls?s=SESSION
     *
     * Safari pourra donc recharger
     * exactement cette URL et récupérer
     * les nouveaux segments.
     * ========================================================
     */

    const sessionPlaylistUrl =
      new URL(
        "/api/vod-hls",
        req.url,
      );

    sessionPlaylistUrl.search = "";

    sessionPlaylistUrl.searchParams.set(
      "s",
      sessionId,
    );

    /*
     * ========================================================
     * Nettoyage de sécurité.
     *
     * Ne surtout pas supprimer lorsque
     * FFmpeg termine :
     * Safari peut encore avoir besoin
     * des anciens segments pour seek.
     * ========================================================
     */

    const cleanup =
      setTimeout(
        async () => {
          try {
            if (!ff.killed) {
              ff.kill(
                "SIGKILL",
              );
            }
          } catch {}

          await rm(
            dir,
            {
              recursive: true,
              force: true,
            },
          ).catch(
            () => {},
          );

          console.log(
            `[VOD HLS CLEANUP] session=${sessionId}`,
          );
        },
        4 *
          60 *
          60 *
          1000,
      );

    cleanup.unref?.();

    console.log(
      `[VOD HLS READY] type=${type} id=${id} session=${sessionId}`,
    );

    console.log(
      `[VOD HLS MANIFEST] session=${sessionId} -> ${sessionPlaylistUrl.pathname}${sessionPlaylistUrl.search}`,
    );

    /*
     * 302 vers le manifest permanent
     * de cette session.
     */
    return NextResponse.redirect(
      sessionPlaylistUrl,
      302,
    );
  } catch (error: any) {
    console.error(
      "[VOD-HLS]",
      error,
    );

    return new Response(
      `Erreur VOD HLS: ${
        error?.message ||
        "unknown"
      }`,
      {
        status: 500,
        headers: HEADERS,
      },
    );
  }
}
