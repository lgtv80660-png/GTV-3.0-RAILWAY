import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TMDB_BASE = "https://api.themoviedb.org/3";

function imageUrl(path?: string | null) {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/w500${path}`;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    let tmdbId: string | null = searchParams.get("tmdbId");

    // 🛡️ BOURCLIER ANTI-FLASH : Si l'IPTV envoie un faux ID (0, null, etc), on l'ignore.
    if (!tmdbId || tmdbId === "undefined" || tmdbId === "null" || tmdbId === "0" || tmdbId.trim() === "" || !/^\d+$/.test(tmdbId)) {
      tmdbId = null;
    }

    const title = searchParams.get("title")?.trim() || "";
    const year = searchParams.get("year")?.trim() || "";
    const type = searchParams.get("type") === "movie" ? "movie" : "tv"; 

    const apiKey = process.env.TMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "TMDB_API_KEY manquante" }, { status: 500 });
    }

    let data = null;

    // Fonction de récupération complète avec credits & aggregate_credits
    async function fetchDetails(id: string) {
      const url = new URL(`${TMDB_BASE}/${type}/${id}`);
      url.searchParams.set("api_key", apiKey!);
      url.searchParams.set("language", "fr-FR");
      url.searchParams.set("append_to_response", "credits,aggregate_credits");
      const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (res.ok) return await res.json();
      return null;
    }

    // 1. Essai avec l'ID (s'il est valide)
    if (tmdbId) {
      data = await fetchDetails(tmdbId);
    }

    // 2. Roue de secours : Recherche par titre si l'ID a échoué ou n'existe pas
    if (!data && title) {
      const searchUrl = new URL(`${TMDB_BASE}/search/${type}`);
      searchUrl.searchParams.set("api_key", apiKey);
      searchUrl.searchParams.set("query", title);
      searchUrl.searchParams.set("language", "fr-FR");
      searchUrl.searchParams.set("include_adult", "false");

      if (year) {
        if (type === "movie") searchUrl.searchParams.set("primary_release_year", year);
        else searchUrl.searchParams.set("first_air_date_year", year);
      }

      const searchRes = await fetch(searchUrl, { cache: "no-store" });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const results = Array.isArray(searchData?.results) ? searchData.results : [];
        let bestMatch = year ? results.find((item: any) => String(item?.release_date || item?.first_air_date || "").startsWith(year)) : null;
        if (!bestMatch) bestMatch = results[0] || null;
        if (bestMatch?.id) data = await fetchDetails(String(bestMatch.id));
      }
    }

    if (!data) {
      return NextResponse.json({ error: "Introuvable", studio: null, companies: [], producers: [], overview: null }, { status: 404 });
    }

    /* =====================================================
       3. EXTRACTION DU STUDIO
    ===================================================== */
    const combinedStudios = [...(Array.isArray(data?.networks) ? data.networks : []), ...(Array.isArray(data?.production_companies) ? data.production_companies : [])];
    const companiesMap = new Map();
    combinedStudios.forEach((company: any) => {
      if (company?.name && !companiesMap.has(company.id)) {
        companiesMap.set(company.id, { id: company.id, name: company.name, logo: imageUrl(company.logo_path) });
      }
    });
    const companies = Array.from(companiesMap.values());
    const primaryCompany = companies.find((c: any) => !!c.logo) || companies[0] || null;

    /* =====================================================
       4. L'ANCIENNE MÉTHODE QUI MARCHAIT POUR LE CREW !
    ===================================================== */
    let rawCrew: any[] = [];
    const validJobs = ["Producer", "Executive Producer", "Director", "Writer", "Screenplay", "Creator", "Series Director", "Series Writer", "Showrunner"];

    // A. Pour les séries (aggregate_credits)
    if (type === "tv" && Array.isArray(data?.aggregate_credits?.crew)) {
      data.aggregate_credits.crew.forEach((person: any) => {
        if (Array.isArray(person.jobs)) {
          const relevantJobs = person.jobs.filter((j: any) => validJobs.includes(j.job));
          if (relevantJobs.length > 0) {
            relevantJobs.sort((a: any, b: any) => (b.episode_count || 0) - (a.episode_count || 0));
            rawCrew.push({
              id: person.id,
              name: person.name,
              job: relevantJobs[0].job,
              episodeCount: relevantJobs[0].episode_count || 0
            });
          }
        }
      });
      rawCrew.sort((a: any, b: any) => (b.episodeCount || 0) - (a.episodeCount || 0));
    } 
    // B. Pour les films (ou séries sans historique)
    else if (Array.isArray(data?.credits?.crew)) {
      rawCrew = data.credits.crew.filter((person: any) => validJobs.includes(person?.job)).map((person: any) => ({
        id: person.id,
        name: person.name,
        job: person.job,
        episodeCount: 1
      }));
    }

    let producers = [...rawCrew];

    // C. Ajout des Créateurs officiels
    if (Array.isArray(data?.created_by)) {
      data.created_by.forEach((creator: any) => {
        if (!producers.find((p: any) => p.id === creator.id)) {
          producers.unshift({ id: creator.id, name: creator.name, job: "Creator" });
        }
      });
    }

    // Suppression des doublons
    producers = producers.filter((v: any, i: number, a: any) => a.findIndex((t: any) => (t.id === v.id || t.name === v.name)) === i);

    return NextResponse.json({
      tmdbId: data?.id,
      title: data?.title || data?.name || title || null,
      year: data?.release_date || data?.first_air_date ? String(data.release_date || data.first_air_date).slice(0, 4) : null,
      studio: primaryCompany?.name || null,
      studioLogo: primaryCompany?.logo || null,
      companies,
      producers,
      overview: data?.overview || null,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message, studio: null, companies: [], producers: [], overview: null }, { status: 500 });
  }
}