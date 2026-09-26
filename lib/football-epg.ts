export type LiveChannel = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string;
  category_id: string;
};

export type FootballFixtureLike = {
  id: string;
  home: { name: string };
  away: { name: string };
  startingAt: string;
};

export type EpgProgramme = {
  id?: string | number;
  title?: string;
  description?: string;
  start?: string;
  end?: string;
  start_timestamp?: number | string;
  stop_timestamp?: number | string;
  now_playing?: number | boolean;
  has_archive?: number | boolean;
};

export type MatchBroadcast = {
  fixtureId: string;
  channel: LiveChannel;
  programme: {
    title: string;
    description: string;
    start: string | null;
    end: string | null;
  };
  score: number;
};

export function normalizeEpgText(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(hd|fhd|uhd|4k|hevc|h264|h265|live|direct|match|football|soccer)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const aliases: Record<string, string[]> = {
  turkiye: ["turkey"],
  turkey: ["turkiye"],
  "cote d ivoire": ["ivory coast"],
  "ivory coast": ["cote d ivoire"],
  usa: ["united states"],
  "united states": ["usa"],
  "south korea": ["korea republic"],
  "korea republic": ["south korea"],
  "guinea bissau": ["guinea-bissau"],
};

function teamVariants(name: string) {
  const normalized = normalizeEpgText(name);
  return [normalized, ...(aliases[normalized] ?? [])].filter(Boolean);
}

export function isSportsChannel(name: string) {
  const value = normalizeEpgText(name);
  return [
    "bein",
    "sport",
    "sports",
    "canal foot",
    "canal plus foot",
    "sky",
    "dazn",
    "rmc",
    "supersport",
    "football",
    "foot",
    "espn",
    "eurosport",
  ].some((token) => value.includes(normalizeEpgText(token)));
}

function containsVariant(text: string, variants: string[]) {
  return variants.some((variant) => variant.length >= 3 && text.includes(variant));
}

export function scoreProgramme(fixture: FootballFixtureLike, programme: EpgProgramme) {
  const text = normalizeEpgText(
    [programme.title, programme.description].filter(Boolean).join(" ")
  );
  if (!text) return 0;

  const home = teamVariants(fixture.home.name);
  const away = teamVariants(fixture.away.name);
  const hasHome = containsVariant(text, home);
  const hasAway = containsVariant(text, away);

  if (hasHome && hasAway) return 100;
  if (hasHome || hasAway) return 40;
  return 0;
}

function timestampToIso(value: string | number | undefined) {
  if (value === undefined || value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function normalizeProgramme(raw: EpgProgramme) {
  return {
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" ? raw.description : "",
    start: raw.start || timestampToIso(raw.start_timestamp),
    end: raw.end || timestampToIso(raw.stop_timestamp),
  };
}
