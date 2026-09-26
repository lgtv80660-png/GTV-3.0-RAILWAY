import {
  NextRequest,
} from "next/server";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

const ALLOWED_HOSTS = [
  "a.espncdn.com",
  "site.api.espn.com",
  "cdn.espn.com",
  "img.sportsrc.org",
  "api.sportsrc.org",
];

function allowedHost(
  hostname: string
) {
  return ALLOWED_HOSTS.some(
    (
      host
    ) =>
      hostname ===
        host ||
      hostname.endsWith(
        `.${host}`
      )
  );
}

export async function GET(
  request: NextRequest
) {
  const requestUrl =
    new URL(
      request.url
    );

  const source =
    requestUrl.searchParams.get(
      "url"
    );

  if (!source) {
    return new Response(
      "Missing logo URL",
      {
        status: 400,
      }
    );
  }

  let target:
    URL;

  try {
    target =
      new URL(
        source
      );
  } catch {
    return new Response(
      "Invalid logo URL",
      {
        status: 400,
      }
    );
  }

  if (
    target.protocol !==
      "https:" ||
    !allowedHost(
      target.hostname
    )
  ) {
    return new Response(
      "Logo host not allowed",
      {
        status: 403,
      }
    );
  }

  const upstream =
    await fetch(
      target.toString(),
      {
        headers: {
          Accept:
            "image/avif,image/webp,image/png,image/jpeg,image/*",
        },

        next: {
          revalidate:
            604800,
        },
      }
    );

  if (!upstream.ok) {
    return new Response(
      "Logo unavailable",
      {
        status: 404,
      }
    );
  }

  const contentType =
    upstream.headers.get(
      "content-type"
    ) ||
    "image/png";

  const body =
    await upstream.arrayBuffer();

  return new Response(
    body,
    {
      status: 200,

      headers: {
        "Content-Type":
          contentType,

        "Cache-Control":
          "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      },
    }
  );
}