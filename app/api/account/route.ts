import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const c = await requireSession();

    if (!c.serverUrl || !c.username || !c.password) {
      return NextResponse.json({ ok: false, error: "Session incomplete" }, { status: 401 });
    }

    const base = c.serverUrl.replace(/\/+$/, "");
    const params = new URLSearchParams({
      username: c.username,
      password: c.password,
    });

    const response = await fetch(`${base}/player_api.php?${params.toString()}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false }, { status: response.status });
    }

    const data = await response.json();
    const user = data?.user_info ?? {};

    return NextResponse.json({
      ok: true,
      username: user.username ?? c.username,
      status: user.status ?? null,
      expDate: user.exp_date ?? null,
      maxConnections: user.max_connections ?? null,
      activeConnections: user.active_cons ?? null,
    });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
