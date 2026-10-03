import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET() {

  try {

    // Vérifie la session GTV existante
    let creds;

    try {
      creds = await requireSession();
    } catch {
      return NextResponse.json(
        {
          error: "Non authentifié"
        },
        {
          status: 401
        }
      );
    }


    const baseUrl = String(
      creds?.baseUrl ||
      creds?.url ||
      creds?.serverUrl ||
      ""
    ).replace(/\/+$/, "");


    const username = String(
      creds?.username ||
      creds?.user ||
      ""
    );


    const password = String(
      creds?.password ||
      creds?.pass ||
      "");


    if (!baseUrl || !username || !password) {

      return NextResponse.json(
        {
          error: "Identifiants Xtream absents"
        },
        {
          status:400
        }
      );
    }


    const xtreamUrl =
      new URL(
        `${baseUrl}/player_api.php`
      );


    xtreamUrl.searchParams.set(
      "username",
      username
    );


    xtreamUrl.searchParams.set(
      "password",
      password
    );


    xtreamUrl.searchParams.set(
      "action",
      "get_vod_streams"
    );


    const response =
      await fetch(
        xtreamUrl.toString(),
        {
          headers:{
            "User-Agent":"GTV/3.0",
            "Accept":"application/json"
          },
          cache:"no-store"
        }
      );


    if (!response.ok) {

      return NextResponse.json(
        {
          error:
          "Erreur Xtream"
        },
        {
          status:502
        }
      );
    }


    const movies =
      await response.json();


    return NextResponse.json(
      {
        success:true,
        count:Array.isArray(movies)
          ? movies.length
          : 0,
        movies
      },
      {
        headers:{
          "Cache-Control":
          "private, max-age=300"
        }
      }
    );


  } catch(error:any){

    console.error(
      "[GTV MOVIES API]",
      error
    );


    return NextResponse.json(
      {
        error:
        error?.message ||
        "Erreur serveur"
      },
      {
        status:500
      }
    );

  }

}
