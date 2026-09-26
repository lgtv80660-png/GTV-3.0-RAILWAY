export type LogoSource = "tv-logo" | "yasser";

export type ChannelIdentity = {
  raw: string;
  normalized: string;
  tokens: string[];
  brandTokens: string[];
  variantTokens: string[];
  countryHint: string | null;
  number: number | null;
};

export type LogoCandidate = {
  source: LogoSource;
  path: string;
  url: string;
  filename: string;
  identity: ChannelIdentity;
  countryCode: string | null;
};

export type CandidateScore = {
  score: number;
  accepted: boolean;
  reason: string;
};

export type ResolvedChannelLogo = {
  url: string;
  source: LogoSource;
  path: string;
  score: number;
  canonicalInput: string;
};

const TECH_WORDS = new Set([
  "sd", "hd", "fhd", "uhd", "4k", "8k", "2k",
  "hevc", "h264", "h265", "x264", "x265", "avc", "mpeg2", "mpeg4",
  "25fps", "30fps", "50fps", "60fps", "fps",
  "live", "direct", "backup", "raw", "test", "new", "feed", "stream",
  "server", "srv", "host", "line", "panel", "dns", "ott", "vip", "multi",
  "multiscreen", "source", "stable", "copy", "mirror", "noevent", "event",
]);

const GENERIC_WORDS = new Set([
  "tv", "television", "channel", "chaine", "network", "the",
  "sport", "sports", "plus", "and", "international", "intl",
]);

const STRONG_VARIANTS = new Set([
  "fr", "en", "ar", "mena", "max", "news", "football", "foot", "premium",
  "cinema", "series", "movies", "movie", "kids", "music", "extra", "action",
  "family", "world", "liga", "golf", "tennis", "racing", "documentary",
]);

const COUNTRY_PREFIXES: Record<string, string> = {
  fr: "fr", france: "fr",
  uk: "uk", gb: "uk", england: "uk",
  us: "us", usa: "us",
  ca: "ca", canada: "ca",
  de: "de", germany: "de", deutschland: "de",
  es: "es", spain: "es", espana: "es",
  it: "it", italy: "it", italia: "it",
  pt: "pt", portugal: "pt",
  tr: "tr", turkey: "tr", turkiye: "tr",
  ae: "ae", uae: "ae",
  lb: "lb", lebanon: "lb",
  dz: "dz", algeria: "dz", algerie: "dz",
  ma: "ma", morocco: "ma", maroc: "ma",
  tn: "tn", tunisia: "tn", tunisie: "tn",
  sa: "sa", ksa: "sa",
  qa: "qa", qatar: "qa",
  be: "be", belgium: "be", belgique: "be",
  ch: "ch", switzerland: "ch", suisse: "ch",
  nl: "nl", netherlands: "nl",
  se: "se", sweden: "se",
  no: "no", norway: "no",
  dk: "dk", denmark: "dk",
  fi: "fi", finland: "fi",
  pl: "pl", poland: "pl",
  gr: "gr", greece: "gr",
  ro: "ro", romania: "ro",
};

