import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  type FootballFixture,
  compactDate,
  readCache,
  safeDate,
  safeNumber,
  safeString,
  safeTimeZone,
  writeCache,
} from "../_shared";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer";

const EUROPE_LEAGUES = [
  {
    code: "eng.1",
    name: "Premier League",
  },
  {
    code: "esp.1",
    name: "La Liga",
  },
  {
    code: "fra.1",
    name: "Ligue 1",
  },
  {
    code: "ger.1",
    name: "Bundesliga",
  },
  {
    code: "ita.1",
    name: "Serie A",
  },
  {
    code: "uefa.champions",
    name: "UEFA Champions League",
  },
  {
    code: "uefa.europa",
    name: "UEFA Europa League",
  },
  {
    code: "uefa.europa.conf",
    name: "UEFA Conference League",
  },
  {
    code: "uefa.nations",
    name: "UEFA Nations League",
  },
] as const;

type AnyObject =
  Record<string, any>;

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

function uniqueStrings(
  values: string[]
) {
  return [
    ...new Set(
      values
        .map(
          (value) =>
            value.trim()
        )
        .filter(Boolean)
    ),
  ];
}

/* =========================================================
   BROADCASTS ESPN
========================================================= */

function extractBroadcasts(
  competition: AnyObject
) {
  const output:
    string[] =
    [];

  /*
   * broadcasts:
   * [
   *   {
   *     market: "national",
   *     names: ["ESPN", "ESPN+"]
   *   }
   * ]
   */
  for (
    const item of
    asArray(
      competition?.broadcasts
    )
  ) {
    if (
      Array.isArray(
        item?.names
      )
    ) {
      for (
        const name of
        item.names
      ) {
        if (
          typeof name ===
            "string"
        ) {
          output.push(
            name
          );
        }
      }
    }

    if (
      typeof item?.name ===
      "string"
    ) {
      output.push(
        item.name
      );
    }
  }

  /*
   * geoBroadcasts:
   * [
   *   {
   *     type: { shortName: "TV" },
   *     media: { shortName: "USA Net" },
   *     lang: "en",
   *     region: "us"
   *   }
   * ]
   */
  for (
    const item of
    asArray(
      competition?.geoBroadcasts
    )
  ) {
    const media =
      safeString(
        item?.media?.shortName
      ) ||
      safeString(
        item?.media?.name
      );

    if (media) {
      output.push(media);
    }
  }

  return uniqueStrings(
    output
  );
}

/* =========================================================
   LOGOS
========================================================= */

function teamLogo(
  competitor: AnyObject
) {
  const team =
    competitor?.team;

  if (!team) {
    return null;
  }

  if (
    typeof team.logo ===
      "string"
  ) {
    return team.logo;
  }

  const logo =
    asArray(
      team.logos
    ).find(
      (item) =>
        typeof item?.href ===
        "string"
    );

  return logo?.href ?? null;
}

function leagueLogo(
  event: AnyObject,
  competition: AnyObject
) {
  return (
    safeString(
      event?.league?.logos?.[0]
        ?.href
    ) ||
    safeString(
      competition?.league
        ?.logos?.[0]?.href
    ) ||
    null
  );
}

/* =========================================================
   NORMALIZE
========================================================= */

function normalizeEvent(
  event: AnyObject,
  leagueCode: string,
  leagueName: string
): FootballFixture | null {
  const competition =
    asArray(
      event?.competitions
    )[0];

  if (!competition) {
    return null;
  }

  const competitors =
    asArray(
      competition?.competitors
    );

  const home =
    competitors.find(
      (item) =>
        item?.homeAway ===
        "home"
    ) ??
    competitors[0];

  const away =
    competitors.find(
      (item) =>
        item?.homeAway ===
        "away"
    ) ??
    competitors[1];

  if (
    !home ||
    !away
  ) {
    return null;
  }

  const eventId =
    safeString(
      event?.id
    );

  if (!eventId) {
    return null;
  }

  const statusType =
    competition?.status
      ?.type ??
    event?.status
      ?.type ??
    {};

  const statusName =
    safeString(
      statusType?.name
    );

  const state =
    safeString(
      statusType?.state
    );

  const detail =
    safeString(
      statusType?.detail
    );

  const shortDetail =
    safeString(
      statusType?.shortDetail
    );

  const live =
    state === "in" ||
    statusName ===
      "STATUS_IN_PROGRESS" ||
    statusName ===
      "STATUS_HALFTIME";

  const finished =
    state === "post" ||
    statusName ===
      "STATUS_FINAL";

  const homeScore =
    safeNumber(
      home?.score
    );

  const awayScore =
    safeNumber(
      away?.score
    );

  return {
    id:
      `espn:${leagueCode}:${eventId}`,

    provider:
      "espn",

    providerMatchId:
      eventId,

    competitionId:
      safeString(
        competition?.id
      ) ||
      leagueCode,

    startingAt:
      safeString(
        event?.date
      ) ||
      safeString(
        competition?.date
      ),

    status: {
      short:
        shortDetail ||
        detail ||
        statusName,

      long:
        detail ||
        statusName,

      live,

      finished,
    },

    league: {
      id:
        leagueCode,

      name:
        safeString(
          event?.league?.name
        ) ||
        leagueName,

      country:
        "Europe",

      logo:
        leagueLogo(
          event,
          competition
        ),
    },

    home: {
      id:
        safeString(
          home?.team?.id
        ) ||
        safeString(
          home?.id
        ),

      name:
        safeString(
          home?.team
            ?.displayName
        ) ||
        safeString(
          home?.team
            ?.name
        ),

      code:
        safeString(
          home?.team
            ?.abbreviation
        ) ||
        null,

      logo:
        teamLogo(
          home
        ),
    },

    away: {
      id:
        safeString(
          away?.team?.id
        ) ||
        safeString(
          away?.id
        ),

      name:
        safeString(
          away?.team
            ?.displayName
        ) ||
        safeString(
          away?.team
            ?.name
        ),

      code:
        safeString(
          away?.team
            ?.abbreviation
        ) ||
        null,

      logo:
        teamLogo(
          away
        ),
    },

    score: {
      home:
        homeScore,

      away:
        awayScore,

      display:
        homeScore !== null &&
        awayScore !== null
          ? `${homeScore} - ${awayScore}`
          : null,
    },

    broadcasts:
      extractBroadcasts(
        competition
      ),
  };
}

