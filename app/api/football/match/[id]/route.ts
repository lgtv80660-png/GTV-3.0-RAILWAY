import {
  NextRequest,
  NextResponse,
} from "next/server";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

const ESPN_BASE =
  "https://site.api.espn.com/apis/site/v2/sports/soccer";

type AnyObject =
  Record<string, any>;

type Player = {
  id: string;
  name: string;
  shortName: string;

  jersey:
    | string
    | null;

  position:
    | string
    | null;

  starter: boolean;

  image:
    | string
    | null;
};

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

function str(
  value: unknown
) {
  return typeof value ===
    "string"
    ? value
    : "";
}

function unique(
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
   BROADCASTS
========================================================= */

function extractBroadcasts(
  competition: AnyObject
) {
  const names:
    string[] =
    [];

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
          names.push(name);
        }
      }
    }
  }

  for (
    const item of
    asArray(
      competition?.geoBroadcasts
    )
  ) {
    const media =
      str(
        item?.media
          ?.shortName
      ) ||
      str(
        item?.media
          ?.name
      );

    if (media) {
      names.push(media);
    }
  }

  return unique(names);
}

/* =========================================================
   PLAYER
========================================================= */

function normalizePlayer(
  item: AnyObject
): Player | null {
  const athlete =
    item?.athlete ??
    item;

  const name =
    str(
      athlete?.displayName
    ) ||
    str(
      athlete?.fullName
    ) ||
    str(
      athlete?.name
    );

  if (!name) {
    return null;
  }

  const id =
    str(
      athlete?.id
    ) ||
    name;

  const starter =
    item?.starter ===
      true ||
    item?.didStart ===
      true ||
    athlete?.starter ===
      true;

  return {
    id,

    name,

    shortName:
      str(
        athlete?.shortName
      ) ||
      name,

    jersey:
      str(
        item?.jersey
      ) ||
      str(
        athlete?.jersey
      ) ||
      null,

    position:
      str(
        item?.position
          ?.abbreviation
      ) ||
      str(
        athlete?.position
          ?.abbreviation
      ) ||
      str(
        item?.position
          ?.name
      ) ||
      null,

    starter,

    image:
      str(
        athlete?.headshot
          ?.href
      ) ||
      null,
  };
}

/* =========================================================
   PLAYERS FROM COMPETITOR
========================================================= */

function playersFromCompetitor(
  competitor: AnyObject
) {
  const raw =
    asArray(
      competitor?.players
    );

  const players =
    raw
      .map(
        normalizePlayer
      )
      .filter(
        (
          player
        ): player is Player =>
          player !== null
      );

  /*
   * Si ESPN donne starter
   */
  let starters =
    players.filter(
      (player) =>
        player.starter
    );

  let bench =
    players.filter(
      (player) =>
        !player.starter
    );

  /*
   * Certains feeds mettent
   * les titulaires en premier
   * sans starter=true.
   */
  if (
    starters.length === 0 &&
    players.length >= 11
  ) {
    starters =
      players.slice(
        0,
        11
      );

    bench =
      players.slice(
        11
      );
  }

  return {
    starters,
    bench,
    all:
      players,
  };
}

/* =========================================================
   FALLBACK FROM ROSTERS
========================================================= */

function playersFromRosterBlock(
  block: AnyObject
) {
  const raw = [
    ...asArray(
      block?.roster
    ),

    ...asArray(
      block?.athletes
    ),
  ];

  const players =
    raw
      .map(
        normalizePlayer
      )
      .filter(
        (
          player
        ): player is Player =>
          player !== null
      );

  return {
    starters:
      players.filter(
        (player) =>
          player.starter
      ),

    bench:
      players.filter(
        (player) =>
          !player.starter
      ),
  };
}

/* =========================================================
   GET
========================================================= */

