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
  home: {
    name: string;
  };
  away: {
    name: string;
  };
};

export type StreamQuality =
  | "uhd"
  | "hd"
  | "sd"
  | null;

/* =========================================================
   TEXT NORMALIZATION
   ========================================================= */

export function normalizeGuideText(
  value: string | null | undefined
) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\+/g, " plus ")
    .replace(/&/g, " and ")
    .replace(
      /\b(channel|chaine|tv|live|direct)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   STREAM QUALITY

   GTV RULE:
   2160 / 4K       = UHD
   1080 / 720      = HD
   540 / 480 / 360 = SD

   HD / FHD        = HD
   SD              = SD
   UHD / 4K        = UHD
   ========================================================= */

export function detectStreamQuality(
  name: string | null | undefined
): StreamQuality {
  if (!name) return null;

  const value = name
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    /\b2160p?\b/.test(value) ||
    /\b4k\b/.test(value) ||
    /\buhd\b/.test(value)
  ) {
    return "uhd";
  }

  if (
    /\b1080p?\b/.test(value) ||
    /\b720p?\b/.test(value) ||
    /\bfhd\b/.test(value) ||
    /\bfull\s*hd\b/.test(value) ||
    /\bhd\b/.test(value)
  ) {
    return "hd";
  }

  if (
    /\b540p?\b/.test(value) ||
    /\b480p?\b/.test(value) ||
    /\b360p?\b/.test(value) ||
    /\bsd\b/.test(value)
  ) {
    return "sd";
  }

  return null;
}

/* =========================================================
   TEAM ALIASES
   ========================================================= */

const TEAM_ALIASES: Record<string, string[]> = {
  algeria: ["algerie"],
  algerie: ["algeria"],

  morocco: ["maroc"],
  maroc: ["morocco"],

  tunisia: ["tunisie"],
  tunisie: ["tunisia"],

  egypt: ["egypte"],
  egypte: ["egypt"],

  germany: ["allemagne"],
  allemagne: ["germany"],

  spain: ["espagne"],
  espagne: ["spain"],

  england: ["angleterre"],
  angleterre: ["england"],

  italy: ["italie"],
  italie: ["italy"],

  turkey: ["turkiye", "turquie"],
  turkiye: ["turkey", "turquie"],
  turquie: ["turkey", "turkiye"],

  netherlands: ["holland", "pays bas"],
  holland: ["netherlands", "pays bas"],
  "pays bas": ["netherlands", "holland"],

  "cote d ivoire": ["ivory coast"],
  "ivory coast": ["cote d ivoire"],

  "guinea bissau": [
    "guinee bissau",
    "guinea-bissau",
    "guinee-bissau",
    "g bissau",
  ],

  "guinee bissau": [
    "guinea bissau",
    "guinea-bissau",
    "g bissau",
  ],

  "united states": ["usa", "us"],
  usa: ["united states", "us"],

  "south korea": [
    "korea republic",
    "republic of korea",
    "korea",
  ],

  "korea republic": [
    "south korea",
    "republic of korea",
  ],

  "northern ireland": ["n ireland"],

  "bosnia and herzegovina": [
    "bosnia herzegovina",
    "bosnia",
  ],

  "cape verde": ["cabo verde"],
  "cabo verde": ["cape verde"],
};

/* =========================================================
   TEAM VARIANTS
   ========================================================= */

function variants(name: string) {
  const base = normalizeGuideText(name);

  if (!base) return [];

  const generated = new Set<string>([
    base,
    ...(TEAM_ALIASES[base] ?? []),
  ]);

  const tokens = base
    .split(" ")
    .filter(Boolean);

  if (tokens.length >= 2) {
    generated.add(tokens.join(" "));

    if (
      tokens.every(
        (token) => token.length >= 4
      )
    ) {
      generated.add(
        tokens.slice(-2).join(" ")
      );
    }
  }

  return [...generated]
    .map(normalizeGuideText)
    .filter(
      (value) => value.length >= 3
    );
}

