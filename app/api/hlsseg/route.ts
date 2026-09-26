$code = @'
import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "VLC/3.0.20 LibVLC/3.0.20";

function getSecret() {
  const secret =
    process.env
      .HLS_SEGMENT_SECRET;

  if (!secret) {
    throw new Error(
      "HLS_SEGMENT_SECRET is not configured"
    );
  }

  return secret;
}

function getRailwayBase() {
  const base =
    process.env
      .RAILWAY_PUBLIC_URL;

  if (!base) {
    throw new Error(
      "RAILWAY_PUBLIC_URL is not configured"
    );
  }

  return base.replace(
    /\/+$/,
    ""
  );
}

function decodeTarget(
  token: string
) {
  return Buffer.from(
    token,
    "base64url"
  ).toString(
    "utf8"
  );
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
    .digest(
      "base64url"
    );
}

function validSignature(
  token: string,
  expiresAt: number,
  signature: string
) {
  if (
    !signature ||
    expiresAt <
      Math.floor(
        Date.now() /
          1000
      )
  ) {
    return false;
  }

  const expected =
    signToken(
      token,
      expiresAt
    );

  try {
    const a =
      Buffer.from(
        expected
      );

    const b =
      Buffer.from(
        signature
      );

    if (
      a.length !==
      b.length
    ) {
      return false;
    }

    return timingSafeEqual(
      a,
      b
    );
  } catch {
    return false;
  }
}

function createSignedUrl(
  targetUrl: string
) {
  const token =
    Buffer.from(
      targetUrl,
      "utf8"
    ).toString(
      "base64url"
    );

  const expiresAt =
    Math.floor(
      Date.now() /
        1000
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
    String(
      expiresAt
    )
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

        return `URI="${createSignedUrl(
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
        trimmed.startsWith(
          "#"
        )
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

        return createSignedUrl(
          absolute
        );
      } catch {
        return line;
      }
    })
    .join("\n");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":
      "*",

    "Access-Control-Allow-Methods":
      "GET,HEAD,OPTIONS",

    "Access-Control-Allow-Headers":
      "Range,Content-Type",

    "Cross-Origin-Resource-Policy":
      "cross-origin",
  };
}

export async function OPTIONS() {
  return new Response(
    null,
    {
      status: 204,
      headers:
        corsHeaders(),
    }
  );
}

export async function GET(
  req: Request
) {
  try {
    const url =
      new URL(
        req.url
      );

    const token =
      url.searchParams.get(
        "t"
      );

    const expiresRaw =
      url.searchParams.get(
        "e"
      );

    const signature =
      url.searchParams.get(
        "s"
      );

    if (
      !token ||
      !expiresRaw ||
      !signature
    ) {
      return new Response(
        "Invalid segment authorization",
        {
          status: 401,
          headers:
            corsHeaders(),
        }
      );
    }

    const expiresAt =
      Number(
        expiresRaw
      );

    if (
      !Number.isFinite(
        expiresAt
      ) ||
      !validSignature(
        token,
        expiresAt,
        signature
      )
    ) {
      return new Response(
        "Expired or invalid segment authorization",
        {
          status: 401,
          headers:
            corsHeaders(),
        }
      );
    }

    let targetUrl:
      string;

    try {
      targetUrl =
        decodeTarget(
          token
        );
    } catch {
      return new Response(
        "Invalid segment token",
        {
          status: 400,
          headers:
            corsHeaders(),
        }
      );
    }

    const target =
      new URL(
        targetUrl
      );

    if (
      target.protocol !==
        "http:" &&
      target.protocol !==
        "https:"
    ) {
      return new Response(
        "Invalid upstream protocol",
        {
          status: 400,
          headers:
            corsHeaders(),
        }
      );
    }

    const requestHeaders =
      new Headers();

    requestHeaders.set(
      "User-Agent",
      UA
    );

    requestHeaders.set(
      "Accept",
      "*/*"
    );

    const range =
      req.headers.get(
        "range"
      );

    if (range) {
      requestHeaders.set(
        "Range",
        range
      );
    }

    const upstreamRes =
      await fetch(
        targetUrl,
        {
          headers:
            requestHeaders,

          redirect:
            "follow",

          cache:
            "no-store",

          signal:
            AbortSignal.timeout(
              15000
            ),
        }
      );

    if (
      !upstreamRes.ok ||
      !upstreamRes.body
    ) {
      return new Response(
        "Segment stream unavailable",
        {
          status:
            upstreamRes.status ||
            502,

          headers:
            corsHeaders(),
        }
      );
    }

    const contentType =
      upstreamRes.headers.get(
        "content-type"
      ) || "";

    const finalUrl =
      upstreamRes.url ||
      targetUrl;

    const pathname =
      (() => {
        try {
          return new URL(
            finalUrl
          ).pathname.toLowerCase();
        } catch {
          return "";
        }
      })();

    const isPlaylist =
      contentType
        .toLowerCase()
        .includes(
          "mpegurl"
        ) ||
      pathname.endsWith(
        ".m3u8"
      );

    if (isPlaylist) {
      const text =
        await upstreamRes.text();

      const rewritten =
        rewritePlaylist(
          text,
          finalUrl
        );

      return new Response(
        rewritten,
        {
          status: 200,

          headers: {
            ...corsHeaders(),

            "Content-Type":
              "application/vnd.apple.mpegurl; charset=utf-8",

            "Cache-Control":
              "private, no-cache, no-store",
          },
        }
      );
    }

    const headers =
      new Headers(
        corsHeaders()
      );

    headers.set(
      "Content-Type",
      contentType ||
        "video/mp2t"
    );

    headers.set(
      "Cache-Control",
      "public, max-age=30"
    );

    const contentLength =
      upstreamRes.headers.get(
        "content-length"
      );

    if (contentLength) {
      headers.set(
        "Content-Length",
        contentLength
      );
    }

    const contentRange =
      upstreamRes.headers.get(
        "content-range"
      );

    if (contentRange) {
      headers.set(
        "Content-Range",
        contentRange
      );
    }

    const acceptRanges =
      upstreamRes.headers.get(
        "accept-ranges"
      );

    if (acceptRanges) {
      headers.set(
        "Accept-Ranges",
        acceptRanges
      );
    }

    return new Response(
      upstreamRes.body,
      {
        status:
          upstreamRes.status,

        headers,
      }
    );
  } catch (err: any) {
    console.error(
      "[HLS SEGMENT]",
      err
    );

    return new Response(
      `Segment Proxy Error: ${
        err?.message ||
        "fetch failed"
      }`,
      {
        status: 502,
        headers:
          corsHeaders(),
      }
    );
  }
}
'@

Set-Content `
  ".\app\api\hlsseg\route.ts" `
  -Value $code `
  -Encoding utf8