export async function GET(
  _request:
    NextRequest,

  context: {
    params: Promise<{
      id: string;
    }>;
  }
) {
  try {
    const {
      id,
    } =
      await context.params;

    const decoded =
      decodeURIComponent(id);

    if (
      !decoded.startsWith(
        "espn:"
      )
    ) {
      return NextResponse.json({
        success: true,

        provider:
          "sportsrc",

        lineupType:
          "none",

        broadcasts: [],

        home: null,

        away: null,
      });
    }

    const parts =
      decoded.split(":");

    const eventId =
      parts.at(-1);

    const league =
      parts
        .slice(
          1,
          -1
        )
        .join(":");

    if (
      !eventId ||
      !league
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "ID ESPN invalide",
        },
        {
          status: 400,
        }
      );
    }

    const summaryUrl =
      `${ESPN_BASE}/${league}/summary?event=${encodeURIComponent(
        eventId
      )}`;

    const response =
      await fetch(
        summaryUrl,
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
      return NextResponse.json(
        {
          success: false,

          error:
            `ESPN Summary HTTP ${response.status}`,
        },
        {
          status: 502,
        }
      );
    }

    const summary =
      await response.json();

    const competition =
      summary?.header
        ?.competitions?.[0];

    if (!competition) {
      return NextResponse.json({
        success: true,

        provider:
          "espn",

        lineupType:
          "none",

        broadcasts:
          [],

        home:
          null,

        away:
          null,

        debug:
          "No header.competitions[0]",
      });
    }

    const competitors =
      asArray(
        competition
          ?.competitors
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
      return NextResponse.json({
        success: true,

        provider:
          "espn",

        lineupType:
          "none",

        broadcasts:
          extractBroadcasts(
            competition
          ),

        home:
          null,

        away:
          null,
      });
    }

    /* =====================================================
       FIRST SOURCE:
       competitor.players
    ===================================================== */

    let homePlayers =
      playersFromCompetitor(
        home
      );

    let awayPlayers =
      playersFromCompetitor(
        away
      );

    /* =====================================================
       FALLBACK:
       summary.rosters
    ===================================================== */

    if (
      homePlayers
        .all.length ===
      0
    ) {
      const rosterBlock =
        asArray(
          summary?.rosters
        ).find(
          (block) =>
            str(
              block?.team?.id
            ) ===
            str(
              home?.team?.id
            )
        );

      if (rosterBlock) {
        homePlayers =
          {
            ...playersFromRosterBlock(
              rosterBlock
            ),

            all:
              [],
          };
      }
    }

    if (
      awayPlayers
        .all.length ===
      0
    ) {
      const rosterBlock =
        asArray(
          summary?.rosters
        ).find(
          (block) =>
            str(
              block?.team?.id
            ) ===
            str(
              away?.team?.id
            )
        );

      if (rosterBlock) {
        awayPlayers =
          {
            ...playersFromRosterBlock(
              rosterBlock
            ),

            all:
              [],
          };
      }
    }

    /* =====================================================
       BROADCASTS
    ===================================================== */

    const broadcasts =
      extractBroadcasts(
        competition
      );

    /* =====================================================
       DEBUG STRUCTURE
    ===================================================== */

    console.log(
      "[ESPN MATCH]",
      {
        league,
        eventId,

        homePlayers:
          homePlayers
            .starters.length,

        awayPlayers:
          awayPlayers
            .starters.length,

        homeTotal:
          asArray(
            home?.players
          ).length,

        awayTotal:
          asArray(
            away?.players
          ).length,

        broadcasts,
      }
    );

    const official =
      homePlayers
        .starters.length >=
        7 &&
      awayPlayers
        .starters.length >=
        7;

    return NextResponse.json({
      success: true,

      provider:
        "espn",

      league,

      eventId,

      lineupType:
        official
          ? "official"
          : "none",

      broadcasts,

      home: {
        id:
          str(
            home?.team?.id
          ),

        name:
          str(
            home?.team
              ?.displayName
          ) ||
          str(
            home?.team?.name
          ),

        logo:
          str(
            home?.team?.logo
          ) ||
          null,

        formation:
          str(
            home?.formation
          ) ||
          null,

        starters:
          homePlayers.starters,

        bench:
          homePlayers.bench,
      },

      away: {
        id:
          str(
            away?.team?.id
          ),

        name:
          str(
            away?.team
              ?.displayName
          ) ||
          str(
            away?.team?.name
          ),

        logo:
          str(
            away?.team?.logo
          ) ||
          null,

        formation:
          str(
            away?.formation
          ) ||
          null,

        starters:
          awayPlayers.starters,

        bench:
          awayPlayers.bench,
      },

      /*
       * TEMPORAIRE mais utile:
       * pour voir ce qu'ESPN
       * renvoie réellement.
       */
      debug: {
        competitionId:
          str(
            competition?.id
          ),

        homePlayersRaw:
          asArray(
            home?.players
          ).length,

        awayPlayersRaw:
          asArray(
            away?.players
          ).length,

        broadcastsRaw:
          asArray(
            competition
              ?.broadcasts
          ).length,

        geoBroadcastsRaw:
          asArray(
            competition
              ?.geoBroadcasts
          ).length,
      },
    });
  } catch (error) {
    console.error(
      "[ESPN MATCH]",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Match ESPN indisponible",
      },
      {
        status: 500,
      }
    );
  }
}