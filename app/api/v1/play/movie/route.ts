import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET(req: Request) {

  try {

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


    const { searchParams } = new URL(req.url);


    const id =
      searchParams.get("id");


    if (!id) {

      return NextResponse.json(
        {
          error: "Missing movie id"
        },
        {
          status: 400
        }
      );
    }


    const baseUrl =
      String(
        creds?.baseUrl ||
        creds?.url ||
        creds?.serverUrl ||
        ""
      ).replace(/\/+$/, "");


    const username =
      String(
        creds?.username ||
        creds?.user ||
        ""
      );


    const password =
      String(
        creds?.password ||
        creds?.pass ||
        ""
      );


    if (
      !baseUrl ||
      !username ||
      !password
    ) {

      return NextResponse.json(
        {
          error: "Xtream credentials missing"
        },
        {
          status: 400
        }
      );
    }



    /*
      Récupération informations VOD Xtream
    */

    const infoUrl =
      new URL(
        `${baseUrl}/player_api.php`
      );


    infoUrl.searchParams.set(
      "username",
      username
    );


    infoUrl.searchParams.set(
      "password",
      password
    );


    infoUrl.searchParams.set(
      "action",
      "get_vod_info"
    );


    infoUrl.searchParams.set(
      "vod_id",
      id
    );



    const infoResponse =
      await fetch(
        infoUrl.toString(),
        {
          headers: {
            "User-Agent": "GTV/3.0",
            "Accept": "application/json"
          },
          cache: "no-store"
        }
      );



    if (!infoResponse.ok) {

      return NextResponse.json(
        {
          error: "Impossible de récupérer le film"
        },
        {
          status: 502
        }
      );
    }



    const info =
      await infoResponse.json();



    const movie =
      info?.movie_data;



    if (!movie) {

      return NextResponse.json(
        {
          error: "Film introuvable"
        },
        {
          status: 404
        }
      );
    }



    const extension =
      movie.container_extension ||
      "mkv";



    /*
      Nouveau pipeline GTV

      MKV Xtream
          |
          |
       vod-hls
          |
          |
       FFmpeg HLS
          |
          |
       m3u8 + segments TS

      Compatible:
      - Web
      - Android Media3
      - TV
    */


    return NextResponse.json(

      {
        success: true,

        media: {

          id,

          type: "movie",


          original: {

            extension,

            streamId: id

          },


          playback: {

            type: "hls",


            url:
              `/api/vod-hls?type=movie&id=${id}&ext=${extension}`

          }

        }

      }

    );


  } catch (error: any) {


    console.error(
      "[GTV PLAY MOVIE]",
      error
    );


    return NextResponse.json(

      {
        error:
          error?.message ||
          "Playback error"
      },

      {
        status: 500
      }

    );

  }

}
