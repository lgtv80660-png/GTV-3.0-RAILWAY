import { NextRequest, NextResponse } from "next/server";
import {
  analyzeChannelName,
  makeCandidate,
  rankLogoCandidates,
  resolveChannelLogo,
  type LogoCandidate,
} from "@/lib/channel-logo-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATALOG_TTL = 7 * 24 * 60 * 60 * 1000;
const IMAGE_TTL_SECONDS = 7 * 24 * 60 * 60;
const TV_LOGO_TREE = "https://api.github.com/repos/tv-logo/tv-logos/git/trees/main?recursive=1";
const TV_LOGO_RAW = "https://raw.githubusercontent.com/tv-logo/tv-logos/main/";
const YASSER_BRANCH = "claude/create-tv-logos-repo-011CUbxoDTs3vE8NbwCs4vBA";
const YASSER_INDEX = `https://raw.githubusercontent.com/yasserstudio/tv-logos/${YASSER_BRANCH}/index.json`;
const YASSER_RAW = `https://raw.githubusercontent.com/yasserstudio/tv-logos/${YASSER_BRANCH}/`;

type CatalogCache = { expiresAt: number; candidates: LogoCandidate[] };
const globalStore = globalThis as typeof globalThis & { __gtvChannelLogoCatalogV10?: CatalogCache };

function isImagePath(path: string) {
  return /\.(png|webp|jpg|jpeg)$/i.test(path);
}

async function fetchTvLogoCandidates(): Promise<LogoCandidate[]> {
  try {
    const response = await fetch(TV_LOGO_TREE, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "GTV-Channel-Logo-Resolver-v10" },
      next: { revalidate: IMAGE_TTL_SECONDS },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const tree = Array.isArray(data?.tree) ? data.tree : [];
    return tree
      .filter((item: any) => item?.type === "blob" && typeof item?.path === "string" && isImagePath(item.path))
      .map((item: any) => {
        const path = String(item.path);
        return makeCandidate("tv-logo", path, `${TV_LOGO_RAW}${encodeURI(path)}`);
      });
  } catch {
    return [];
  }
}

async function fetchYasserCandidates(): Promise<LogoCandidate[]> {
  try {
    const response = await fetch(YASSER_INDEX, {
      headers: { Accept: "application/json", "User-Agent": "GTV-Channel-Logo-Resolver-v10" },
      next: { revalidate: IMAGE_TTL_SECONDS },
    });
    if (!response.ok) return [];
    const data = await response.json();
    const channels = Array.isArray(data?.channels) ? data.channels : [];
    return channels
      .filter((item: any) => typeof item?.path === "string" && isImagePath(item.path))
      .map((item: any) => {
        const path = String(item.path);
        return makeCandidate("yasser", path, `${YASSER_RAW}${encodeURI(path)}`);
      });
  } catch {
    return [];
  }
}

async function getCatalog() {
  const cached = globalStore.__gtvChannelLogoCatalogV10;
  if (cached && cached.expiresAt > Date.now() && cached.candidates.length > 0) return cached.candidates;

  const [primary, fallback] = await Promise.all([fetchTvLogoCandidates(), fetchYasserCandidates()]);
  const candidates = [...primary, ...fallback];
  if (candidates.length > 0) {
    globalStore.__gtvChannelLogoCatalogV10 = { candidates, expiresAt: Date.now() + CATALOG_TTL };
  }
  return candidates;
}

function safeFallback(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function placeholder(name: string) {
  const label = (name || "TV").replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase() || "TV";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="288" viewBox="0 0 512 288">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171527"/><stop offset="1" stop-color="#090b12"/></linearGradient></defs>
    <rect width="512" height="288" rx="48" fill="url(#g)"/><rect x="1" y="1" width="510" height="286" rx="47" fill="none" stroke="rgba(255,255,255,.10)"/>
    <text x="256" y="165" text-anchor="middle" font-family="Arial,sans-serif" font-size="72" font-weight="700" fill="#d8ccff">${label}</text>
  </svg>`;
}

function svgResponse(name: string) {
  return new NextResponse(placeholder(name), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${IMAGE_TTL_SECONDS}, stale-while-revalidate=86400`,
    },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const name = (url.searchParams.get("name") || "").trim();
  const fallback = safeFallback(url.searchParams.get("fallback"));
  const debug = url.searchParams.get("debug") === "1";

  if (!name) return NextResponse.json({ success: false, error: "Missing channel name" }, { status: 400 });

  const catalog = await getCatalog();
  const resolved = resolveChannelLogo(name, catalog);

  if (debug) {
    return NextResponse.json({
      success: true,
      name,
      identity: analyzeChannelName(name),
      catalogSize: catalog.length,
      resolved,
      fallback,
      topCandidates: rankLogoCandidates(name, catalog, 12),
    });
  }

  // IMPORTANT: a doubtful catalog match never beats the provider logo.
  if (!resolved) {
    if (fallback) return NextResponse.redirect(fallback, 307);
    return svgResponse(name);
  }

  try {
    const logo = await fetch(resolved.url, {
      headers: { "User-Agent": "GTV-Channel-Logo-Resolver-v10" },
      next: { revalidate: IMAGE_TTL_SECONDS },
    });

    if (!logo.ok) {
      if (fallback) return NextResponse.redirect(fallback, 307);
      return svgResponse(name);
    }

    const bytes = await logo.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": logo.headers.get("content-type") || "image/png",
        "Cache-Control": `public, max-age=${IMAGE_TTL_SECONDS}, stale-while-revalidate=86400`,
        "X-GTV-Logo-Source": resolved.source,
        "X-GTV-Logo-Score": String(resolved.score),
        "X-GTV-Logo-Path": resolved.path,
      },
    });
  } catch {
    if (fallback) return NextResponse.redirect(fallback, 307);
    return svgResponse(name);
  }
}
