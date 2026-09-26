import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  type FootballFixture,
  readCache,
  safeDate,
  safeNumber,
  safeString,
  safeTimeZone,
  writeCache,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SPORTSRC_BASE =
  "https://api.sportsrc.org/v2/";

type AnyObject =
  Record<string, any>;

/* =========================================================
   ARRAY SAFE
========================================================= */

function asArray(
  value: unknown
): AnyObject[] {
  return Array.isArray(value)
    ? value.filter(
        (
          item
        ): item is AnyObject =>
          !!item &&
          typeof item === "object"
      )
    : [];
}

/* =========================================================
   RESOLVE GROUPS
========================================================= */

function resolveGroups(
  payload: any
): AnyObject[] {
  if (
    Array.isArray(payload)
  ) {
    return payload;
  }

  const candidates = [
    payload?.data,
    payload?.response,
    payload?.results,
    payload?.leagues,
  ];

  for (
    const candidate of candidates
  ) {
    if (
      Array.isArray(
        candidate
      )
    ) {
      return candidate;
    }
  }

  return [];
}

/* =========================================================
   STRICT AFRICA FILTER
========================================================= */

function looksAfrican(
  group: AnyObject
) {
  const league =
    group?.league ??
    group;

  const name =
    safeString(
      league?.name
    )
      .toLowerCase()
      .trim();

  const country =
    safeString(
      league?.country
    )
      .toLowerCase()
      .trim();

  const text =
    `${name} ${country}`;

  /* =====================================================
     EXCLUDE OTHER CONFEDERATIONS
  ===================================================== */

  const excluded = [
    "concacaf",
    "uefa",
    "conmebol",
    "afc",
    "ofc",
    "north & central america",
    "north and central america",
    "central america",
    "south america",
    "asia",
    "oceania",
    "europe",
  ];

  if (
    excluded.some(
      (token) =>
        text.includes(
          token
        )
    )
  ) {
    return false;
  }

  /* =====================================================
     STRICT CAF / AFRICA NAMES
  ===================================================== */

  const africanCompetitionKeywords = [
    "africa cup of nations",
    "africa cup of nations qual",
    "africa cup of nations qualification",
    "afcon",
    "caf champions league",
    "caf confederation cup",
    "caf super cup",
    "caf women's champions league",
    "african nations championship",
    "chan",
  ];

  if (
    africanCompetitionKeywords.some(
      (token) =>
        name.includes(
          token
        )
    )
  ) {
    return true;
  }

  /* =====================================================
     COUNTRY=AFRICA
  ===================================================== */

  if (
    country ===
    "africa"
  ) {
    return true;
  }

  /*
   * Attention :
   * on ne fait PAS simplement
   * name.includes("caf")
   *
   * parce que ça peut produire
   * des faux positifs dans certains noms.
   */

  return false;
}

/* =========================================================
   TIMESTAMP TO ISO
========================================================= */

function timestampToIso(
  value: unknown
) {
  const timestamp =
    safeNumber(value);

  if (!timestamp) {
    return "";
  }

  /*
   * secondes vs millisecondes
   */
  const milliseconds =
    timestamp >
    10_000_000_000
      ? timestamp
      : timestamp *
        1000;

  const date =
    new Date(
      milliseconds
    );

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }

  return date.toISOString();
}

/* =========================================================
   NORMALIZE MATCH
========================================================= */

