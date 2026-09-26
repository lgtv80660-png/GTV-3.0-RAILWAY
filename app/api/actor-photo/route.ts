import {
  NextRequest,
  NextResponse,
} from "next/server";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

const TMDB_BASE =
  "https://api.themoviedb.org/3";

const TMDB_IMAGE =
  "https://image.tmdb.org/t/p/w500";

/* =========================================================
   WIKIPEDIA FALLBACK
========================================================= */

async function getWikipediaBio(
  name: string
) {
  try {
    const searchUrl =
      "https://en.wikipedia.org/w/api.php" +
      "?action=query" +
      "&list=search" +
      "&format=json" +
      "&origin=*" +
      `&srsearch=${encodeURIComponent(
        name
      )}` +
      "&srlimit=1";

    const searchRes =
      await fetch(
        searchUrl,
        {
          next: {
            revalidate:
              86400,
          },
        }
      );

    if (
      !searchRes.ok
    ) {
      return null;
    }

    const searchData =
      await searchRes.json();

    const title =
      searchData?.query
        ?.search?.[0]
        ?.title;

    if (!title) {
      return null;
    }

    const summaryRes =
      await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          title
        )}`,
        {
          next: {
            revalidate:
              86400,
          },
        }
      );

    if (
      !summaryRes.ok
    ) {
      return null;
    }

    const summary =
      await summaryRes.json();

    const extract =
      String(
        summary?.extract ||
          ""
      ).trim();

    if (!extract) {
      return null;
    }

    return extract;
  } catch {
    return null;
  }
}

/* =========================================================
   ROUTE
========================================================= */

export async function GET(
  req: NextRequest
) {
  try {
    const name =
      req.nextUrl
        .searchParams
        .get("name")
        ?.trim();

    if (!name) {
      return NextResponse.json(
        {
          photoUrl:
            null,

          bio:
            null,
        }
      );
    }

    const apiKey =
      process.env
        .TMDB_API_KEY;

    /* =====================================================
       SI PAS DE TMDB -> WIKIPEDIA QUAND MÊME
    ===================================================== */

    if (!apiKey) {
      const wikiBio =
        await getWikipediaBio(
          name
        );

      return NextResponse.json(
        {
          name,

          photoUrl:
            null,

          bio:
            wikiBio,
        }
      );
    }

    /* =====================================================
       SEARCH TMDB
    ===================================================== */

    const searchRes =
      await fetch(
        `${TMDB_BASE}/search/person` +
          `?api_key=${apiKey}` +
          `&query=${encodeURIComponent(
            name
          )}` +
          `&language=fr-FR`,
        {
          next: {
            revalidate:
              86400,
          },
        }
      );

    let person:
      any =
      null;

    if (
      searchRes.ok
    ) {
      const searchData =
        await searchRes.json();

      person =
        searchData
          ?.results?.[0] ||
        null;
    }

    /* =====================================================
       PAS DE PERSONNE TMDB
       -> WIKIPEDIA
    ===================================================== */

    if (
      !person?.id
    ) {
      const wikiBio =
        await getWikipediaBio(
          name
        );

      return NextResponse.json(
        {
          name,

          photoUrl:
            null,

          bio:
            wikiBio,
        }
      );
    }

    /* =====================================================
       DETAILS FR
    ===================================================== */

    const frRes =
      await fetch(
        `${TMDB_BASE}/person/${person.id}` +
          `?api_key=${apiKey}` +
          `&language=fr-FR`,
        {
          next: {
            revalidate:
              86400,
          },
        }
      );

    const frData =
      frRes.ok
        ? await frRes.json()
        : {};

    /* =====================================================
       DETAILS EN
    ===================================================== */

    let enData:
      any =
      {};

    if (
      !frData
        ?.biography
        ?.trim()
    ) {
      const enRes =
        await fetch(
          `${TMDB_BASE}/person/${person.id}` +
            `?api_key=${apiKey}` +
            `&language=en-US`,
          {
            next: {
              revalidate:
                86400,
            },
          }
        );

      if (
        enRes.ok
      ) {
        enData =
          await enRes.json();
      }
    }

    /* =====================================================
       PHOTO
    ===================================================== */

    const profilePath =
      frData
        ?.profile_path ||
      enData
        ?.profile_path ||
      person
        ?.profile_path;

    /* =====================================================
       BIO TMDB
    ===================================================== */

    let bio =
      frData
        ?.biography
        ?.trim() ||
      enData
        ?.biography
        ?.trim() ||
      null;

    /* =====================================================
       BIO WIKIPEDIA FALLBACK
    ===================================================== */

    if (!bio) {
      bio =
        await getWikipediaBio(
          name
        );
    }

    return NextResponse.json(
      {
        id:
          person.id,

        name:
          frData?.name ||
          enData?.name ||
          person?.name ||
          name,

        photoUrl:
          profilePath
            ? `${TMDB_IMAGE}${profilePath}`
            : null,

        bio,

        birthday:
          frData
            ?.birthday ||
          enData
            ?.birthday ||
          null,

        placeOfBirth:
          frData
            ?.place_of_birth ||
          enData
            ?.place_of_birth ||
          null,

        knownFor:
          frData
            ?.known_for_department ||
          enData
            ?.known_for_department ||
          null,
      }
    );
  } catch (
    error
  ) {
    console.error(
      "[actor-photo]",
      error
    );

    return NextResponse.json(
      {
        photoUrl:
          null,

        bio:
          null,
      }
    );
  }
}