const FAMILY_ALIASES: Array<[RegExp, string]> = [
  [/\bbe\s*in\b/g, "bein"],
  [/\bbein\s+sport\b/g, "bein sports"],
  [/\bcanal\s*\+\b/g, "canal plus"],
  [/\bcanalplus\b/g, "canal plus"],
  [/\bfranceinfo\b/g, "france info"],
  [/\bfrance\s+info\b/g, "france info"],
  [/\brmc\s*sport\b/g, "rmc sport"],
  [/\bsky\s*sport\b/g, "sky sports"],
  [/\btnt\s*sport\b/g, "tnt sports"],
  [/\bsuper\s*sport\b/g, "supersport"],
  [/\beuro\s*sport\b/g, "eurosport"],
  [/\bmovistar\s*\+\b/g, "movistar plus"],
  [/\btelecinco\b/g, "telecinco"],
  [/\bmediaset\s+italia\b/g, "mediaset italia"],
  [/\brai\s+uno\b/g, "rai 1"],
  [/\brai\s+due\b/g, "rai 2"],
  [/\brai\s+tre\b/g, "rai 3"],
  [/\brtl\s+zwei\b/g, "rtl 2"],
  [/\bzdf\s+neo\b/g, "zdf neo"],
  [/\bprogramme\s+national\b/g, "entv"],
  [/\bcanal\s+algerie\b/g, "algerie 2"],
  [/\balgerie\s+3\b/g, "a3"],
];

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function cleanRaw(input: string) {
  let value = stripDiacritics(input.toLowerCase());

  // Keep a real channel name inside brackets, but remove bracket groups that are clearly technical.
  value = value
    .replace(/\[([^\]]*)\]/g, (_all, group: string) => isTechnicalGroup(group) ? " " : ` ${group} `)
    .replace(/\(([^)]*)\)/g, (_all, group: string) => isTechnicalGroup(group) ? " " : ` ${group} `)
    .replace(/\{([^}]*)\}/g, (_all, group: string) => isTechnicalGroup(group) ? " " : ` ${group} `);

  const segments = value.split(/\s*(?:\||•|●|◆|◇|►|▶|¦|┃)\s*/g).filter(Boolean);
  if (segments.length > 1) {
    value = segments.filter((segment, index) => {
      const s = stripDiacritics(segment).replace(/[^a-z0-9+]+/g, " ").trim();
      if (!s) return false;
      if (isTechnicalGroup(s)) return false;
      if (index === 0 && COUNTRY_PREFIXES[s]) return false;
      return true;
    }).join(" ");
  }

  value = value
    .replace(/&/g, " and ")
    .replace(/[+]/g, " plus ")
    .replace(/[_:;,.\/\\]+/g, " ")
    .replace(/\bfull\s*hd\b/g, " ")
    .replace(/\bultra\s*hd\b/g, " ")
    .replace(/\b(?:h\.?264|h\.?265|x264|x265|hevc|avc|mpeg\s*2|mpeg\s*4)\b/g, " ")
    .replace(/\b(?:25|30|50|60)\s*fps\b/g, " ")
    .replace(/\b(?:240|360|480|540|576|720|1080|1440|2160)p\b/g, " ")
    .replace(/\b(?:sd|hd|fhd|uhd|4k|8k)\b/g, " ");

  // Bare resolution values are common Xtream suffixes. Keep 360 for the real "Canal+ Sport 360" identity.
  const canalSport360 = /\bcanal\s*(?:plus|\+)\s*sport\s*360\b/.test(value);
  if (canalSport360) value = value.replace(/\bcanal\s*(?:plus|\+)\s*sport\s*360\b/g, "canal plus sport __gtv360__");
  value = value.replace(/\b(?:240|360|480|540|576|720|1080|1440|2160)\b/g, " ");
  value = value.replace(/__gtv360__/g, "360");

  for (const [pattern, replacement] of FAMILY_ALIASES) value = value.replace(pattern, replacement);

  return value.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isTechnicalGroup(group: string) {
  const n = stripDiacritics(group.toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
  if (!n) return true;
  const parts = n.split(/\s+/);
  if (parts.some((p) => TECH_WORDS.has(p))) return true;
  if (/\b(?:240|360|480|540|576|720|1080|1440|2160)p?\b/.test(n)) return true;
  if (/\b(?:server|srv|host|line|vip|panel|dns)[-_ ]?[a-z0-9]*\b/.test(n)) return true;
  return false;
}

export function inferCountryHint(input: string): string | null {
  const raw = stripDiacritics(input.toLowerCase()).trim();
  const first = raw.match(/^\s*([a-z]{2,12})\s*(?:[:|¦┃\-])/i)?.[1];
  if (first && COUNTRY_PREFIXES[first]) return COUNTRY_PREFIXES[first];
  if (/\bbein\s+sports?\s+fr\b/.test(raw)) return "fr";
  if (/\b(?:mena|arab|arabic)\b/.test(raw)) return "ae";
  return null;
}

function extractNumber(tokens: string[]): number | null {
  const nums = tokens.filter((t) => /^\d{1,3}$/.test(t)).map(Number);
  return nums.length ? nums[nums.length - 1] : null;
}

export function analyzeChannelName(input: string): ChannelIdentity {
  const countryHint = inferCountryHint(input);
  let normalized = cleanRaw(input);
  let tokens = normalized.split(/\s+/).filter(Boolean).filter((t) => !TECH_WORDS.has(t));

  // A metadata country code at the start is not part of the identity.
  if (tokens.length > 1 && COUNTRY_PREFIXES[tokens[0]]) tokens = tokens.slice(1);

  normalized = tokens.join(" ");
  const number = extractNumber(tokens);
  const variantTokens = tokens.filter((t) => STRONG_VARIANTS.has(t));

  const brandTokens = tokens.filter((t) => {
    if (/^\d+$/.test(t)) return false;
    if (TECH_WORDS.has(t)) return false;
    if (STRONG_VARIANTS.has(t)) return false;
    if (GENERIC_WORDS.has(t)) return false;
    if (COUNTRY_PREFIXES[t]) return false;
    return true;
  });

  // If everything was generic, keep at least one textual anchor. This prevents number-only matching.
  if (brandTokens.length === 0) {
    const fallbackAnchor = tokens.find((t) => !/^\d+$/.test(t) && !TECH_WORDS.has(t));
    if (fallbackAnchor) brandTokens.push(fallbackAnchor);
  }

  return { raw: input, normalized, tokens, brandTokens, variantTokens, countryHint, number };
}

function normalizeFilename(path: string) {
  const filename = path.split("/").pop() || path;
  let stem = filename.replace(/\.(?:png|webp|jpg|jpeg|svg)$/i, "");
  stem = stem.replace(/-(?:hz|horizontal)$/i, "");
  stem = stem.replace(/-(?:us|uk|fr|de|es|it|pt|ca|au|nz|ie|ae|lb|tr|za|se|no|dk|fi|nl|be|ch|at|gr|pl|ro|rs|hr|cz|sk|si|hu|lt|lu|mt|mx|br|ar|cl|cr|in|id|my|ph|sg|hk|il|ua|ru|az|al|bg|intl)$/i, "");
  return stem.replace(/-/g, " ");
}

function extractCountryCode(path: string): string | null {
  const p = path.toLowerCase();
  const folderMap: Array<[RegExp, string]> = [
    [/\/france\//, "fr"], [/\/united-kingdom\//, "uk"], [/\/united-states\//, "us"],
    [/\/germany\//, "de"], [/\/spain\//, "es"], [/\/italy\//, "it"],
    [/\/united-arab-emirates\//, "ae"], [/\/lebanon\//, "lb"], [/\/turkey\//, "tr"],
    [/\/canada\//, "ca"], [/\/belgium\//, "be"], [/\/switzerland\//, "ch"],
  ];
  for (const [re, code] of folderMap) if (re.test(p)) return code;
  const filename = p.split("/").pop() || "";
  return filename.match(/-([a-z]{2,4})\.(?:png|webp|jpg|jpeg|svg)$/i)?.[1] || null;
}

export function makeCandidate(source: LogoSource, path: string, url: string): LogoCandidate {
  return {
    source,
    path,
    url,
    filename: path.split("/").pop() || path,
    identity: analyzeChannelName(normalizeFilename(path)),
    countryCode: extractCountryCode(path),
  };
}

function setOverlap(a: string[], b: string[]) {
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}

function significantVariantMismatch(input: ChannelIdentity, candidate: ChannelIdentity) {
  const inputStrong = input.variantTokens.filter((v) => !["fr", "en", "ar", "mena"].includes(v));
  const candSet = new Set(candidate.variantTokens);
  return inputStrong.some((v) => !candSet.has(v));
}

export function evaluateLogoCandidate(inputName: string, candidate: LogoCandidate): CandidateScore {
  const input = analyzeChannelName(inputName);
  const cand = candidate.identity;
  if (!input.normalized || !cand.normalized) return { score: -10000, accepted: false, reason: "empty identity" };

  const sharedBrand = setOverlap(input.brandTokens, cand.brandTokens);

  // HARD RULE #1: a number can never create identity. We need at least one true brand/name anchor.
  if (sharedBrand.length === 0) {
    return { score: -10000, accepted: false, reason: "no shared brand token" };
  }

  // HARD RULE #2: numbered networks must agree on channel number.
  if (input.number !== null) {
    if (cand.number === null) return { score: -9000, accepted: false, reason: "input numbered, candidate not numbered" };
    if (cand.number !== input.number) return { score: -9000, accepted: false, reason: "channel number mismatch" };
  } else if (cand.number !== null && input.tokens.length <= cand.tokens.length) {
    // Avoid TF1 -> random TF1 variant with a number, France -> France 2, etc.
    return { score: -8500, accepted: false, reason: "candidate has unexpected channel number" };
  }

  // HARD RULE #3: strong semantic subchannels must be preserved.
  if (significantVariantMismatch(input, cand)) {
    return { score: -8000, accepted: false, reason: "strong variant mismatch" };
  }

  let score = 0;
  if (cand.normalized === input.normalized) score += 1600;

  const inputSet = new Set(input.tokens);
  const candSet = new Set(cand.tokens);
  const commonTokens = [...inputSet].filter((t) => candSet.has(t));
  const union = new Set([...inputSet, ...candSet]);
  score += Math.round((commonTokens.length / Math.max(1, union.size)) * 550);
  score += sharedBrand.length * 260;

  if (input.number !== null && cand.number === input.number) score += 320;

  const candVariants = new Set(cand.variantTokens);
  for (const variant of input.variantTokens) {
    if (candVariants.has(variant)) score += 100;
  }

  const countryHint = input.countryHint;
  if (countryHint && candidate.countryCode) {
    if (candidate.countryCode === countryHint) score += 220;
    else score -= 120;
  }

  // Require much more than a coincidental one-word overlap.
  const accepted = score >= 720 && (sharedBrand.length >= 2 || score >= 1050 || cand.normalized === input.normalized);
  return { score, accepted, reason: accepted ? "accepted" : "confidence too low" };
}

export function scoreLogoCandidate(inputName: string, candidate: LogoCandidate): number {
  return evaluateLogoCandidate(inputName, candidate).score;
}

function bestAccepted(inputName: string, candidates: LogoCandidate[]) {
  let best: { candidate: LogoCandidate; result: CandidateScore } | null = null;
  for (const candidate of candidates) {
    const result = evaluateLogoCandidate(inputName, candidate);
    if (!result.accepted) continue;
    if (!best || result.score > best.result.score) best = { candidate, result };
  }
  return best;
}

export function rankLogoCandidates(inputName: string, candidates: LogoCandidate[], limit = 10) {
  return candidates
    .map((candidate) => ({ candidate, result: evaluateLogoCandidate(inputName, candidate) }))
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit)
    .map(({ candidate, result }) => ({
      source: candidate.source,
      path: candidate.path,
      normalized: candidate.identity.normalized,
      brandTokens: candidate.identity.brandTokens,
      number: candidate.identity.number,
      countryCode: candidate.countryCode,
      ...result,
    }));
}

export function resolveChannelLogo(inputName: string, candidates: LogoCandidate[]): ResolvedChannelLogo | null {
  const input = analyzeChannelName(inputName);
  if (!input.normalized) return null;

  // True source priority: tv-logo first. Yasser is only used if the primary catalog has no safe match.
  const primary = bestAccepted(inputName, candidates.filter((c) => c.source === "tv-logo"));
  const chosen = primary || bestAccepted(inputName, candidates.filter((c) => c.source === "yasser"));
  if (!chosen) return null;

  return {
    url: chosen.candidate.url,
    source: chosen.candidate.source,
    path: chosen.candidate.path,
    score: chosen.result.score,
    canonicalInput: input.normalized,
  };
}
