export type BeinRegion = "france" | "mena";

export type BeinProgramme = {
  region: BeinRegion;
  channel: string;
  title: string;
  description?: string | null;
  category: string | null;
  start: string | null;
  end: string | null;
  live: boolean;
};

export type LiveChannel = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string;
  category_id: string;
};

export type FixtureLike = {
  id: string;
  startingAt: string;
  home: { name: string };
  away: { name: string };
};

export function normalizeGuideText(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\+/g, " plus ")
    .replace(/\b(hd|fhd|uhd|4k|hevc|h264|h265|live|direct|channel|chaine|tv)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TEAM_ALIASES: Record<string, string[]> = {
  turkiye: ["turkey"],
  turkey: ["turkiye"],
  "cote d ivoire": ["ivory coast"],
  "ivory coast": ["cote d ivoire"],
  "guinea bissau": ["guinea bissau", "guinea-bissau", "guinee bissau", "guinee-bissau"],
  "guinee bissau": ["guinea bissau", "guinea-bissau"],
  "united states": ["usa", "us"],
  usa: ["united states", "us"],
  "south korea": ["korea republic", "republic of korea"],
  "korea republic": ["south korea", "republic of korea"],
  "northern ireland": ["n ireland", "northern ireland"],
  "bosnia and herzegovina": ["bosnia herzegovina", "bosnia"],
  "cape verde": ["cabo verde"],
  "cabo verde": ["cape verde"],
};

function variants(name: string) {
  const base = normalizeGuideText(name);
  const generated = new Set<string>([base, ...(TEAM_ALIASES[base] ?? [])]);

  // Variantes utiles pour les noms composés et les feeds qui raccourcissent légèrement.
  const tokens = base.split(" ").filter(Boolean);
  if (tokens.length >= 2) {
    generated.add(tokens.join(" "));
    if (tokens.every((token) => token.length >= 4)) {
      generated.add(tokens.slice(-2).join(" "));
    }
  }

  return [...generated]
    .map(normalizeGuideText)
    .filter((value) => value.length >= 3);
}

function hasAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}

function tokenOverlap(text: string, teamName: string) {
  const textTokens = new Set(normalizeGuideText(text).split(" ").filter((token) => token.length >= 3));
  const teamTokens = normalizeGuideText(teamName).split(" ").filter((token) => token.length >= 3);
  if (teamTokens.length === 0) return 0;
  const common = teamTokens.filter((token) => textTokens.has(token)).length;
  return common / teamTokens.length;
}

export function programmeMatchScore(programme: BeinProgramme, fixture: FixtureLike) {
  const title = normalizeGuideText(programme.title);
  const description = normalizeGuideText(programme.description || "");
  const category = normalizeGuideText(programme.category || "");
  const text = `${title} ${description} ${category}`.trim();
  if (!text) return 0;

  const homeVariants = variants(fixture.home.name);
  const awayVariants = variants(fixture.away.name);

  const homeInTitle = hasAny(title, homeVariants);
  const awayInTitle = hasAny(title, awayVariants);
  const homeAnywhere = homeInTitle || hasAny(text, homeVariants);
  const awayAnywhere = awayInTitle || hasAny(text, awayVariants);

  // Cas idéal : les deux équipes sont dans le titre.
  if (homeInTitle && awayInTitle) return programme.live ? 160 : 145;

  // Les deux équipes existent dans titre + description/catégorie.
  if (homeAnywhere && awayAnywhere) return programme.live ? 145 : 130;

  // Fallback utile pour certains XMLTV où les noms sont légèrement raccourcis.
  const homeOverlap = tokenOverlap(text, fixture.home.name);
  const awayOverlap = tokenOverlap(text, fixture.away.name);
  if (homeOverlap >= 0.99 && awayOverlap >= 0.99) return programme.live ? 140 : 125;

  // Une seule équipe n'est jamais suffisante pour afficher un diffuseur : trop de faux positifs.
  return 0;
}

function channelSignature(name: string) {
  const text = normalizeGuideText(name)
    .replace(/\bbein\b/g, "bein")
    .replace(/\bsports?\b/g, "sport")
    .trim();

  const fr = /\bfr\s*(\d+)\b/.exec(text);
  if (fr) return { family: "fr", number: fr[1], text };

  const en = /\ben\s*(\d+)\b/.exec(text);
  if (en) return { family: "en", number: en[1], text };

  const max = /\bmax\s*(\d+)\b/.exec(text);
  if (max) return { family: "max", number: max[1], text };

  const xtra = /\bxtra\s*(\d+)\b/.exec(text);
  if (xtra) return { family: "xtra", number: xtra[1], text };

  const generic = /\bbein\s+sport\s*(\d+)\b/.exec(text);
  if (generic) return { family: "main", number: generic[1], text };

  return { family: "unknown", number: null as string | null, text };
}

export function channelMatchScore(
  guideChannel: string,
  xtreamChannel: LiveChannel,
  region: BeinRegion,
  categoryName = ""
) {
  const guide = channelSignature(guideChannel);
  const xtream = channelSignature(xtreamChannel.name);
  const xtreamText = normalizeGuideText(xtreamChannel.name);
  const category = normalizeGuideText(categoryName);

  if (!xtreamText.includes("bein")) return 0;

  let score = 0;

  if (guide.family !== "unknown" && guide.family === xtream.family) score += 75;
  if (guide.number && xtream.number && guide.number === xtream.number) score += 70;
  if (guide.text === xtream.text) score += 80;
  if (xtreamText.includes(guide.text) || guide.text.includes(xtreamText)) score += 45;

  // Une chaîne numérotée doit garder le même numéro. Evite beIN 1 -> beIN 2.
  if (guide.number && xtream.number && guide.number !== xtream.number) score -= 90;

  if (region === "france") {
    if (/\bfr\b|france|french/.test(xtreamText) || /france|french/.test(category)) score += 25;
    if (/\bar\b|arab|mena/.test(xtreamText) || /arab|mena/.test(category)) score -= 15;
  } else {
    if (/\bar\b|arab|mena/.test(xtreamText) || /arab|mena/.test(category)) score += 20;
    if (guide.family === "fr" && /\bfr\b|france|french/.test(xtreamText)) score += 25;
  }

  return score;
}

export function findXtreamChannelsForProgramme(
  programme: BeinProgramme,
  channels: LiveChannel[],
  categoryName = ""
) {
  return channels
    .map((channel) => ({
      channel,
      score: channelMatchScore(programme.channel, channel, programme.region, categoryName),
    }))
    .filter((item) => item.score >= 80)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((item) => item.channel);
}
