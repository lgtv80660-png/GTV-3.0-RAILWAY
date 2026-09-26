import { requireSession } from "@/lib/session";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireSession();
    const { searchParams, origin } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return new Response("Missing Live Stream ID", { status: 400 });
    }

    // Redirection directe vers l'API proxy HLSSG (qui marche parfaitement pour le Live)
    return NextResponse.redirect(`${origin}/api/hlssg?id=${id}`);
  } catch (err: any) {
    return new Response(`Stream Auth Error: ${err.message}`, { status: 401 });
  }
}