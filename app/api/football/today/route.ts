import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  type FootballFixture,
  fixtureKey,
  readCache,
  safeDate,
  safeTimeZone,
  writeCache,
} from "../_shared";

import {
  GET as getEurope,
} from "../europe/route";

import {
  GET as getAfrica,
} from "../africa/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SourceResponse = {
  success: boolean;
  fixtures?: FootballFixture[];
  error?: string;
};

async function callSource(
  handler: (
    request: NextRequest
  ) => Promise<Response> | Response,
  requestUrl: string
): Promise<FootballFixture[]> {
  try {
    const request = new NextRequest(
      requestUrl,
      {
        method: "GET",
      }
    );

    const response =
      await handler(request);

    if (!response.ok) {
      console.error(
        "[football/today] source error:",
        response.status,
        requestUrl
      );

      return [];
    }

    const data =
      (await response.json()) as SourceResponse;

    if (
      !data.success ||
      !Array.isArray(data.fixtures)
    ) {
      console.error(
        "[football/today] invalid source response:",
        requestUrl,
        data.error
      );

      return [];
    }

    return data.fixtures;
  } catch (error) {
    console.error(
      "[football/today] source exception:",
      requestUrl,
      error
    );

    return [];
  }
}

export async function GET(
  request: NextRequest
) {
  const url = new URL(request.url);

  const date =
    safeDate(
      url.searchParams.get("date")
    );

  const timeZone =
    safeTimeZone(
      url.searchParams.get("timezone")
    );

  const cacheKey =
    `football:today:${date}:${timeZone}`;

  const cached =
    readCache<FootballFixture[]>(
      cacheKey
    );

  if (
    Array.isArray(cached) &&
    cached.length > 0
  ) {
    return NextResponse.json({
      success: true,
      cached: true,
      date,
      timezone: timeZone,
      sources: {
        cached: true,
      },
      count: cached.length,
      fixtures: cached,
    });
  }

  const query =
    new URLSearchParams({
      date,
      timezone: timeZone,
    });

  const europeUrl =
    `${url.origin}/api/football/europe?${query.toString()}`;

  const africaUrl =
    `${url.origin}/api/football/africa?${query.toString()}`;

  const [europe, africa] =
    await Promise.all([
      callSource(
        getEurope,
        europeUrl
      ),
      callSource(
        getAfrica,
        africaUrl
      ),
    ]);

  const map =
    new Map<string, FootballFixture>();

  for (
    const fixture of [
      ...europe,
      ...africa,
    ]
  ) {
    const key =
      fixtureKey(fixture);

    const existing =
      map.get(key);

    if (!existing) {
      map.set(
        key,
        fixture
      );

      continue;
    }

    if (
      fixture.provider === "sportsrc" &&
      existing.provider !== "sportsrc"
    ) {
      map.set(
        key,
        fixture
      );
    }
  }

  const fixtures =
    [...map.values()]
      .filter(
        (
          fixture
        ): fixture is FootballFixture =>
          Boolean(fixture?.startingAt)
      )
      .sort(
        (a, b) =>
          new Date(a.startingAt).getTime() -
          new Date(b.startingAt).getTime()
      );

  if (fixtures.length > 0) {
    writeCache(
      cacheKey,
      fixtures,
      5 * 60 * 1000
    );
  }

  return NextResponse.json({
    success: true,
    cached: false,
    date,
    timezone: timeZone,
    sources: {
      espn: europe.length,
      sportsrc: africa.length,
    },
    count: fixtures.length,
    fixtures,
  });
}
