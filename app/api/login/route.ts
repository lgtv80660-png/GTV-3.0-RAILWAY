import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        {
          error:
            "Veuillez saisir votre identifiant et mot de passe",
        },
        {
          status: 400,
        }
      );
    }

    const XTREAM_HOST =
      process.env.XTREAM_SERVER_URL;

    if (!XTREAM_HOST) {
      return NextResponse.json(
        {
          error:
            "XTREAM_SERVER_URL manquante sur Railway",
        },
        {
          status: 500,
        }
      );
    }

    const cleanUrl =
      XTREAM_HOST.replace(/\/+$/, "");

    const testUrl =
      new URL(
        `${cleanUrl}/player_api.php`
      );

    testUrl.searchParams.set(
      "username",
      username
    );

    testUrl.searchParams.set(
      "password",
      password
    );

    const testRes =
      await fetch(
        testUrl.toString(),
        {
          headers: {
            Accept:
              "application/json",
            "User-Agent":
              "GTV/3.0",
          },
          cache:
            "no-store",
          signal:
            AbortSignal.timeout(
              15000
            ),
        }
      );

    if (!testRes.ok) {
      return NextResponse.json(
        {
          error:
            `Impossible de contacter le serveur IPTV (${testRes.status})`,
        },
        {
          status:
            testRes.status,
        }
      );
    }

    const data =
      await testRes.json();

    if (
      !data?.user_info ||
      Number(
        data.user_info.auth
      ) === 0
    ) {
      return NextResponse.json(
        {
          error:
            "Identifiant ou mot de passe incorrect",
        },
        {
          status: 401,
        }
      );
    }

    const sessionData =
      JSON.stringify({
        serverUrl:
          cleanUrl,
        username,
        password,
      });

    const response =
      NextResponse.json({
        success: true,
        user:
          data.user_info,
      });

    response.cookies.set(
      "gtv_session",
      sessionData,
      {
        httpOnly:
          true,
        secure:
          process.env.NODE_ENV ===
          "production",
        sameSite:
          "lax",
        path:
          "/",
        maxAge:
          60 *
          60 *
          24 *
          30,
      }
    );

    return response;
  } catch (error) {
    console.error(
      "[LOGIN]",
      error
    );

    return NextResponse.json(
      {
        error:
          "Erreur de connexion au serveur",
      },
      {
        status: 500,
      }
    );
  }
}
