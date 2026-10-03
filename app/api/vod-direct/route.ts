import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UA =
  "VLC/3.0.20 LibVLC/3.0.20";


const HEADERS = {
  "Cache-Control":
    "no-store, no-cache, must-revalidate",

  Pragma:
    "no-cache",

  Expires:
    "0",

  "Access-Control-Allow-Origin":
    "*",

  "X-Accel-Buffering":
    "no",
};



function cleanHost(
  value: string
) {
  return String(value || "")
    .replace(/\/+$/, "");
}



export async function GET(
  req: Request
) {

  try {

    const url =
      new URL(req.url);


    const id =
      url.searchParams.get(
        "id"
      );


    const type =
      url.searchParams.get(
        "type"
      ) === "series"
        ? "series"
        : "movie";


    const ext =
      (
        url.searchParams.get(
          "ext"
        ) || "mkv"
      )
      .toLowerCase()
      .replace(
        /[^a-z0-9]/g,
        ""
      );


    if (!id) {

      return new Response(
        "ID manquant",
        {
          status:400,
          headers:HEADERS,
        }
      );

    }



    /*
      SESSION GTV 3.0

      Cloudflare
          |
          |
       Railway
          |
          |
       Xtream
    */

    let session:any;


    try {

      session =
        await requireSession();

    } catch {

      return new Response(
        "Non autorisé",
        {
          status:401,
          headers:HEADERS,
        }
      );

    }



    const host =
      cleanHost(
        session?.baseUrl ||
        session?.url ||
        session?.serverUrl ||
        session?.host ||
        ""
      );


    const username =
      session?.username ||
      session?.user ||
      "";


    const password =
      session?.password ||
      session?.pass ||
      "";



    if (
      !host ||
      !username ||
      !password
    ) {

      return new Response(
        "Identifiants Xtream incomplets",
        {
          status:400,
          headers:HEADERS,
        }
      );

    }



    /*
      CONSTRUCTION URL XTREAM

      movie:
      /movie/user/pass/id.ext

      series:
      /series/user/pass/id.ext
    */


    const folder =
      type === "series"
        ? "series"
        : "movie";



    const target =
      `${host}/${folder}/` +
      `${encodeURIComponent(username)}/` +
      `${encodeURIComponent(password)}/` +
      `${encodeURIComponent(id)}.${ext}`;



    console.log(
      `[VOD DIRECT] ${type} id=${id} ext=${ext}`
    );



    /*
      STREAM DIRECT

      Pas de FFmpeg
      Pas de HLS
      Pas de transcodage
    */


    const upstream =
      await fetch(
        target,
        {
          headers:{
            "User-Agent":UA,
            "Accept":"*/*",
          },

          redirect:
            "follow",
        }
      );



    if (!upstream.ok) {

      return new Response(
        `Upstream VOD Error ${upstream.status}`,
        {
          status:upstream.status,
          headers:HEADERS,
        }
      );

    }



    const responseHeaders =
    new Headers(
      HEADERS
    );


    const contentType =
      upstream.headers.get(
        "content-type"
      );


    if (contentType) {

      responseHeaders.set(
        "Content-Type",
        contentType
      );

    } else {

      responseHeaders.set(
        "Content-Type",
        "video/x-matroska"
      );

    }



    responseHeaders.set(
      "Content-Disposition",
      "inline"
    );



    responseHeaders.set(
      "Accept-Ranges",
      "bytes"
    );



    return new Response(
      upstream.body,
      {
        status:200,
        headers:responseHeaders,
      }
    );



  } catch(error:any) {


    console.error(
      "[VOD DIRECT]",
      error
    );


    return new Response(
      `Erreur VOD DIRECT: ${
        error?.message ||
        "unknown"
      }`,
      {
        status:500,
        headers:HEADERS,
      }
    );

  }

}
