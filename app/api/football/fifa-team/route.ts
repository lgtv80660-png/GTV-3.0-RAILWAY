import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FIFA_CALENDAR =
  "https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=500&language=en";
const FIFA_LIVE_BASE = "https://api.fifa.com/api/v3/live/football";

const TEAM_TTL = 24 * 60 * 60 * 1000;
const CALENDAR_TTL = 12 * 60 * 60 * 1000;

type AnyObject = Record<string, any>;
type CacheEntry = { expires: number; data: any };

type NormalizedPlayer = {
  id: string;
  name: string;
  fullName: string;
  number: number | null;
  position: "Gardien" | "Défenseur" | "Milieu" | "Attaquant";
  positionCode: "GK" | "DF" | "MF" | "FW";
  photo: string | null;
};

const globalForFifa = globalThis as typeof globalThis & {
  __gtvFifaTeamCache?: Map<string, CacheEntry>;
  __gtvFifaCalendarCache?: CacheEntry;
};

const teamCache = globalForFifa.__gtvFifaTeamCache ?? new Map<string, CacheEntry>();
globalForFifa.__gtvFifaTeamCache = teamCache;

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TEAM_ALIASES: Record<string, string[]> = {
  alg: ["algeria", "algerie"],
  arg: ["argentina", "argentine"],
  aus: ["australia", "australie"],
  aut: ["austria", "autriche"],
  bel: ["belgium", "belgique"],
  bra: ["brazil", "bresil"],
  can: ["canada"],
  civ: ["cote d ivoire", "ivory coast"],
  col: ["colombia", "colombie"],
  cro: ["croatia", "croatie"],
  ecu: ["ecuador", "equateur"],
  egy: ["egypt", "egypte"],
  eng: ["england", "angleterre"],
  esp: ["spain", "espagne"],
  fra: ["france"],
  ger: ["germany", "allemagne"],
  gha: ["ghana"],
  hai: ["haiti"],
  irn: ["iran", "ir iran"],
  jpn: ["japan", "japon"],
  kor: ["korea republic", "south korea", "coree du sud"],
  mar: ["morocco", "maroc"],
  mex: ["mexico", "mexique"],
  ned: ["netherlands", "pays bas"],
  nor: ["norway", "norvege"],
  nzl: ["new zealand", "nouvelle zelande"],
  pan: ["panama"],
  par: ["paraguay"],
  por: ["portugal"],
  qat: ["qatar"],
  ksa: ["saudi arabia", "arabie saoudite"],
  sco: ["scotland", "ecosse"],
  sen: ["senegal"],
  rsa: ["south africa", "afrique du sud"],
  sui: ["switzerland", "suisse"],
  tun: ["tunisia", "tunisie"],
  tur: ["turkiye", "turkey", "turquie"],
  uru: ["uruguay"],
  usa: ["usa", "united states", "united states of america", "etats unis"],
  uzb: ["uzbekistan", "ouzbekistan"],
};

function fifaText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const english = value.find((item) => String(item?.Locale || "").toLowerCase().startsWith("en"));
    const selected = english ?? value[0];
    return String(selected?.Description ?? selected?.Value ?? selected?.Name ?? "");
  }
  if (typeof value === "object") {
    return String(value.Description ?? value.Value ?? value.Name ?? "");
  }
  return String(value);
}

function resolveRequestedCode(teamName: string, explicitCode: string) {
  const code = explicitCode.trim().toLowerCase();
  if (code.length === 3) return code;

  const target = normalize(teamName);
  for (const [candidate, aliases] of Object.entries(TEAM_ALIASES)) {
    if (aliases.some((alias) => normalize(alias) === target)) return candidate;
  }
  return "";
}

async function getCalendar() {
  const cached = globalForFifa.__gtvFifaCalendarCache;
  if (cached && cached.expires > Date.now()) return cached.data;

  const response = await fetch(FIFA_CALENDAR, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 GTV/3.0" },
    next: { revalidate: 21600 },
  });
  if (!response.ok) throw new Error(`FIFA calendar ${response.status}`);

  const data = await response.json();
  globalForFifa.__gtvFifaCalendarCache = { expires: Date.now() + CALENDAR_TTL, data };
  return data;
}

function getSide(match: AnyObject, side: "Home" | "Away") {
  return match?.[side] ?? match?.[`${side}Team`] ?? {};
}

function getCountryCode(side: AnyObject) {
  return String(side?.IdCountry ?? side?.Abbreviation ?? side?.CountryCode ?? "").toUpperCase();
}

function matchId(match: AnyObject) {
  return String(match?.IdMatch ?? match?.MatchId ?? match?.Id ?? "");
}