function normalizeMatch(
  group: AnyObject,
  match: AnyObject
): FootballFixture | null {
  const league =
    group?.league ??
    {};

  const matchId =
    safeString(
      match?.id
    );

  if (!matchId) {
    return null;
  }

  const home =
    match?.teams
      ?.home ??
    {};

  const away =
    match?.teams
      ?.away ??
    {};

  /* =====================================================
     START TIME
  ===================================================== */

  let startingAt =
    timestampToIso(
      match?.timestamp
    );

  if (
    !startingAt &&
    typeof match?.date ===
      "string"
  ) {
    startingAt =
      match.date;
  }

  /* =====================================================
     SCORE
  ===================================================== */

  const currentScore =
    match?.score
      ?.current ??
    {};

  const homeScore =
    safeNumber(
      currentScore?.home
    );

  const awayScore =
    safeNumber(
      currentScore?.away
    );

  const displayScore =
    safeString(
      match?.score
        ?.display
    ) ||
    (
      homeScore !==
        null &&
      awayScore !==
        null
        ? `${homeScore} - ${awayScore}`
        : null
    );

  /* =====================================================
     STATUS
  ===================================================== */

  const rawStatus =
    safeString(
      match?.status
    )
      .toLowerCase()
      .trim();

  const statusDetail =
    safeString(
      match?.status_detail
    );

  const liveStatuses = [
    "live",
    "inprogress",
    "in progress",
    "1st half",
    "first half",
    "2nd half",
    "second half",
    "halftime",
    "half time",
    "extra time",
    "penalties",
  ];

  const finishedStatuses = [
    "finished",
    "ended",
    "fulltime",
    "full time",
    "ft",
    "after penalties",
  ];

  const live =
    liveStatuses.some(
      (status) =>
        rawStatus.includes(
          status
        )
    );

  const finished =
    finishedStatuses.some(
      (status) =>
        rawStatus.includes(
          status
        )
    );

  /* =====================================================
     NORMALIZED FIXTURE
  ===================================================== */

  return {
    id:
      `sportsrc:${matchId}`,

    provider:
      "sportsrc",

    providerMatchId:
      matchId,

    competitionId:
      safeString(
        league?.id
      ) ||
      null,

    startingAt,

    status: {
      short:
        rawStatus,

      long:
        statusDetail ||
        rawStatus,

      live,

      finished,
    },

    league: {
      id:
        safeString(
          league?.id
        ) ||
        null,

      name:
        safeString(
          league?.name
        ),

      country:
        safeString(
          league?.country
        ) ||
        null,

      logo:
        safeString(
          league?.logo
        ) ||
        null,
    },

    home: {
      id:
        safeString(
          home?.id
        ) ||
        safeString(
          home?.code
        ) ||
        safeString(
          home?.name
        ),

      name:
        safeString(
          home?.name
        ),

      code:
        safeString(
          home?.code
        ) ||
        null,

      logo:
        safeString(
          home?.badge
        ) ||
        safeString(
          home?.logo
        ) ||
        null,
    },

    away: {
      id:
        safeString(
          away?.id
        ) ||
        safeString(
          away?.code
        ) ||
        safeString(
          away?.name
        ),

      name:
        safeString(
          away?.name
        ),

      code:
        safeString(
          away?.code
        ) ||
        null,

      logo:
        safeString(
          away?.badge
        ) ||
        safeString(
          away?.logo
        ) ||
        null,
    },

    score: {
      home:
        homeScore,

      away:
        awayScore,

      display:
        displayScore,
    },
  };
}

/* =========================================================
   GET
========================================================= */

