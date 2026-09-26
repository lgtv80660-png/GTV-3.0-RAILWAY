import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Region = "france" | "mena";

type Programme = {
  region: Region;
  channel: string;
  title: string;
  description: string | null;
  category: string | null;
  start: string | null;
  end: string | null;
  live: boolean;
};

type SourceResult = {
  region: Region;
  url: string;
  ok: boolean;
  count: number;
  error?: string;
};

type CacheValue = {
  programmes: Programme[];
  sources: SourceResult[];
};

type CacheEntry = {
  expiresAt: number;
  value: CacheValue;
};

const globalStore = globalThis as typeof globalThis & {
  __gtvBeinGuideCacheV7?: Map<string, CacheEntry>;
};

if (!globalStore.__gtvBeinGuideCacheV7) {
  globalStore.__gtvBeinGuideCacheV7 = new Map();
}

const CACHE = globalStore.__gtvBeinGuideCacheV7;

/*
 * v7 IMPORTANT
 * ------------
 * On NE s'arrête plus au premier flux MENA qui contient des programmes.
 * Le premier miroir peut contenir surtout des titres arabes. On fusionne
 * désormais MENA dédié + beIN EN + beIN AR afin d'avoir les variantes de
 * langues nécessaires au matching des noms ESPN/SportSRC.
 */
const SOURCES = {
  mena: [
    "https://al7omed.github.io/bein-epg/guide.xml",
    "https://iptv-org.github.io/epg/guides/en/beinsports.com.xml",
    "https://iptv-org.github.io/epg/guides/ar/beinsports.com.xml",
  ],
  france: [
    "https://iptv-org.github.io/epg/guides/fr/beinsports.com.xml",
  ],
} as const;

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cleanText(value: string) {
  return decodeXml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return match?.[1] ?? "";
}

function firstTagText(block: string, tagName: string) {
  const match = block.match(
    new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i")
  );
  return match ? cleanText(match[1]) : "";
}

function compactDate(date: string) {
  return date.replace(/-/g, "");
}

function rawXmltvTimeToHHMM(value: string) {
  const digits = value.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!digits) return null;
  return `${digits[4]}:${digits[5]}`;
}

function channelLooksUseful(name: string) {
  const value = name.toLowerCase();
  return value.includes("bein") && (value.includes("sport") || value.includes("4k"));
}

function parseXmlTv(region: Region, xml: string, date: string): Programme[] {
  const channelNames = new Map<string, string>();
  const channelRegex = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi;
  let channelMatch: RegExpExecArray | null;

  while ((channelMatch = channelRegex.exec(xml))) {
    const openTag = `<channel ${channelMatch[1]}>`;
    const id = getAttribute(openTag, "id");
    const body = channelMatch[2];
    const displayNames = [...body.matchAll(/<display-name(?:\s[^>]*)?>([\s\S]*?)<\/display-name>/gi)]
      .map((item) => cleanText(item[1]))
      .filter(Boolean);

    const name = displayNames.find(channelLooksUseful) || displayNames[0] || id;
    if (id && name) channelNames.set(id, name);
  }

  const requested = compactDate(date);
  const programmes: Programme[] = [];
  const programmeRegex = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let programmeMatch: RegExpExecArray | null;

  while ((programmeMatch = programmeRegex.exec(xml))) {
    const openTag = `<programme ${programmeMatch[1]}>`;
    const body = programmeMatch[2];
    const startRaw = getAttribute(openTag, "start");
    const stopRaw = getAttribute(openTag, "stop");
    const channelId = getAttribute(openTag, "channel");

    if (!startRaw || startRaw.slice(0, 8) !== requested) continue;

    const channel = channelNames.get(channelId) || channelId;
    if (!channelLooksUseful(channel)) continue;

    const title = firstTagText(body, "title");
    if (!title) continue;

    const category = firstTagText(body, "category") || null;
    const description = firstTagText(body, "desc") || null;
    const combined = `${title} ${category || ""} ${description || ""}`.toLowerCase();

    programmes.push({
      region,
      channel,
      title,
      description,
      category,
      start: rawXmltvTimeToHHMM(startRaw),
      end: rawXmltvTimeToHHMM(stopRaw),
      live: /\blive\b|\bdirect\b|en direct|مباشر/i.test(combined),
    });
  }

  return programmes;
}

function dedupe(programmes: Programme[]) {
  const map = new Map<string, Programme>();

  for (const programme of programmes) {
    const key = [
      programme.region,
      programme.channel,
      programme.title,
      programme.start,
      programme.end,
    ]
      .join("|")
      .toLowerCase();

    const existing = map.get(key);
    if (!existing || (!existing.live && programme.live)) {
      map.set(key, programme);
    }
  }

  return [...map.values()];
}

async function fetchXml(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/xml,text/xml,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 GTV/3.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const xml = await response.text();
  if (!xml.includes("<tv") || !xml.includes("<programme")) {
    throw new Error("Flux XMLTV invalide ou vide");
  }

  return xml;
}

async function loadRegion(region: Region, date: string) {
  const urls = SOURCES[region];
  const allProgrammes: Programme[] = [];
  const errors: string[] = [];
  const successfulUrls: string[] = [];

  // v7 : fusion de TOUS les flux accessibles, pas seulement le premier non vide.
  const settled = await Promise.allSettled(
    urls.map(async (url) => {
      const xml = await fetchXml(url);
      const programmes = parseXmlTv(region, xml, date);
      return { url, programmes };
    })
  );

  settled.forEach((result, index) => {
    const url = urls[index];

    if (result.status === "fulfilled") {
      if (result.value.programmes.length > 0) {
        successfulUrls.push(url);
        allProgrammes.push(...result.value.programmes);
      } else {
        errors.push(`${url}: 0 programme pour ${date}`);
      }
    } else {
      errors.push(`${url}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  });

  const programmes = dedupe(allProgrammes);

  return {
    programmes,
    source: {
      region,
      url: successfulUrls.join(" | ") || urls[0],
      ok: programmes.length > 0,
      count: programmes.length,
      ...(errors.length > 0 ? { error: errors.join(" | ").slice(0, 900) } : {}),
    } satisfies SourceResult,
  };
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const dateParam = url.searchParams.get("date");
    const date =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
        ? dateParam
        : new Date().toISOString().slice(0, 10);

    const cacheKey = `bein-guide:v7:${date}`;
    const cached = CACHE.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({
        success: true,
        cached: true,
        date,
        total: cached.value.programmes.length,
        ...cached.value,
      });
    }

    const [mena, france] = await Promise.all([
      loadRegion("mena", date),
      loadRegion("france", date),
    ]);

    const value: CacheValue = {
      programmes: dedupe([...mena.programmes, ...france.programmes]),
      sources: [mena.source, france.source],
    };

    CACHE.set(cacheKey, {
      expiresAt: Date.now() + 5 * 60 * 1000,
      value,
    });

    return NextResponse.json({
      success: true,
      cached: false,
      date,
      total: value.programmes.length,
      sources: value.sources,
      programmes: value.programmes,
    });
  } catch (error) {
    console.error("[beIN guide]", error);

    return NextResponse.json(
      {
        success: false,
        cached: false,
        programmes: [],
        sources: [],
        error: error instanceof Error ? error.message : "Guide beIN indisponible",
      },
      { status: 500 }
    );
  }
}
