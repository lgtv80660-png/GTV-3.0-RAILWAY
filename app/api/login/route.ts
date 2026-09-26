import { NextResponse } from "next/server";

const XTREAM_HOST = process.env.XTREAM_SERVER_URL || "https://gmztv.vercel.app";

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "Veuillez saisir votre identifiant et mot de passe" },
        { status: 400 }
      );
    }

    const cleanUrl = XTREAM_HOST.replace(/\/+$/, "");

    // Vérification auprès de l'API IPTV
    const testRes = await fetch(
      `${cleanUrl}/player_api.php?username=${encodeURIComponent(
        username
      )}&password=${encodeURIComponent(password)}`
    );

    if (!testRes.ok) {
      return NextResponse.json(
        { error: "Impossible de contacter le serveur IPTV" },
        { status: 500 }
      );
    }

    const data = await testRes.json();

    if (!data.user_info || data.user_info.auth === 0) {
      return NextResponse.json(
        { error: "Identifiant ou mot de passe incorrect" },
        { status: 401 }
      );
    }

    // Création du cookie sécurisé gtv_session
    const response = NextResponse.json({ success: true, user: data.user_info });

    const sessionData = JSON.stringify({
      serverUrl: cleanUrl,
      username,
      password,
    });

    response.cookies.set("gtv_session", sessionData, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 jours
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: "Erreur de connexion au serveur" },
      { status: 500 }
    );
  }
}