export async function GET(
  request: NextRequest
) {
  try {
    /* =====================================================
       API KEY
    ===================================================== */

    const apiKey =
      process.env
        .SPORTSRC_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "SPORTSRC_API_KEY manquant.",

          fixtures:
            [],
        },
        {
          status:
            500,
        }
      );
    }

    /* =====================================================
       PARAMS
    ===================================================== */

    const requestUrl =
      new URL(
        request.url
      );

    const date =
      safeDate(
        requestUrl.searchParams.get(
          "date"
        )
      );

    const timeZone =
      safeTimeZone(
        requestUrl.searchParams.get(
          "timezone"
        )
      );

    /* =====================================================
       CACHE

       v3 dans la clé pour éviter
       de récupérer l'ancien cache
       qui contenait CONCACAF.
    ===================================================== */

    const cacheKey =
      `football:africa:v3:${date}`;

    const cached =
      readCache<FootballFixture[]>(
        cacheKey
      );

    if (cached) {
      return NextResponse.json({
        success: true,

        provider:
          "sportsrc",

        cached: true,

        date,

        timezone:
          timeZone,

        count:
          cached.length,

        fixtures:
          cached,
      });
    }

    /* =====================================================
       SPORTSRC URL
    ===================================================== */

    const upstream =
      new URL(
        SPORTSRC_BASE
      );

    upstream.searchParams.set(
      "type",
      "matches"
    );

    upstream.searchParams.set(
      "sport",
      "football"
    );

    upstream.searchParams.set(
      "date",
      date
    );

    /* =====================================================
       FETCH
    ===================================================== */

    const response =
      await fetch(
        upstream.toString(),
        {
          headers: {
            Accept:
              "application/json",

            "X-API-KEY":
              apiKey.trim(),
          },

          cache:
            "no-store",
        }
      );

    const raw =
      await response.text();

    /* =====================================================
       HTTP ERROR
    ===================================================== */

    if (!response.ok) {
      return NextResponse.json(
        {
          success:
            false,

          error:
            `SportSRC HTTP ${response.status}`,

          detail:
            raw.slice(
              0,
              400
            ),

          fixtures:
            [],
        },
        {
          status:
            response.status ===
            429
              ? 429
              : 502,
        }
      );
    }

    /* =====================================================
       JSON
    ===================================================== */

    let payload:
      any;

    try {
      payload =
        JSON.parse(raw);
    } catch {
      return NextResponse.json(
        {
          success:
            false,

          error:
            "SportSRC a renvoyé une réponse non JSON.",

          detail:
            raw.slice(
              0,
              400
            ),

          fixtures:
            [],
        },
        {
          status:
            502,
        }
      );
    }

    /* =====================================================
       GROUPS
    ===================================================== */

    const groups =
      resolveGroups(
        payload
      );

    /* =====================================================
       STRICT AFRICAN GROUPS
    ===================================================== */

    const africanGroups =
      groups.filter(
        (group) =>
          looksAfrican(
            group
          )
      );

    /* =====================================================
       DEBUG SERVER

       Très utile tant qu'on valide
       la couverture SportSRC.
    ===================================================== */

    console.log(
      "[SportSRC] groups received:",
      groups.length
    );

    console.log(
      "[SportSRC] Africa kept:",
      africanGroups.map(
        (group) => ({
          name:
            group?.league
              ?.name ??
            group?.name ??
            null,

          country:
            group?.league
              ?.country ??
            group?.country ??
            null,

          matches:
            Array.isArray(
              group?.matches
            )
              ? group.matches
                  .length
              : 0,
        })
      )
    );

    /* =====================================================
       NORMALIZE
    ===================================================== */

    const fixtures =
      africanGroups
        .flatMap(
          (group) =>
            asArray(
              group?.matches
            )
              .map(
                (match) =>
                  normalizeMatch(
                    group,
                    match
                  )
              )
              .filter(
                (
                  item
                ): item is FootballFixture =>
                  item !==
                  null
              )
        )
        .filter(
          (fixture) =>
            fixture.home
              .name &&
            fixture.away
              .name
        )
        .sort(
          (
            a,
            b
          ) => {
            const aTime =
              new Date(
                a.startingAt
              ).getTime();

            const bTime =
              new Date(
                b.startingAt
              ).getTime();

            if (
              Number.isNaN(
                aTime
              )
            ) {
              return 1;
            }

            if (
              Number.isNaN(
                bTime
              )
            ) {
              return -1;
            }

            return (
              aTime -
              bTime
            );
          }
        );

    /* =====================================================
       CACHE 15 MIN
    ===================================================== */

    writeCache(
      cacheKey,
      fixtures,
      15 *
        60 *
        1000
    );

    /* =====================================================
       RESPONSE
    ===================================================== */

    return NextResponse.json({
      success:
        true,

      provider:
        "sportsrc",

      cached:
        false,

      date,

      timezone:
        timeZone,

      groupsReceived:
        groups.length,

      africanGroups:
        africanGroups.map(
          (group) => ({
            name:
              group?.league
                ?.name ??
              group?.name ??
              null,

            country:
              group?.league
                ?.country ??
              group?.country ??
              null,

            logo:
              group?.league
                ?.logo ??
              null,

            matches:
              Array.isArray(
                group?.matches
              )
                ? group.matches
                    .length
                : 0,
          })
        ),

      count:
        fixtures.length,

      fixtures,
    });
  } catch (error) {
    console.error(
      "[SportSRC Africa]",
      error
    );

    return NextResponse.json(
      {
        success:
          false,

        error:
          error instanceof
          Error
            ? error.message
            : "SportSRC indisponible.",

        fixtures:
          [],
      },
      {
        status:
          500,
      }
    );
  }
}