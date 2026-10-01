import {
  open,
  stat,
} from "node:fs/promises";

import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT =
  "/tmp/gtv-vod-hls";

const HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate",

  Pragma:
    "no-cache",

  Expires:
    "0",

  "Access-Control-Allow-Origin":
    "*",

  "Access-Control-Allow-Headers":
    "Range, Content-Type",

  "Access-Control-Expose-Headers":
    "Content-Length, Content-Range, Accept-Ranges",

  "X-Content-Type-Options":
    "nosniff",

  "Accept-Ranges":
    "bytes",
};

function safeSession(
  value: string
) {
  return value.replace(
    /[^a-zA-Z0-9_-]/g,
    ""
  );
}

function safeFile(
  value: string
) {
  const file =
    path.basename(value);

  if (
    !/^seg-\d+\.ts$/i.test(
      file
    )
  ) {
    return "";
  }

  return file;
}

async function waitForStableFile(
  file: string,
  timeout = 20_000
) {
  const started =
    Date.now();

  let previousSize = -1;
  let stableChecks = 0;

  while (
    Date.now() - started <
    timeout
  ) {
    try {
      const info =
        await stat(file);

      if (info.size > 0) {
        if (
          info.size ===
          previousSize
        ) {
          stableChecks += 1;
        } else {
          previousSize =
            info.size;

          stableChecks = 0;
        }

        /*
         * FFmpeg utilise temp_file.
         *
         * Normalement le .ts final est déjà complet
         * au moment du rename.
         *
         * Ces deux contrôles évitent néanmoins
         * d'envoyer à Safari un fichier encore instable.
         */
        if (
          stableChecks >= 1
        ) {
          return info;
        }
      }
    } catch {}

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          75
        )
    );
  }

  throw new Error(
    "Segment non disponible"
  );
}

function parseRange(
  rangeHeader: string | null,
  size: number
) {
  if (!rangeHeader) {
    return null;
  }

  const match =
    /^bytes=(\d*)-(\d*)$/i.exec(
      rangeHeader.trim()
    );

  if (!match) {
    return null;
  }

  let start =
    match[1]
      ? Number(
          match[1]
        )
      : 0;

  let end =
    match[2]
      ? Number(
          match[2]
        )
      : size - 1;

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  ) {
    return null;
  }

  start =
    Math.max(
      0,
      Math.floor(start)
    );

  end =
    Math.min(
      size - 1,
      Math.floor(end)
    );

  if (
    start > end ||
    start >= size
  ) {
    return {
      invalid: true as const,
      start,
      end,
    };
  }

  return {
    invalid: false as const,
    start,
    end,
  };
}

export async function GET(
  req: Request
) {
  let handle:
    Awaited<
      ReturnType<
        typeof open
      >
    > | null = null;

  try {
    const {
      searchParams,
    } = new URL(req.url);

    const rawSession =
      searchParams.get("s") ||
      "";

    const rawFile =
      searchParams.get("f") ||
      "";

    const session =
      safeSession(
        rawSession
      );

    const file =
      safeFile(
        rawFile
      );

    if (
      !session ||
      !file ||
      session !==
        rawSession
    ) {
      return new Response(
        "Paramètres segment invalides",
        {
          status: 400,
          headers:
            HEADERS,
        }
      );
    }

    const sessionDir =
      path.join(
        ROOT,
        session
      );

    const target =
      path.join(
        sessionDir,
        file
      );

    if (
      !target.startsWith(
        sessionDir +
          path.sep
      )
    ) {
      return new Response(
        "Chemin invalide",
        {
          status: 400,
          headers:
            HEADERS,
        }
      );
    }

    let info;

    try {
      info =
        await waitForStableFile(
          target
        );
    } catch {
      console.warn(
        `[VOD HLS SEG WAIT] session=${session} file=${file}`
      );

      return new Response(
        "Segment non disponible",
        {
          status: 404,
          headers:
            HEADERS,
        }
      );
    }

    const size =
      info.size;

    const range =
      parseRange(
        req.headers.get(
          "range"
        ),
        size
      );

    if (
      range?.invalid
    ) {
      return new Response(
        null,
        {
          status: 416,

          headers: {
            ...HEADERS,

            "Content-Range":
              `bytes */${size}`,
          },
        }
      );
    }

    handle =
      await open(
        target,
        "r"
      );

    /*
     * Safari peut demander un Range.
     */
    if (
      range &&
      !range.invalid
    ) {
      const length =
        range.end -
        range.start +
        1;

      const buffer =
        Buffer.allocUnsafe(
          length
        );

      const result =
        await handle.read(
          buffer,
          0,
          length,
          range.start
        );

      const data =
        result.bytesRead ===
        length
          ? buffer
          : buffer.subarray(
              0,
              result.bytesRead
            );

      await handle.close();
      handle = null;

      console.log(
        `[VOD HLS SEG] session=${session} file=${file} range=${range.start}-${range.end}/${size}`
      );

      return new Response(
        data,
        {
          status: 206,

          headers: {
            ...HEADERS,

            "Content-Type":
              "video/mp2t",

            "Content-Length":
              String(
                data.byteLength
              ),

            "Content-Range":
              `bytes ${range.start}-${range.start + data.byteLength - 1}/${size}`,
          },
        }
      );
    }

    const buffer =
      Buffer.allocUnsafe(
        size
      );

    const result =
      await handle.read(
        buffer,
        0,
        size,
        0
      );

    const data =
      result.bytesRead ===
      size
        ? buffer
        : buffer.subarray(
            0,
            result.bytesRead
          );

    await handle.close();
    handle = null;

    console.log(
      `[VOD HLS SEG] session=${session} file=${file} bytes=${data.byteLength}`
    );

    return new Response(
      data,
      {
        status: 200,

        headers: {
          ...HEADERS,

          "Content-Type":
            "video/mp2t",

          "Content-Length":
            String(
              data.byteLength
            ),
        },
      }
    );
  } catch (
    error: any
  ) {
    if (handle) {
      await handle
        .close()
        .catch(
          () => {}
        );
    }

    console.error(
      "[VOD-HLS-SEG]",
      error
    );

    return new Response(
      `Erreur segment HLS: ${
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

export async function HEAD(
  req: Request
) {
  try {
    const {
      searchParams,
    } = new URL(req.url);

    const rawSession =
      searchParams.get("s") ||
      "";

    const rawFile =
      searchParams.get("f") ||
      "";

    const session =
      safeSession(
        rawSession
      );

    const file =
      safeFile(
        rawFile
      );

    if (
      !session ||
      !file ||
      session !==
        rawSession
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

    const sessionDir =
      path.join(
        ROOT,
        session
      );

    const target =
      path.join(
        sessionDir,
        file
      );

    if (
      !target.startsWith(
        sessionDir +
          path.sep
      )
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

    const info =
      await waitForStableFile(
        target
      );

    return new Response(
      null,
      {
        status: 200,

        headers: {
          ...HEADERS,

          "Content-Type":
            "video/mp2t",

          "Content-Length":
            String(
              info.size
            ),
        },
      }
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
}