function findMatch(matches: AnyObject[], code: string, requestedName: string) {
  const upper = code.toUpperCase();
  const acceptable = new Set([
    normalize(requestedName),
    ...(TEAM_ALIASES[code] ?? []).map(normalize),
  ].filter(Boolean));

  return matches.find((match) => {
    const home = getSide(match, "Home");
    const away = getSide(match, "Away");
    const homeCode = getCountryCode(home);
    const awayCode = getCountryCode(away);
    if (upper && (homeCode === upper || awayCode === upper)) return true;

    const homeName = normalize(fifaText(home?.TeamName ?? home?.Name));
    const awayName = normalize(fifaText(away?.TeamName ?? away?.Name));
    return acceptable.has(homeName) || acceptable.has(awayName);
  });
}

async function getLiveMatch(id: string) {
  const response = await fetch(`${FIFA_LIVE_BASE}/${encodeURIComponent(id)}?language=en`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 GTV/3.0" },
    next: { revalidate: 21600 },
  });
  if (!response.ok) throw new Error(`FIFA live ${response.status}`);
  return response.json();
}

function playerName(player: AnyObject) {
  return fifaText(player?.ShortName) || fifaText(player?.PlayerName);
}

function playerFullName(player: AnyObject) {
  return fifaText(player?.PlayerName) || playerName(player);
}

function positionFromFifa(value: unknown): Pick<NormalizedPlayer, "position" | "positionCode"> {
  const number = Number(value);
  if (number === 0) return { position: "Gardien", positionCode: "GK" };
  if (number === 1) return { position: "Défenseur", positionCode: "DF" };
  if (number === 2) return { position: "Milieu", positionCode: "MF" };
  return { position: "Attaquant", positionCode: "FW" };
}

function normalizePlayers(players: AnyObject[]): NormalizedPlayer[] {
  return players
    .map((player): NormalizedPlayer | null => {
      const id = String(player?.IdPlayer ?? player?.PlayerId ?? "");
      const name = playerName(player);
      if (!id || !name) return null;

      const position = positionFromFifa(player?.Position);
      const shirt = Number(player?.ShirtNumber);
      const picture = String(player?.PlayerPicture?.PictureUrl ?? player?.PictureUrl ?? "").trim();

      return {
        id,
        name,
        fullName: playerFullName(player),
        number: Number.isFinite(shirt) ? shirt : null,
        position: position.position,
        positionCode: position.positionCode,
        photo: picture || null,
      };
    })
    .filter((player): player is NormalizedPlayer => Boolean(player))
    .sort((a, b) => {
      const order = { GK: 0, DF: 1, MF: 2, FW: 3 } as const;
      return order[a.positionCode] - order[b.positionCode] || (a.number ?? 999) - (b.number ?? 999);
    });
}

export async function GET(request: NextRequest) {
  const teamName = request.nextUrl.searchParams.get("team")?.trim() || "";
  const explicitCode = request.nextUrl.searchParams.get("code")?.trim() || "";

  if (!teamName) {
    return NextResponse.json({ success: false, error: "Nom d'équipe manquant" }, { status: 400 });
  }

  const requestedCode = resolveRequestedCode(teamName, explicitCode);
  const cacheKey = `${requestedCode}:${normalize(teamName)}`;
  const cached = teamCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
    });
  }

  try {
    const calendar = await getCalendar();
    const matches = Array.isArray(calendar?.Results) ? calendar.Results : [];
    const match = findMatch(matches, requestedCode, teamName);

    if (!match) {
      const result = { success: true, available: false, players: [] };
      teamCache.set(cacheKey, { expires: Date.now() + TEAM_TTL, data: result });
      return NextResponse.json(result);
    }

    const id = matchId(match);
    if (!id) throw new Error("ID FIFA introuvable");

    const live = await getLiveMatch(id);
    const home = live?.HomeTeam ?? {};
    const away = live?.AwayTeam ?? {};
    const wanted = requestedCode.toUpperCase();

    let side: AnyObject | null = null;
    if (wanted && getCountryCode(home) === wanted) side = home;
    else if (wanted && getCountryCode(away) === wanted) side = away;
    else {
      const target = normalize(teamName);
      const homeName = normalize(fifaText(home?.TeamName ?? home?.Name));
      const awayName = normalize(fifaText(away?.TeamName ?? away?.Name));
      if (homeName === target) side = home;
      else if (awayName === target) side = away;
    }

    if (!side) throw new Error("Équipe introuvable dans les données FIFA");

    const rawPlayers = Array.isArray(side?.Players) ? side.Players : [];
    const players = normalizePlayers(rawPlayers);
    if (!players.length) {
      const result = { success: true, available: false, players: [] };
      teamCache.set(cacheKey, { expires: Date.now() + TEAM_TTL, data: result });
      return NextResponse.json(result);
    }

    const result = {
      success: true,
      available: true,
      team: {
        name: fifaText(side?.TeamName ?? side?.Name) || teamName,
        code: getCountryCode(side) || requestedCode.toUpperCase(),
      },
      players,
    };

    teamCache.set(cacheKey, { expires: Date.now() + TEAM_TTL, data: result });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    console.error("[FIFA TEAM]", error);
    return NextResponse.json(
      {
        success: false,
        available: false,
        players: [],
        error: error instanceof Error ? error.message : "FIFA indisponible",
      },
      { status: 502 }
    );
  }
}
