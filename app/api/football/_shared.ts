export type FootballProvider =
  | "espn"
  | "sportsrc";

export type FootballTeam = {
  id: string;
  name: string;
  code: string | null;
  logo: string | null;
};

export type FootballFixture = {
  id: string;

  provider:
    FootballProvider;

  providerMatchId:
    string;

  competitionId:
    string | null;

  startingAt: string;

  status: {
    short: string;
    long: string;
    live: boolean;
    finished: boolean;
  };

  league: {
    id:
      | string
      | null;

    name: string;

    country:
      | string
      | null;

    logo:
      | string
      | null;
  };

  home: FootballTeam;

  away: FootballTeam;

  score: {
    home:
      | number
      | null;

    away:
      | number
      | null;

    display:
      | string
      | null;
  };

  /*
   * Diffuseurs retournés
   * par la source lorsque
   * disponibles.
   */
  broadcasts?: string[];
};

export type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const globalStore =
  globalThis as typeof globalThis & {
    __gtvFootballCache?: Map<
      string,
      CacheEntry<unknown>
    >;
  };

if (
  !globalStore.__gtvFootballCache
) {
  globalStore.__gtvFootballCache =
    new Map();
}

const CACHE =
  globalStore.__gtvFootballCache;

export function readCache<T>(
  key: string
): T | null {
  const entry =
    CACHE.get(key);

  if (!entry) {
    return null;
  }

  if (
    Date.now() >
    entry.expiresAt
  ) {
    CACHE.delete(key);

    return null;
  }

  return entry.value as T;
}

export function writeCache<T>(
  key: string,
  value: T,
  ttlMs: number
) {
  CACHE.set(
    key,
    {
      value,

      expiresAt:
        Date.now() +
        ttlMs,
    }
  );
}

export function safeTimeZone(
  value: string | null
) {
  if (!value) {
    return "UTC";
  }

  try {
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          value,
      }
    ).format(
      new Date()
    );

    return value;
  } catch {
    return "UTC";
  }
}

export function safeDate(
  value: string | null
) {
  if (
    value &&
    /^\d{4}-\d{2}-\d{2}$/.test(
      value
    )
  ) {
    return value;
  }

  return new Date()
    .toISOString()
    .slice(
      0,
      10
    );
}

export function compactDate(
  date: string
) {
  return date.replace(
    /-/g,
    ""
  );
}

export function safeNumber(
  value: unknown
): number | null {
  if (
    typeof value ===
      "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    typeof value ===
      "string" &&
    value.trim()
  ) {
    const parsed =
      Number(value);

    if (
      Number.isFinite(
        parsed
      )
    ) {
      return parsed;
    }
  }

  return null;
}

export function safeString(
  value: unknown
) {
  return typeof value ===
    "string"
    ? value
    : "";
}

export function normalizeText(
  value: string
) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

export function fixtureKey(
  fixture:
    FootballFixture
) {
  return [
    normalizeText(
      fixture.home.name
    ),

    normalizeText(
      fixture.away.name
    ),

    fixture.startingAt.slice(
      0,
      16
    ),
  ].join("|");
}