function hasAny(
  text: string,
  values: string[]
) {
  return values.some(
    (value) =>
      value.length >= 3 &&
      text.includes(value)
  );
}

function tokenOverlap(
  text: string,
  teamName: string
) {
  const textTokens = new Set(
    normalizeGuideText(text)
      .split(" ")
      .filter(
        (token) => token.length >= 3
      )
  );

  const teamTokens =
    normalizeGuideText(teamName)
      .split(" ")
      .filter(
        (token) => token.length >= 3
      );

  if (!teamTokens.length) return 0;

  const common = teamTokens.filter(
    (token) =>
      textTokens.has(token)
  ).length;

  return common / teamTokens.length;
}

/* =========================================================
   PROGRAMME ↔ FIXTURE
   ========================================================= */

export function programmeMatchScore(
  programme: BeinProgramme,
  fixture: FixtureLike
) {
  const title =
    normalizeGuideText(
      programme.title
    );

  const description =
    normalizeGuideText(
      programme.description || ""
    );

  const category =
    normalizeGuideText(
      programme.category || ""
    );

  const text =
    `${title} ${description} ${category}`.trim();

  if (!text) return 0;

  const homeVariants =
    variants(fixture.home.name);

  const awayVariants =
    variants(fixture.away.name);

  const homeInTitle =
    hasAny(
      title,
      homeVariants
    );

  const awayInTitle =
    hasAny(
      title,
      awayVariants
    );

  const homeAnywhere =
    homeInTitle ||
    hasAny(
      text,
      homeVariants
    );

  const awayAnywhere =
    awayInTitle ||
    hasAny(
      text,
      awayVariants
    );

  /*
   * Les deux équipes dans le titre.
   */
  if (
    homeInTitle &&
    awayInTitle
  ) {
    return programme.live
      ? 180
      : 165;
  }

  /*
   * Les deux équipes existent quelque
   * part dans titre/description/category.
   */
  if (
    homeAnywhere &&
    awayAnywhere
  ) {
    return programme.live
      ? 165
      : 150;
  }

  const homeOverlap =
    tokenOverlap(
      text,
      fixture.home.name
    );

  const awayOverlap =
    tokenOverlap(
      text,
      fixture.away.name
    );

  if (
    homeOverlap >= 0.99 &&
    awayOverlap >= 0.99
  ) {
    return programme.live
      ? 155
      : 140;
  }

  /*
   * Une seule équipe ne suffit PAS.
   */
  return 0;
}

/* =========================================================
   CHANNEL SIGNATURE
   ========================================================= */

type ChannelFamily =
  | "fr"
  | "en"
  | "max"
  | "xtra"
  | "main"
  | "4k"
  | "unknown";

type ChannelSignature = {
  family: ChannelFamily;
  number: string | null;

  /*
   * Nom logique nettoyé.
   */
  text: string;

  /*
   * Nom avant suppression qualité,
   * utile pour diagnostic.
   */
  rawText: string;

  isBein: boolean;

  /*
   * UHD / HD / SD
   *
   * Ne sert PAS à décider du match.
   */
  quality: StreamQuality;
};

/* =========================================================
   CHANNEL NUMBER
   ========================================================= */

function normalizeChannelNumber(
  value:
    | string
    | undefined
    | null
) {
  if (!value) return null;

  const parsed =
    Number.parseInt(
      value,
      10
    );

  if (
    !Number.isFinite(parsed)
  ) {
    return null;
  }

  return String(parsed);
}

/* =========================================================
   REMOVE HOST QUALITY TAGS
   ========================================================= */

