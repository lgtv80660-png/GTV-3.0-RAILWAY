import {
  readFile,
  stat,
} from "node:fs/promises";

import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT =
  "/tmp/gtv-vod-hls";

const HEADERS = {
  "Cache-Control":
    "private, max-age=3600",

  "Access-Control-Allow-Origin":
    "*",

  "X-Content-Type-Options":
    "nosniff",
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

async function waitForFile(
  file: string,
  timeout = 15_000
) {
  const started =
    Date.now();

  while (
    Date.now() - started <
    timeout
  ) {
    try {
      const info =
        await stat(file);

      if (info.size > 0) {
        return;
      }
    } catch {}

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          100
        )
    );
  }

  throw new Error(
    "Segment non disponible"
  );
}

export async function GET(
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
      !file
    ) {
      return new Response(
        "Paramètres segment invalides",
        {
          status: 400,
          headers: HEADERS,
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

    /*
     * Protection path traversal.
     */
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
          headers: HEADERS,
        }
      );
    }

    try {
      await waitForFile(
        target
      );
    } catch {
      return new Response(
        "Segment non disponible",
        {
          status: 404,
          headers: HEADERS,
        }
      );
    }

    const data =
      await readFile(
        target
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
  } catch (error: any) {
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
        headers: HEADERS,
      }
    );
  }
}
