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

const LIVE_CACHE_MS = 15 * 1000;
const IDLE_CACHE_MS = 2 * 60 * 1000;

type AnyObject = Record<string, any>;

/* =========================================================
   SAFE ARRAY
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
   GROUPS
   ========================================================= */

function resolveGroups(
  payload: any
): AnyObject[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const candidates = [
    payload?.data,
    payload?.response,
    payload?.results,
    payload?.leagues,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

/* =========================================================
   AFRICA FILTER
   ========================================================= */

function looksAfrican(
  group: AnyObject
) {
  const league =
    group?.league ?? group;

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
        text.includes(token)
    )
  ) {
    return false;
  }

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
        name.includes(token)
    )
  ) {
    return true;
  }

  if (country === "africa") {
    return true;
  }

  return false;
}

/* =========================================================
   TIMESTAMP
   ========================================================= */

function timestampToIso(
  value: unknown
) {
  const timestamp =
    safeNumber(value);

  if (
    timestamp === null ||
    timestamp === undefined
  ) {
    return "";
  }

  const milliseconds =
    timestamp >
    10_000_000_000
      ? timestamp
      : timestamp * 1000;

  const date =
    new Date(milliseconds);

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
   SCORE
   ========================================================= */

function numberOrNull(
  value: unknown
): number | null {
  const result =
    safeNumber(value);

  return result === null ||
    result === undefined
    ? null
    : result;
}

function firstNumber(
  ...values: unknown[]
): number | null {
  for (const value of values) {
    const parsed =
      numberOrNull(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function resolveScore(
  match: AnyObject
) {
  /*
   * SportSRC peut faire évoluer légèrement
   * la structure de son payload.
   *
   * On accepte plusieurs formes sans
   * inventer de score.
   */

  const home =
    firstNumber(
      match?.score?.current?.home,
      match?.score?.home,
      match?.scores?.current?.home,
      match?.scores?.home,
      match?.goals?.home,
      match?.result?.home,
      match?.home_score,
      match?.homeScore
    );

  const away =
    firstNumber(
      match?.score?.current?.away,
      match?.score?.away,
      match?.scores?.current?.away,
      match?.scores?.away,
      match?.goals?.away,
      match?.result?.away,
      match?.away_score,
      match?.awayScore
    );

  const providerDisplay =
    safeString(
      match?.score?.display
    ) ||
    safeString(
      match?.scores?.display
    ) ||
    safeString(
      match?.result?.display
    );

  const display =
    providerDisplay ||
    (
      home !== null &&
      away !== null
        ? `${home} - ${away}`
        : null
    );

  return {
    home,
    away,
    display,
  };
}

/* =========================================================
   STATUS
   ========================================================= */

function resolveStatus(
  match: AnyObject
) {
  const rawStatus =
    safeString(
      match?.status
    )
      .toLowerCase()
      .trim();

  const statusDetail =
    safeString(
      match?.status_detail
    ) ||
    safeString(
      match?.statusDetail
    );

  const combined =
    `${rawStatus} ${statusDetail}`
      .toLowerCase();

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
        combined.includes(status)
    );

  const finished =
    finishedStatuses.some(
      (status) =>
        combined.includes(status)
    );

  return {
    rawStatus,
    statusDetail,
    live,
    finished,
  };
}

/* =========================================================
   NORMALIZE MATCH
   ========================================================= */

function normalizeMatch(
  group: AnyObject,
  match: AnyObject
): FootballFixture | null {
  const league =
    group?.league ?? {};

  const matchId =
    safeString(
      match?.id
    );

  if (!matchId) {
    return null;
  }

  const home =
    match?.teams?.home ?? {};

  const away =
    match?.teams?.away ?? {};

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

  const score =
    resolveScore(match);

  const status =
    resolveStatus(match);

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
      ) || null,

    startingAt,

    status: {
      short:
        status.rawStatus,

      long:
        status.statusDetail ||
        status.rawStatus,

      live:
        status.live,

      finished:
        status.finished,
    },

    league: {
      id:
        safeString(
          league?.id
        ) || null,

      name:
        safeString(
          league?.name
        ),

      country:
        safeString(
          league?.country
        ) || null,

      logo:
        safeString(
          league?.logo
        ) || null,
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
        ) || null,

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
        ) || null,

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
        score.home,

      away:
        score.away,

      display:
        score.display,
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
    const apiKey =
      process.env
        .SPORTSRC_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "SPORTSRC_API_KEY manquant.",
          fixtures: [],
        },
        {
          status: 500,
        }
      );
    }

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

    /*
     * v4 pour abandonner immédiatement
     * les anciens caches v3 de 15 minutes.
     */
    const cacheKey =
      `football:africa:v4:${date}`;

    const cached =
      readCache<
        FootballFixture[]
      >(cacheKey);

    if (
      Array.isArray(cached)
    ) {
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

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,

          error:
            `SportSRC HTTP ${response.status}`,

          detail:
            raw.slice(
              0,
              400
            ),

          fixtures: [],
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

    let payload: any;

    try {
      payload =
        JSON.parse(raw);
    } catch {
      return NextResponse.json(
        {
          success: false,

          error:
            "SportSRC a renvoyé une réponse non JSON.",

          detail:
            raw.slice(
              0,
              400
            ),

          fixtures: [],
        },
        {
          status: 502,
        }
      );
    }

    const groups =
      resolveGroups(
        payload
      );

    const africanGroups =
      groups.filter(
        (group) =>
          looksAfrican(
            group
          )
      );

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
                  item !== null
              )
        )
        .filter(
          (fixture) =>
            fixture.home.name &&
            fixture.away.name
        )
        .sort(
          (a, b) => {
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
              aTime - bTime
            );
          }
        );

    /*
     * IMPORTANT :
     *
     * S'il existe un match live,
     * le cache ne dure que 15 secondes.
     *
     * Sinon 2 minutes suffisent.
     */
    const hasLive =
      fixtures.some(
        (fixture) =>
          fixture.status.live
      );

    writeCache(
      cacheKey,
      fixtures,
      hasLive
        ? LIVE_CACHE_MS
        : IDLE_CACHE_MS
    );

    return NextResponse.json({
      success: true,

      provider:
        "sportsrc",

      cached: false,

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
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "SportSRC indisponible.",

        fixtures: [],
      },
      {
        status: 500,
      }
    );
  }
}
