import { spawn } from "node:child_process";
import { requireSession } from "@/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";

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
  Pragma: "no-cache",
  Expires: "0",
  "Access-Control-Allow-Origin": "*",
  "X-Accel-Buffering": "no",
};

function cleanHost(
  value: string
) {
  return String(value || "").replace(
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

export async function GET(
  req: Request
) {
  try {
    const url =
      new URL(req.url);

    const {
      searchParams,
    } = url;

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
        .replace(
          /[^a-z0-9]/g,
          ""
        ) || "mkv";

    const rawSeek =
      Number(
        searchParams.get("t") ||
        0
      );

    const seek =
      Number.isFinite(rawSeek)
        ? Math.max(
            0,
            Math.floor(rawSeek)
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

    const directHost =
      searchParams.get("_h");

    const directUser =
      searchParams.get("_u");

    const directPass =
      searchParams.get("_p");

    let host = "";
    let username = "";
    let password = "";

    /*
     * PREMIER APPEL:
     * session Cloudflare/Railway.
     *
     * On redirige ensuite le navigateur
     * directement vers Railway pour que
     * le gros flux VOD ne traverse pas
     * Cloudflare.
     */
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

      return NextResponse.redirect(
        target,
        302
      );
    }

    /*
     * SECOND APPEL:
     * navigateur -> Railway direct.
     */

    host =
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

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",

      "-user_agent",
      UA,

      "-rw_timeout",
      "10000000",

      "-fflags",
      "+genpts+discardcorrupt",

      /*
       * Réduit le temps avant démarrage.
       */
      "-analyzeduration",
      "2000000",

      "-probesize",
      "3000000",

      ...(seek > 0
        ? [
            "-ss",
            String(seek),
          ]
        : []),

      "-i",
      inputUrl,

      "-map",
      "0:v:0",

      "-map",
      "0:a:0?",

      /*
       * VIDEO COPY:
       * pas de réencodage vidéo.
       */
      "-c:v",
      "copy",

      /*
       * AUDIO AAC navigateur.
       */
      "-c:a",
      "aac",

      "-ac",
      "2",

      "-b:a",
      "128k",

      "-af",
      "aresample=async=1:first_pts=0",

      "-avoid_negative_ts",
      "make_zero",

      /*
       * MP4 fragmenté immédiatement lisible.
       */
      "-movflags",
      "frag_keyframe+empty_moov+default_base_moof",

      "-f",
      "mp4",

      "pipe:1",
    ];

    console.log(
      `[VOD] ${type} id=${id} ext=${ext} seek=${seek}`
    );

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

    let stderr = "";

    ff.stderr.on(
      "data",
      (chunk) => {
        stderr +=
          chunk.toString();

        if (
          stderr.length >
          8000
        ) {
          stderr =
            stderr.slice(-8000);
        }
      }
    );

    ff.on(
      "close",
      (code, signal) => {
        if (
          code !== 0 &&
          code !== null &&
          signal !==
            "SIGKILL"
        ) {
          console.error(
            "[VOD FFMPEG]",
            code,
            signal,
            stderr
          );
        }
      }
    );

    const stream =
      new ReadableStream<
        Uint8Array
      >({
        start(controller) {
          ff.stdout.on(
            "data",
            (chunk: Buffer) => {
              try {
                controller.enqueue(
                  new Uint8Array(
                    chunk
                  )
                );
              } catch {
                killProcess(ff);
              }
            }
          );

          ff.stdout.on(
            "end",
            () => {
              try {
                controller.close();
              } catch {}
            }
          );

          ff.stdout.on(
            "error",
            (error) => {
              try {
                controller.error(
                  error
                );
              } catch {}

              killProcess(ff);
            }
          );

          ff.on(
            "error",
            (error) => {
              try {
                controller.error(
                  error
                );
              } catch {}
            }
          );
        },

        cancel() {
          killProcess(ff);
        },
      });

    const abort =
      () => {
        killProcess(ff);
      };

    if (req.signal.aborted) {
      abort();
    } else {
      req.signal.addEventListener(
        "abort",
        abort,
        {
          once: true,
        }
      );
    }

    return new Response(
      stream,
      {
        status: 200,
        headers: {
          ...HEADERS,

          "Content-Type":
            "video/mp4",

          "Content-Disposition":
            "inline",

          "Accept-Ranges":
            "none",

          "X-GTV-Mode":
            "fast-remux",

          "X-GTV-Seek":
            String(seek),
        },
      }
    );
  } catch (error: any) {
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
        status: 500,
        headers: HEADERS,
      }
    );
  }
}