/* =========================================================
   FETCH LEAGUE
========================================================= */

async function fetchLeague(
  leagueCode: string,
  leagueName: string,
  date: string
) {
  const url =
    new URL(
      `${ESPN_BASE}/${leagueCode}/scoreboard`
    );

  url.searchParams.set(
    "dates",
    compactDate(date)
  );

  url.searchParams.set(
    "limit",
    "100"
  );

  const response =
    await fetch(
      url.toString(),
      {
        headers: {
          Accept:
            "application/json",
        },

        cache:
          "no-store",
      }
    );

  if (!response.ok) {
    return {
      fixtures:
        [] as FootballFixture[],

      debug: {
        league:
          leagueCode,

        status:
          response.status,

        count:
          0,
      },
    };
  }

  const data =
    await response.json();

  const events =
    asArray(
      data?.events
    );

  const fixtures =
    events
      .map(
        (event) =>
          normalizeEvent(
            event,
            leagueCode,
            leagueName
          )
      )
      .filter(
        (
          fixture
        ): fixture is FootballFixture =>
          fixture !== null
      );

  return {
    fixtures,

    debug: {
      league:
        leagueCode,

      status:
        response.status,

      count:
        fixtures.length,

      broadcasts:
        fixtures.map(
          (fixture) => ({
            id:
              fixture.id,

            broadcasts:
              fixture.broadcasts ??
              [],
          })
        ),
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
    const url =
      new URL(
        request.url
      );

    const date =
      safeDate(
        url.searchParams.get(
          "date"
        )
      );

    const timeZone =
      safeTimeZone(
        url.searchParams.get(
          "timezone"
        )
      );

    /*
     * Nouvelle version pour
     * invalider les anciens
     * caches sans broadcasts.
     */
    const cacheKey =
      `football:europe:v10:${date}`;

    const cached =
      readCache<
        FootballFixture[]
      >(
        cacheKey
      );

    if (cached) {
      return NextResponse.json({
        success: true,
        provider: "espn",
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

    const results =
      await Promise.all(
        EUROPE_LEAGUES.map(
          (league) =>
            fetchLeague(
              league.code,
              league.name,
              date
            )
        )
      );

    const map =
      new Map<
        string,
        FootballFixture
      >();

    for (
      const result of
      results
    ) {
      for (
        const fixture of
        result.fixtures
      ) {
        map.set(
          fixture.id,
          fixture
        );
      }
    }

    const fixtures =
      [...map.values()].sort(
        (a, b) =>
          new Date(
            a.startingAt
          ).getTime() -
          new Date(
            b.startingAt
          ).getTime()
      );

    console.log(
      "[ESPN EUROPE]",
      results.map(
        (result) =>
          result.debug
      )
    );

    writeCache(
      cacheKey,
      fixtures,
      10 *
        60 *
        1000
    );

    return NextResponse.json({
      success: true,

      provider:
        "espn",

      cached: false,

      date,

      timezone:
        timeZone,

      leagues:
        results.map(
          (result) =>
            result.debug
        ),

      count:
        fixtures.length,

      fixtures,
    });
  } catch (error) {
    console.error(
      "[ESPN EUROPE]",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "ESPN indisponible",

        fixtures: [],
      },
      {
        status: 500,
      }
    );
  }
}