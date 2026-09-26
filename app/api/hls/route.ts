$code = @'
import { createHmac } from "node:crypto";

import { requireSession } from "@/lib/session";
import { buildStreamUrl } from "@/lib/xtream/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";

function getSecret() {
  const secret =
    process.env.HLS_SEGMENT_SECRET;

  if (!secret) {
    throw new Error(
      "HLS_SEGMENT_SECRET is not configured"
    );
  }

  return secret;
}

function getRailwayBase() {
  const base =
    process.env.RAILWAY_PUBLIC_URL;

  if (!base) {
    throw new Error(
      "RAILWAY_PUBLIC_URL is not configured"
    );
  }

  return base.replace(/\/+$/, "");
}

function encodeTarget(url: string) {
  return Buffer.from(
    url,
    "utf8"
  ).toString("base64url");
}

function signToken(
  token: string,
  expiresAt: number
) {
  return createHmac(
    "sha256",
    getSecret()
  )
    .update(
      `${token}.${expiresAt}`
    )
    .digest("base64url");
}

function signedSegmentUrl(
  targetUrl: string
) {
  const token =
    encodeTarget(targetUrl);

  const expiresAt =
    Math.floor(
      Date.now() / 1000
    ) +
    20 * 60;

  const signature =
    signToken(
      token,
      expiresAt
    );

  const url =
    new URL(
      "/api/hlsseg",
      getRailwayBase()
    );

  url.searchParams.set(
    "t",
    token
  );

  url.searchParams.set(
    "e",
    String(expiresAt)
  );

  url.searchParams.set(
    "s",
    signature
  );

  return url.toString();
}

function rewriteUriAttributes(
  line: string,
  baseUrl: string
) {
  return line.replace(
    /URI="([^"]+)"/g,
    (
      _match,
      uri: string
    ) => {
      try {
        const absolute =
          new URL(
            uri,
            baseUrl
          ).toString();

        return `URI="${signedSegmentUrl(
          absolute
        )}"`;
      } catch {
        return `URI="${uri}"`;
      }
    }
  );
}

function rewritePlaylist(
  playlist: string,
  baseUrl: string
) {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed =
        line.trim();

      if (!trimmed) {
        return line;
      }

      if (
        trimmed.startsWith("#")
      ) {
        return rewriteUriAttributes(
          line,
          baseUrl
        );
      }

      try {
        const absolute =
          new URL(
            trimmed,
            baseUrl
          ).toString();

        return signedSegmentUrl(
          absolute
        );
      } catch {
        return line;
      }
    })
    .join("\n");
}

export async function GET(
  req: Request
) {
  let creds: any;

  try {
    creds =
      await requireSession();
  } catch {
    return new Response(
      "Not authenticated",
      {
        status: 401,
      }
    );
  }

  const {
    searchParams,
  } =
    new URL(req.url);

  const id =
    searchParams.get("id");

  if (!id) {
    return new Response(
      "Missing Live Stream ID",
      {
        status: 400,
      }
    );
  }

  try {
    const upstreamUrl =
      buildStreamUrl(
        creds,
        "live",
        id,
        "m3u8"
      );

    const upstreamRes =
      await fetch(
        upstreamUrl,
        {
          headers: {
            "User-Agent":
              UA,
            Accept:
              "*/*",
          },

          redirect:
            "follow",

          cache:
            "no-store",

          signal:
            AbortSignal.timeout(
              12000
            ),
        }
      );

    if (
      !upstreamRes.ok
    ) {
      return new Response(
        `Upstream Live Error: ${upstreamRes.status}`,
        {
          status: 502,
          headers: {
            "Cache-Control":
              "no-store",
          },
        }
      );
    }

    const playlistText =
      await upstreamRes.text();

    if (!playlistText) {
      return new Response(
        "HLS Proxy Error: empty playlist",
        {
          status: 502,
        }
      );
    }

    const baseUrl =
      upstreamRes.url ||
      upstreamUrl;

    const rewritten =
      rewritePlaylist(
        playlistText,
        baseUrl
      );

    return new Response(
      rewritten,
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/vnd.apple.mpegurl; charset=utf-8",

          "Cache-Control":
            "private, no-cache, no-store, must-revalidate",

          "Access-Control-Allow-Origin":
            "*",

          "Cross-Origin-Resource-Policy":
            "cross-origin",
        },
      }
    );
  } catch (err: any) {
    const detail =
      err?.cause?.code ||
      err?.cause?.message ||
      err?.message ||
      "fetch failed";

    console.error(
      "[HLS]",
      detail
    );

    return new Response(
      `HLS Proxy Error: ${detail}`,
      {
        status: 502,
        headers: {
          "Cache-Control":
            "no-store",
        },
      }
    );
  }
}
'@

Set-Content `
  ".\app\api\hls\route.ts" `
  -Value $code `
  -Encoding utf8
