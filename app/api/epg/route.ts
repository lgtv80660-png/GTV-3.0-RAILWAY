import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const c = await requireSession();

    if (!c.serverUrl || !c.username || !c.password) {
      return NextResponse.json({ error: "Session incomplete" }, { status: 401 });
    }

    const streamId = req.nextUrl.searchParams.get("stream_id");
    const limit = req.nextUrl.searchParams.get("limit") || "8";

    if (!streamId) {
      return NextResponse.json({ error: "Missing stream_id" }, { status: 400 });
    }

    const params = new URLSearchParams({
      username: c.username,
      password: c.password,
      action: "get_short_epg",
      stream_id: streamId,
      limit,
    });

    const base = c.serverUrl.replace(/\/+$/, "");
    const response = await fetch(`${base}/player_api.php?${params.toString()}`, {
      cache: "no-store",
    });

    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
