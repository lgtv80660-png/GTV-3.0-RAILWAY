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

/*
 * Premier segment attendu rapidement.
 *
 * 45 secondes donnent suffisamment de marge
 * pour les hosts Xtream plus lents sans
 * laisser une requête bloquée indéfiniment.
 */
const START_TIMEOUT = 45_000;

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
  timeout = START_TIMEOUT,
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
      setTimeout(resolve, 100),
    );
  }

  throw new Error(
    "Timeout génération playlist HLS",
  );
}

/*
 * Attend soit :
 *
 * - le premier segment HLS
 * - la fermeture prématurée de FFmpeg
 * - le timeout
 *
 * Cela évite d'attendre 45 secondes lorsqu'un
 * FFmpeg a déjà échoué.
 */
async function waitForHlsStartup(
  playlist: string,
  ff: ReturnType<typeof spawn>,
  getStderr: () => string,
  timeout = START_TIMEOUT,
) {
  return new Promise<string>(
    (resolve, reject) => {
      let finished = false;

      const started = Date.now();

      const finish = (
        callback: () => void,
      ) => {
        if (finished) return;

        finished = true;
        clearInterval(timer);
        callback();
      };

      const timer = setInterval(
        async () => {
          if (finished) return;

          if (
            Date.now() - started >= timeout
          ) {
            finish(() =>
              reject(
                new Error(
                  "Timeout génération playlist HLS",
                ),
              ),
            );

            return;
          }

          if (!(await exists(playlist))) {
            return;
          }

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
              finish(() =>
                resolve(content),
              );
            }
          } catch {}
        },
        100,
      );

      timer.unref?.();

      ff.once(
        "error",
        (error) => {
          finish(() =>
            reject(
              new Error(
                `FFmpeg impossible à démarrer: ${error.message}`,
              ),
            ),
          );
        },
      );

      ff.once(
        "close",
        (code, signal) => {
          if (finished) return;

          const details =
            getStderr()
              .trim()
              .slice(-5000);

          finish(() =>
            reject(
              new Error(
                [
                  "FFmpeg fermé avant création HLS.",
                  `code=${code ?? "null"}`,
                  `signal=${signal ?? "null"}`,
                  details
                    ? `stderr=${details}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" "),
              ),
            ),
          );
        },
      );
    },
  );
}

/*
 * seg-000001.ts
 *
 * devient :
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
     * Nouvelle session.
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
     * Session HLS.
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
     * FFmpeg Apple HLS
     *
     * IMPORTANT :
     *
     * - H264
     * - AAC
     * - yuv420p
     * - maximum 1080p
     * - aucun upscale
     * - preset ultrafast
     * - segments 2 secondes
     *
     * Le scale :
     *
     * 3840x2160 -> 1920x1080
     * 2560x1440 -> 1920x1080
     * 1920x1080 -> 1920x1080
     * 1280x720  -> 1280x720
     *
     * force_original_aspect_ratio=decrease
     * empêche l'upscale.
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

      /*
       * Certains MKV demandent davantage
       * d'analyse avant de trouver correctement
       * vidéo + audio.
       */
      "-analyzeduration",
      "10000000",

      "-probesize",
      "10000000",

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
       * Uniquement première vidéo + premier audio.
       *
       * Pas de subtitles.
       * Pas d'attachments MKV.
       */
      "-map",
      "0:v:0?",

      "-map",
      "0:a:0?",

      /*
       * ======================================================
       * VIDEO
       * ======================================================
       */

      "-c:v",
      "libx264",

      /*
       * Priorité à la vitesse CPU Railway.
       */
      "-preset",
      "ultrafast",

      /*
       * H264 très compatible Apple.
       */
      "-profile:v",
      "main",

      "-level:v",
      "4.1",

      "-pix_fmt",
      "yuv420p",

      /*
       * Maximum 1920x1080.
       *
       * Pas d'upscale.
       *
       * force_divisible_by=2 évite les
       * dimensions impaires incompatibles
       * avec yuv420p/libx264.
       */
      "-vf",
      "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2",

      /*
       * CRF légèrement augmenté par rapport
       * à l'ancienne valeur 21 pour réduire
       * encore la charge et le débit.
       */
      "-crf",
      "23",

      /*
       * ======================================================
       * GOP HLS 2 secondes
       * ======================================================
       */

      "-sc_threshold",
      "0",

      "-force_key_frames",
      "expr:gte(t,n_forced*2)",

      /*
       * ======================================================
       * AUDIO
       * ======================================================
       */

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

      /*
       * Premier segment plus rapide.
       */
      "-hls_time",
      "2",

      /*
       * VOD progressive.
       *
       * Safari recharge index.m3u8
       * pendant l'encodage.
       */
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
      `[VOD HLS START] type=${type} id=${id} ext=${ext} seek=${seek} session=${sessionId}`,
    );

    console.log(
      `[VOD HLS PROFILE] id=${id} codec=h264 preset=ultrafast max=1920x1080 hls=2s audio=aac128`,
    );

    /*
     * ========================================================
     * Spawn FFmpeg.
     * ========================================================
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
        const text =
          chunk.toString();

        stderr += text;

        /*
         * On garde suffisamment de stderr
         * pour diagnostiquer un échec,
         * sans remplir la RAM indéfiniment.
         */
        if (
          stderr.length >
          30000
        ) {
          stderr =
            stderr.slice(
              -30000,
            );
        }

        /*
         * Affichage immédiat des erreurs
         * réellement intéressantes.
         */
        if (
          /error|failed|invalid|unsupported|could not|conversion failed|no space|killed/i.test(
            text,
          )
        ) {
          console.warn(
            `[VOD HLS FFMPEG] type=${type} id=${id} ${text.trim()}`,
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
     * Premier segment.
     *
     * Différence importante avec l'ancienne
     * version :
     *
     * si FFmpeg ferme avant le premier segment,
     * on le sait immédiatement.
     * ========================================================
     */

    try {
      await waitForHlsStartup(
        playlist,
        ff,
        () => stderr,
        START_TIMEOUT,
      );
    } catch (error) {
      /*
       * Si FFmpeg tourne encore après timeout,
       * on l'arrête.
       *
       * Le SIGKILL qui apparaîtra alors dans
       * les logs vient explicitement de nous.
       */
      if (
        ff.exitCode === null &&
        ff.signalCode === null
      ) {
        console.error(
          `[VOD HLS STARTUP TIMEOUT] type=${type} id=${id} session=${sessionId}`,
        );

        try {
          ff.kill(
            "SIGKILL",
          );
        } catch {}
      }

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
     * HLS prêt.
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
     * Nettoyage sécurité.
     *
     * On conserve les fichiers après la fin
     * de FFmpeg pour que Safari puisse encore
     * demander les segments déjà créés.
     */
    const cleanup =
      setTimeout(
        async () => {
          try {
            if (
              ff.exitCode === null &&
              ff.signalCode === null
            ) {
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
     * Safari garde cette URL de session.
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
