import { requireSession } from "@/lib/session";
import { buildStreamUrl } from "@/lib/xtream/urls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA = "VLC/3.0.20 LibVLC/3.0.20";

function encodeSegment(url: string) {
  return Buffer.from(url, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function GET(req: Request) {
  let creds: any;

  try {
    creds = await requireSession();
  } catch {
    return new Response("Not authenticated", {
      status: 401,
    });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return new Response("Missing Live Stream ID", {
      status: 400,
    });
  }

  const upstreamUrl = buildStreamUrl(
    creds,
    "live",
    id,
    "ts"
  );

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": UA,
        Accept: "*/*",
      },
      redirect: "follow",
      cache: "no-store",
    });

    if (!upstreamRes.ok) {
      return new Response(
        `Upstream Live Error: ${upstreamRes.status}`,
        {
          status: 502,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const playlist = await upstreamRes.text();

    if (!playlist) {
      return new Response(
        "HLS Proxy Error: empty playlist",
        {
          status: 502,
        }
      );
    }

    const baseUrl =
      upstreamRes.url || upstreamUrl;

    const rewritten = playlist.replace(
      /^(?!#)(.+)$/gm,
      (line) => {
        const trimmed = line.trim();

        if (!trimmed) {
          return line;
        }

        try {
          const absolute = new URL(
            trimmed,
            baseUrl
          ).toString();

          const token =
            encodeSegment(absolute);

          return `/api/hlsseg?t=${token}`;
        } catch {
          return line;
        }
      }
    );

    return new Response(rewritten, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.apple.mpegurl",
        "Cache-Control":
          "no-cache, no-store, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    return new Response(
      `HLS Proxy Error: ${
        error?.message || "fetch failed"
      }`,
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
