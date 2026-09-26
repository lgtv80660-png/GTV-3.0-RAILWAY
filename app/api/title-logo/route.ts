import { NextResponse } from "next/server";

// Indique à Next.js de ne jamais mettre cette route en cache statique
export const dynamic = "force-dynamic";

type LogoCacheEntry = { expiresAt: number; logoUrl: string | null };
const logoCache = new Map<string, LogoCacheEntry>();
const LOGO_TTL = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    let tmdbId = searchParams.get("tmdbId");
    let title = searchParams.get("title") || "";
    const type = searchParams.get("type") || "tv"; 

    const TMDB_KEY = process.env.TMDB_API_KEY;
    const FANART_KEY = process.env.FANART_API_KEY;

    if (!TMDB_KEY) return NextResponse.json({ logoUrl: null });

    const cacheKey = `${type}|${tmdbId || ""}|${title}`.toLowerCase();
    const cached = logoCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ logoUrl: cached.logoUrl }, {
        headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
      });
    }

    // NETTOYAGE EXTRÊME : Enlève les S01, S1, VF, VOSTFR, 1080p, Multi, 4K, et les points/tirets
    const cleanTitle = title
      .replace(/\|.*?\|/g, "")
      .replace(/\[.*?\]/g, "")
      .replace(/\(.*?\)/g, "")
      .replace(/\s*[-|]\s*\b(19|20)\d{2}\b/g, "")
      .replace(/\b(Saison|Season|S)\s*\d+\b/gi, "")
      .replace(/\b(1080p|720p|4k|fhd|hd|vostfr|vf|multi)\b/gi, "")
      .replace(/[-_.]/g, " ") // Remplace les points et tirets par des espaces (ex: Ma.Serie.VF -> Ma Serie)
      .replace(/\s+/g, " ")
      .trim();

    let finalTmdbId = tmdbId;
    let tmdbLogoUrl = null;
    let fanartLogoUrl = null;

    // ÉTAPE 1 : ON TESTE L'ID FOURNI PAR L'IPTV
    if (finalTmdbId && finalTmdbId !== "0" && finalTmdbId !== "null" && finalTmdbId !== "") {
      const tmdbImagesUrl = `https://api.themoviedb.org/3/${type}/${finalTmdbId}/images?api_key=${TMDB_KEY}&include_image_language=fr,en,null`;
      const tmdbRes = await fetch(tmdbImagesUrl, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
      
      if (tmdbRes.ok) {
        const data = await tmdbRes.json();
        if (data.logos && data.logos.length > 0) {
          const best = data.logos.find((l: any) => l.iso_639_1 === 'fr') || data.logos.find((l: any) => l.iso_639_1 === 'en') || data.logos[0];
          tmdbLogoUrl = `https://image.tmdb.org/t/p/w500${best.file_path}`;
        } else {
          // L'ID est valide MAIS n'a pas de logo ! (Sûrement un faux ID de l'IPTV).
          // On le jette pour forcer la recherche par le titre purifié.
          finalTmdbId = null;
        }
      } else {
        finalTmdbId = null;
      }
    }

    // ÉTAPE 2 : RECHERCHE PAR LE TITRE PURIFIÉ (Si l'ID était mauvais ou vide de logos)
    if (!finalTmdbId && cleanTitle) {
      const searchUrl = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(cleanTitle)}`;
      const searchRes = await fetch(searchUrl, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
      
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.results && searchData.results.length > 0) {
          finalTmdbId = searchData.results[0].id.toString();
          
          // On a trouvé le vrai ID ! On récupère son logo.
          const tmdbImagesUrl = `https://api.themoviedb.org/3/${type}/${finalTmdbId}/images?api_key=${TMDB_KEY}&include_image_language=fr,en,null`;
          const tmdbRes2 = await fetch(tmdbImagesUrl, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
          if (tmdbRes2.ok) {
            const data2 = await tmdbRes2.json();
            if (data2.logos && data2.logos.length > 0) {
              const best = data2.logos.find((l: any) => l.iso_639_1 === 'fr') || data2.logos.find((l: any) => l.iso_639_1 === 'en') || data2.logos[0];
              tmdbLogoUrl = `https://image.tmdb.org/t/p/w500${best.file_path}`;
            }
          }
        }
      }
    }

    // ÉTAPE 3 : ON ESSAIE D'AVOIR LA VERSION HAUTE DÉFINITION SUR FANART
    if (finalTmdbId && FANART_KEY) {
      let fanartQueryId = finalTmdbId;
      
      if (type === "tv") {
        const extRes = await fetch(`https://api.themoviedb.org/3/tv/${finalTmdbId}/external_ids?api_key=${TMDB_KEY}`, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
        if (extRes.ok) {
          const extData = await extRes.json();
          if (extData.tvdb_id) fanartQueryId = extData.tvdb_id.toString();
        }
      }
      
      try {
        const fanartUrl = type === "movie" 
            ? `https://webservice.fanart.tv/v3/movies/${fanartQueryId}?api_key=${FANART_KEY}` 
            : `https://webservice.fanart.tv/v3/tv/${fanartQueryId}?api_key=${FANART_KEY}`;
        
        const fanartRes = await fetch(fanartUrl, { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) });
        if (fanartRes.ok) {
          const fData = await fanartRes.json();
          const logos = type === "movie" 
              ? (fData.hdmovielogo || fData.movielogo || []) 
              : (fData.hdtvlogo || fData.clearlogo || []);
              
          if (logos.length > 0) {
            const best = logos.find((l: any) => l.lang === 'fr') || logos.find((l: any) => l.lang === 'en') || logos[0];
            if (best?.url) fanartLogoUrl = best.url;
          }
        }
      } catch (e) {
        // Erreur silencieuse pour Fanart, on se rabattra sur TMDB
      }
    }

    // RÉSULTAT : On donne Fanart (1er choix), TMDB (2ème choix), ou null (Texte par défaut)
    const logoUrl = fanartLogoUrl || tmdbLogoUrl || null;
    logoCache.set(cacheKey, { expiresAt: Date.now() + LOGO_TTL, logoUrl });
    return NextResponse.json({ logoUrl }, {
      headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
    });
    
  } catch (error) {
    return NextResponse.json({ logoUrl: null });
  }
}