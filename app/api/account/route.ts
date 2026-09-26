import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const c = await requireSession();
    const base = c.serverUrl.replace(/\/+$/, "");
    const u = `${base}/player_api.php?username=${encodeURIComponent(c.username)}&password=${encodeURIComponent(c.password)}`;
    const r = await fetch(u, { cache: "no-store" });
    if (!r.ok) return NextResponse.json({ ok:false }, { status: r.status });
    const j = await r.json(); const x = j?.user_info ?? {};
    return NextResponse.json({ ok:true, username:x.username ?? c.username, status:x.status ?? null, expDate:x.exp_date ?? null, maxConnections:x.max_connections ?? null, activeConnections:x.active_cons ?? null });
  } catch { return NextResponse.json({ ok:false }, { status:401 }); }
}