function removeHostQualityTags(
  value: string
) {
  return value
    /*
     * IMPORTANT:
     * 1080 / 720 / 540 / 480 sont
     * des qualités, PAS des numéros
     * de chaînes.
     */
    .replace(
      /\b(?:2160|1440|1080|720|576|540|480|360)\s*p?\b/gi,
      " "
    )

    /*
     * Qualité textuelle.
     */
    .replace(
      /\b(?:uhd|fhd|full\s*hd|hd|sd)\b/gi,
      " "
    )

    /*
     * Codecs.
     */
    .replace(
      /\b(?:hevc|h\s*265|h265|x265|h\s*264|h264|x264|avc)\b/gi,
      " "
    )

    /*
     * HDR.
     */
    .replace(
      /\b(?:hdr10|hdr|dolby\s*vision|dv)\b/gi,
      " "
    )

    /*
     * Framerate.
     */
    .replace(
      /\b(?:24|25|30|50|60)\s*fps\b/gi,
      " "
    )

    /*
     * Tags fréquents des hosts.
     */
    .replace(
      /\b(?:backup|vip|premium|source|stream)\b/gi,
      " "
    )

    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   CHANNEL SIGNATURE
   ========================================================= */

function channelSignature(
  name: string
): ChannelSignature {
  const quality =
    detectStreamQuality(name);

  const rawText =
    normalizeGuideText(name);

  /*
   * On supprime UNIQUEMENT les infos
   * techniques du host.
   *
   * Ex:
   *
   * BeIN Sport 02 (1080)
   * -> bein sport 02
   *
   * BeIN Sport 02 (540)
   * -> bein sport 02
   *
   * beIN SPORTS 2 HD
   * -> bein sports 2
   */
  let text =
    removeHostQualityTags(
      rawText
    );

  text = text
    .replace(/\s+/g, " ")
    .trim();

  const isBein =
    /\bbein\b/.test(text);

  if (!isBein) {
    return {
      family: "unknown",
      number: null,
      text,
      rawText,
      isBein: false,
      quality,
    };
  }

  /*
   * =====================================================
   * 4K LOGIQUE
   * =====================================================
   *
   * ATTENTION:
   *
   * beIN SPORTS 4
   * = chaîne numéro 4
   *
   * beIN SPORTS 4K
   * = chaîne 4K
   *
   * detectStreamQuality() est exécuté AVANT
   * le nettoyage.
   */

  const originalNormalized =
    rawText;

  if (
    /\bbein\s*(?:sports?)?\s*4k\b/.test(
      originalNormalized
    )
  ) {
    return {
      family: "4k",
      number: null,
      text,
      rawText,
      isBein: true,
      quality: "uhd",
    };
  }

  /*
   * =====================================================
   * FR
   * =====================================================
   */

  let match =
    /\bbein\s+sports?\s+fr\s*0*(\d+)\b/.exec(
      text
    );

  if (!match) {
    match =
      /\bbein\s+sports?\s*0*(\d+)\s+fr\b/.exec(
        text
      );
  }

  if (match) {
    return {
      family: "fr",

      number:
        normalizeChannelNumber(
          match[1]
        ),

      text,
      rawText,
      isBein: true,
      quality,
    };
  }

  /*
   * =====================================================
   * EN
   * =====================================================
   */

  match =
    /\bbein\s+sports?\s+en\s*0*(\d+)\b/.exec(
      text
    );

  if (!match) {
    match =
      /\bbein\s+sports?\s*0*(\d+)\s+en\b/.exec(
        text
      );
  }

  if (match) {
    return {
      family: "en",

      number:
        normalizeChannelNumber(
          match[1]
        ),

      text,
      rawText,
      isBein: true,
      quality,
    };
  }

  /*
   * =====================================================
   * MAX
   * =====================================================
   */

  match =
    /\bbein\s+sports?\s+max\s*0*(\d+)\b/.exec(
      text
    );

  if (!match) {
    match =
      /\bbein\s+max\s*0*(\d+)\b/.exec(
        text
      );
  }

  if (match) {
    return {
      family: "max",

      number:
        normalizeChannelNumber(
          match[1]
        ),

      text,
      rawText,
      isBein: true,
      quality,
    };
  }

  /*
   * =====================================================
   * XTRA
   * =====================================================
   */

  match =
    /\bbein\s+sports?\s+xtra\s*0*(\d+)\b/.exec(
      text
    );

  if (!match) {
    match =
      /\bbein\s+xtra\s*0*(\d+)\b/.exec(
        text
      );
  }

  if (match) {
    return {
      family: "xtra",

      number:
        normalizeChannelNumber(
          match[1]
        ),

      text,
      rawText,
      isBein: true,
      quality,
    };
  }

  /*
   * =====================================================
   * MAIN
   * =====================================================
   *
   * Tous deviennent channel number = 2 :
   *
   * BeIN Sport 02 (1080)
   * BeIN Sport 02 (720)
   * BeIN Sport 02 (540)
   * BeIN Sport 02 (480)
   * BeIN Sports 2 HD
   * BeIN Sports 02 SD
   * BeIN 02
   */

  match =
    /\bbein\s+(?:sports?\s+)?0*(\d+)\b/.exec(
      text
    );

  if (match) {
    return {
      family: "main",

      number:
        normalizeChannelNumber(
          match[1]
        ),

      text,
      rawText,
      isBein: true,
      quality,
    };
  }

  return {
    family: "unknown",
    number: null,
    text,
    rawText,
    isBein: true,
    quality,
  };
}

/* =========================================================
   LANGUAGE HELPERS
   ========================================================= */

function looksFrench(
  text: string
) {
  return (
    /\bfr\b/.test(text) ||
    /\bfrench\b/.test(text) ||
    /\bfrance\b/.test(text)
  );
}

function looksEnglish(
  text: string
) {
  return (
    /\ben\b/.test(text) ||
    /\benglish\b/.test(text)
  );
}

function looksArabic(
  text: string
) {
  return (
    /\bar\b/.test(text) ||
    /\barab\b/.test(text) ||
    /\barabic\b/.test(text) ||
    /\bmena\b/.test(text)
  );
}

/* =========================================================
   GUIDE CHANNEL ↔ XTREAM CHANNEL
   ========================================================= */

export function channelMatchScore(
  guideChannel: string,
  xtreamChannel: LiveChannel,
  region: BeinRegion,
  categoryName = ""
) {
  const guide =
    channelSignature(
      guideChannel
    );

  const xtream =
    channelSignature(
      xtreamChannel.name
    );

  if (
    !guide.isBein ||
    !xtream.isBein
  ) {
    return 0;
  }

  let score = 0;

  /*
   * =====================================================
   * RÈGLE LA PLUS IMPORTANTE
   * =====================================================
   *
   * Si les deux ont un numéro :
   *
   * guide 2 ↔ host 2 = OUI
   * guide 2 ↔ host 4 = NON
   *
   * La qualité n'intervient JAMAIS ici.
   */

  if (
    guide.number &&
    xtream.number
  ) {
    if (
      guide.number !==
      xtream.number
    ) {
      return 0;
    }

    score += 150;
  }

  /*
   * Même famille.
   */
  if (
    guide.family ===
    xtream.family
  ) {
    score += 90;
  }

  /*
   * FR/EN ↔ MAIN.
   *
   * Ex:
   *
   * EPG: beIN SPORTS FR 2
   * HOST: BeIN Sport 02 (1080)
   *
   * C'est accepté car le numéro = 2.
   */

  if (
    guide.number &&
    xtream.number &&
    guide.number ===
      xtream.number
  ) {
    const compatible =
      (
        guide.family === "fr" &&
        xtream.family === "main"
      ) ||
      (
        guide.family === "main" &&
        xtream.family === "fr"
      ) ||
      (
        guide.family === "en" &&
        xtream.family === "main"
      ) ||
      (
        guide.family === "main" &&
        xtream.family === "en"
      );

    if (compatible) {
      score += 60;
    }
  }

  /*
   * MAX/XTRA restent stricts.
   */

  if (
    (
      guide.family === "max" ||
      guide.family === "xtra"
    ) &&
    guide.family !==
      xtream.family
  ) {
    return 0;
  }

  if (
    (
      xtream.family === "max" ||
      xtream.family === "xtra"
    ) &&
    guide.family !==
      xtream.family
  ) {
    return 0;
  }

  /*
   * 4K reste strict.
   */

  if (
    guide.family === "4k" ||
    xtream.family === "4k"
  ) {
    if (
      guide.family !==
      xtream.family
    ) {
      return 0;
    }

    score += 150;
  }

  /*
   * Nom logique identique.
   */

  if (
    guide.text ===
    xtream.text
  ) {
    score += 100;
  }

  /*
   * Nom proche.
   */

  if (
    guide.text &&
    xtream.text &&
    (
      xtream.text.includes(
        guide.text
      ) ||
      guide.text.includes(
        xtream.text
      )
    )
  ) {
    score += 35;
  }

  /*
   * Région/langue = bonus seulement.
   */

  const xtreamText =
    normalizeGuideText(
      xtreamChannel.name
    );

  const category =
    normalizeGuideText(
      categoryName
    );

  const combined =
    `${xtreamText} ${category}`;

  if (
    guide.family === "fr"
  ) {
    if (
      looksFrench(combined)
    ) {
      score += 35;
    }

    if (
      looksEnglish(combined)
    ) {
      score -= 20;
    }
  }

  if (
    guide.family === "en"
  ) {
    if (
      looksEnglish(combined)
    ) {
      score += 35;
    }

    if (
      looksFrench(combined)
    ) {
      score -= 20;
    }
  }

  if (
    region === "mena" &&
    looksArabic(combined)
  ) {
    score += 20;
  }

  /*
   * IMPORTANT :
   *
   * HD/SD/UHD n'ajoute et ne retire
   * AUCUN point.
   *
   * BeIN 2 HD et BeIN 2 SD diffusent
   * logiquement la même chaîne.
   */

  return Math.max(
    0,
    score
  );
}

/* =========================================================
   PROGRAMME → XTREAM CHANNELS
   ========================================================= */

export function findXtreamChannelsForProgramme(
  programme: BeinProgramme,
  channels: LiveChannel[],
  categoryName = ""
) {
  const matches =
    channels
      .map(
        (channel) => ({
          channel,

          score:
            channelMatchScore(
              programme.channel,
              channel,
              programme.region,
              categoryName
            ),

          quality:
            detectStreamQuality(
              channel.name
            ),
        })
      )

      .filter(
        (item) =>
          item.score >= 120
      )

      .sort(
        (a, b) => {
          /*
           * D'abord qualité du matching.
           */
          if (
            b.score !==
            a.score
          ) {
            return (
              b.score -
              a.score
            );
          }

          /*
           * À score identique seulement :
           *
           * UHD > HD > SD > inconnu
           *
           * Cela ne change PAS le match.
           * Cela ordonne simplement les
           * variantes d'une même chaîne.
           */

          const qualityRank:
            Record<
              Exclude<
                StreamQuality,
                null
              >,
              number
            > = {
            uhd: 3,
            hd: 2,
            sd: 1,
          };

          const aQuality =
            a.quality
              ? qualityRank[
                  a.quality
                ]
              : 0;

          const bQuality =
            b.quality
              ? qualityRank[
                  b.quality
                ]
              : 0;

          return (
            bQuality -
            aQuality
          );
        }
      );

  if (!matches.length) {
    return [];
  }

  const bestScore =
    matches[0].score;

  return matches
    .filter(
      (item) =>
        item.score >=
        bestScore - 45
    )

    /*
     * On garde plusieurs variantes :
     * HD + SD peuvent exister.
     */
    .slice(0, 12)

    .map(
      (item) =>
        item.channel
    );
}
