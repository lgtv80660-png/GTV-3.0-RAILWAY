import { requireSession } from "@/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || searchParams.get("series_id");

    if (!id) {
      return NextResponse.json({ error: "ID de serie manquant" }, { status: 400 });
    }

    let creds: any;
    try {
      creds = await requireSession();
    } catch {
      return NextResponse.json({ error: "Non autorise" }, { status: 401 });
    }

    const host = (creds.baseUrl || creds.url || creds.serverUrl || "").replace(/\/+$/, "");
    const u = creds.username || creds.user || "";
    const p = creds.password || creds.pass || "";

    const targetUrl = `${host}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}&action=get_series_info&series_id=${id}`;

    const res = await fetch(targetUrl, {
      headers: { "User-Agent": "VLC/3.0.20 LibVLC/3.0.20" },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Erreur serveur IPTV" }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Erreur serveur" }, { status: 500 });
  }
}
