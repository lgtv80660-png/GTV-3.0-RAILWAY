import { requireSession } from "@/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "ID manquant" }, { status: 400 });
    }

    let creds: any;
    try {
      creds = await requireSession();
    } catch (e) {
      return NextResponse.json(
        { error: "Session non authentifiee" },
        { status: 401 }
      );
    }

    const host = (creds?.baseUrl || creds?.url || creds?.serverUrl || "").replace(/\/+$/, "");
    const u = creds?.username || creds?.user || "";
    const p = creds?.password || creds?.pass || "";

    if (!host || !u || !p) {
      return NextResponse.json(
        { error: "Identifiants IPTV incomplets." },
        { status: 400 }
      );
    }

    const targetUrl = `${host}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}&action=get_vod_info&vod_id=${id}`;

    const res = await fetch(targetUrl, {
      headers: { "User-Agent": "VLC/3.0.20 LibVLC/3.0.20" },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Erreur serveur IPTV (${res.status})` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("Erreur movie-info:", err);
    return NextResponse.json({ error: err.message || "Erreur interne" }, { status: 500 });
  }
}
