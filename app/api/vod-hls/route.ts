import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { requireSession } from "@/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const RAILWAY_URL = (
  process.env.RAILWAY_PUBLIC_URL || ""
).replace(/\/+$/, "");

const ROOT = "/tmp/gtv-vod-hls";

const HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
  "Access-Control-Allow-Origin": "*",
};

function cleanHost(value: string) {
  return String(value || "").replace(/\/+$/, "");
}

function safe(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
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
  timeout = 30_000
) {
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (await exists(playlist)) {
      try {
        const content = await readFile(
          playlist,
          "utf8"
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
      setTimeout(resolve, 150)
    );
  }

  throw new Error(
    "Timeout génération playlist HLS"
  );
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const { searchParams } = url;

    const type =
      searchParams.get("type") === "series"
        ? "series"
        : "movie";

    const id = searchParams.get("id");

    const ext =
      (
        searchParams.get("ext") ||
        "mkv"
      )
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "") ||
      "mkv";

    const rawSeek = Number(
      searchParams.get("t") || 0
    );

    const seek = Number.isFinite(rawSeek)
      ? Math.max(0, Math.floor(rawSeek))
      : 0;

    if (!id) {
      return new Response("ID manquant", {
        status: 400,
        headers: HEADERS,
      });
    }

    /*
     * Deuxième appel direct Railway.
     */
    const directHost =
      searchParams.get("_h");

    const directUser =
      searchParams.get("_u");

    const directPass =
      searchParams.get("_p");

    /*
     * Premier appel depuis l'application.
     */
    if (
      !directHost ||
      !directUser ||
      !directPass
    ) {
      let session: any;

      try {
        session = await requireSession();
      } catch {
        return new Response(
          "Non autorisé",
          {
            status: 401,
            headers: HEADERS,
          }
        );
      }

      const host = cleanHost(
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
            headers: HEADERS,
          }
        );
      }

      if (!RAILWAY_URL) {
        return new Response(
          "RAILWAY_PUBLIC_URL manquante",
          {
            status: 500,
            headers: HEADERS,
          }
        );
      }

      const target = new URL(
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

      if (seek > 0) {
        target.searchParams.set(
          "t",
          String(seek)
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
        `[VOD HLS REDIRECT] ${type} id=${id} seek=${seek}`
      );

      return NextResponse.redirect(
        target,
        302
      );
    }

    /*
     * Railway direct.
     */
    const host = cleanHost(directHost);
    const username = directUser;
    const password = directPass;

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
        }
      );
    }

    const folder =
      type === "series"
        ? "series"
        : "movie";

    const inputUrl =
      `${host}/${folder}/` +
      `${encodeURIComponent(username)}/` +
      `${encodeURIComponent(password)}/` +
      `${encodeURIComponent(id)}.${ext}`;

    /*
     * Une session HLS unique.
     */
    const sessionId = safe(
      crypto.randomUUID()
    );

    const dir = path.join(
      ROOT,
      sessionId
    );

    await mkdir(dir, {
      recursive: true,
    });

    const playlist = path.join(
      dir,
      "index.m3u8"
    );

    const segmentPattern = path.join(
      dir,
      "seg-%06d.ts"
    );

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
       * Resume / seek.
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
       * Première vidéo + premier audio.
       */
      "-map",
      "0:v:0?",

      "-map",
      "0:a:0?",

      /*
       * APPLE VIDEO
       *
       * On ne fait PAS copy.
       * Le but est précisément de normaliser
       * Dolby Vision / HEVC / profils exotiques
       * vers H.264 Safari-compatible.
       */
      "-c:v",
      "libx264",

      "-preset",
      "veryfast",

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
       * GOP adapté à HLS.
       */
      "-sc_threshold",
      "0",

      "-force_key_frames",
      "expr:gte(t,n_forced*4)",

      /*
       * Apple audio.
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
       * HLS VOD.
       */
      "-f",
      "hls",

      "-hls_time",
      "4",

      /*
       * 0 = conserver tous les segments
       * nécessaires au VOD.
       */
      "-hls_list_size",
      "0",

      "-hls_playlist_type",
      "event",

      "-hls_flags",
      "independent_segments",

      "-hls_segment_filename",
      segmentPattern,

      playlist,
    ];

    console.log(
      `[VOD HLS START] type=${type} id=${id} ext=${ext} seek=${seek} session=${sessionId}`
    );

    const ff = spawn(
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
        stderr += chunk.toString();

        if (stderr.length > 12000) {
          stderr = stderr.slice(
            -12000
          );
        }
      }
    );

    ff.on(
      "error",
      (error) => {
        console.error(
          `[VOD HLS FFMPEG ERROR] type=${type} id=${id}`,
          error
        );
      }
    );

    ff.on(
      "close",
      (code, signal) => {
        console.log(
          `[VOD HLS CLOSED] type=${type} id=${id} session=${sessionId} code=${code} signal=${signal}`
        );

        if (stderr.trim()) {
          console.log(
            `[VOD HLS STDERR] type=${type} id=${id}\n${stderr}`
          );
        }
      }
    );

    /*
     * On attend uniquement les premiers segments.
     * FFmpeg continue ensuite en arrière-plan.
     */
    let manifest: string;

    try {
      manifest =
        await waitForPlaylist(
          playlist
        );
    } catch (error) {
      try {
        ff.kill("SIGKILL");
      } catch {}

      await rm(dir, {
        recursive: true,
        force: true,
      }).catch(() => {});

      throw error;
    }

    /*
     * Réécriture des segments :
     *
     * seg-000001.ts
     *
     * devient
     *
     * /api/vod-hls-seg?s=SESSION&f=seg-000001.ts
     */
    manifest = manifest.replace(
      /^(?!#)(.+\.ts)$/gm,
      (line) => {
        const file =
          path.basename(
            line.trim()
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

    /*
     * Nettoyage de sécurité.
     *
     * Le process Railway garde la session
     * assez longtemps pour la lecture.
     */
    const cleanup = setTimeout(
      async () => {
        try {
          if (!ff.killed) {
            ff.kill("SIGKILL");
          }
        } catch {}

        await rm(dir, {
          recursive: true,
          force: true,
        }).catch(() => {});

        console.log(
          `[VOD HLS CLEANUP] session=${sessionId}`
        );
      },
      4 * 60 * 60 * 1000
    );

    cleanup.unref?.();

    return new Response(
      manifest,
      {
        status: 200,

        headers: {
          ...HEADERS,

          "Content-Type":
            "application/vnd.apple.mpegurl; charset=utf-8",

          "X-GTV-Mode":
            "apple-hls",

          "X-GTV-Session":
            sessionId,

          "X-GTV-Seek":
            String(seek),
        },
      }
    );
  } catch (error: any) {
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
        headers: HEADERS,
      }
    );
  }
}
