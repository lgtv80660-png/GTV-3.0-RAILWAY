"use client";



import React, { useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { useQuery } from "@tanstack/react-query";

import { AnimatePresence, motion, type Variants } from "framer-motion";

import {

  ChevronRight,

  Clock3,

  Info,

  Loader2,

  Play,

  Plus,

  Star,

} from "lucide-react";



import { cleanName, cn, ratingNum, yearFrom } from "@/lib/utils";

import { useLibrary } from "@/store/library";



/* =========================================================

   TYPES

\========================================================= */



type XtreamMovie = {

  stream_id: number | string;

  name: string;

  stream_icon?: string;
  backdrop_path?: string[] | string;
  backdrop?: string;

  rating?: string | number;

  rating_5based?: string | number;

  added?: string | number;

  category_id?: string | number;

  container_extension?: string;

  tmdb?: string | number;

  tmdb_id?: string | number;

  releaseDate?: string;

  releasedate?: string;

  genre?: string;

  plot?: string;

  description?: string;

};



type XtreamSeries = {

  series_id: number | string;

  name: string;

  cover?: string;

  backdrop_path?: string[];

  rating?: string | number;

  last_modified?: string | number;

  category_id?: string | number;

  tmdb?: string | number;

  tmdb_id?: string | number;

  releaseDate?: string;

  releasedate?: string;

  genre?: string;

  plot?: string;

  description?: string;

};



type HeroSlide = {

  rawTitle?: string;

  id: string | number;

  type: "movie" | "series";

  title: string;

  image: string;

  backdrop?: string | null;

  logo?: string | null;

  year?: string | number | null;

  rating?: number;

  genre?: string;

  synopsis?: string;

  link: string;

};



type ContinueItem = {

  type: "movie" | "series";

  id: string | number;

  title: string;

  image?: string | null;

  seriesId?: string | number | null;

  season?: number | string | null;

  episode?: number | string | null;

  ext?: string | null;

  position?: number;

  duration?: number;

  updatedAt?: number;


  tmdbId?: string | number | null;
  year?: string | number | null;
};



/* =========================================================

   ANIMATIONS

\========================================================= */



const heroImageVariants: Variants = {

  enter: {

    opacity: 0,

    scale: 1.035,

  },

  center: {

    opacity: 1,

    scale: 1,

    transition: {

      duration: 0.95,

      ease: [0.16, 1, 0.3, 1],

    },

  },

  exit: {

    opacity: 0,

    scale: 1.01,

    transition: {

      duration: 0.55,

      ease: [0.16, 1, 0.3, 1],

    },

  },

};



const heroContentVariants: Variants = {

  hidden: {

    opacity: 0,

    y: 16,

    filter: "blur(5px)",

  },

  show: {

    opacity: 1,

    y: 0,

    filter: "blur(0px)",

    transition: {

      duration: 0.6,

      ease: [0.16, 1, 0.3, 1],

    },

  },

};



/* =========================================================

   HELPERS

\========================================================= */



function cleanMediaTitle(rawTitle: string) {
  if (!rawTitle) return "";

  return rawTitle
    .replace(/\[.*?\]/g, "")
    .replace(/\|.*?\|/g, "")
    .replace(/[ⓋⒹ║]/g, "")
    .replace(/\b(VOD[\s_-]*FR|4K|2160P|1080P|720P|FHD|UHD|HDR|HDR10|DV|DOLBY[\s_-]*VISION|HEVC|H265|H\.265|MULTI|TRUEFRENCH|FRENCH|VOSTFR|VOST|VF|VFF|VFI|FR)\b/gi, "")
    .replace(/\(\s*(19|20)\d{2}\s*\)/g, "")
    .replace(/\[\s*(19|20)\d{2}\s*\]/g, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/^[\s._\-:|]+|[\s._\-:|]+$/g, "")
    .replace(/[\/\\|_]+/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleYear(rawTitle?: string | null) {
  if (!rawTitle) return null;
  const match = rawTitle.match(/\b((?:19|20)\d{2})\b/);
  return match?.[1] || null;
}

function safeImage(value: unknown) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim())
    ? value.trim()
    : null;
}

function getContinuePercent(item: ContinueItem) {

  if (

    !item?.duration ||

    !item?.position ||

    item.duration <= 0 ||

    item.position <= 0

  ) {

    return 0;

  }



  return Math.min(

    100,

    Math.max(0, (Number(item.position) / Number(item.duration)) * 100)

  );

}



function buildResumeHref(item: ContinueItem) {
  const resume = Math.max(0, Math.floor(item.position || 0));

  if (item.type === "series") {
    const seriesId = item.seriesId || item.id;
    const params = new URLSearchParams();

    if (String(item.id) !== String(seriesId)) params.set("play", String(item.id));
    if (item.season != null) params.set("season", String(item.season));
    if (item.episode != null) params.set("episode", String(item.episode));
    if (resume > 15) params.set("resume", String(resume));

    const query = params.toString();
    return `/series/${seriesId}${query ? `?${query}` : ""}`;
  }

  const params = new URLSearchParams();
  if (resume > 15) params.set("resume", String(resume));

  const query = params.toString();
  return `/movies/${item.id}${query ? `?${query}` : ""}`;
}



function secondsRemaining(item: ContinueItem) {

  const duration = Number(item.duration || 0);

  const position = Number(item.position || 0);



  if (duration <= 0) return "";



  const remaining = Math.max(0, duration - position);

  const minutes = Math.ceil(remaining / 60);



  if (minutes < 60) return `${minutes} min restantes`;



  const hours = Math.floor(minutes / 60);

  const mins = minutes % 60;



  return `${hours} h ${mins > 0 ? `${mins} min` : ""}`.trim();

}



function numericTimestamp(value: unknown) {

  const num = Number(value);

  return Number.isFinite(num) ? num : 0;

}



function uniqueById<T extends { id: string | number }>(items: T[]) {

  const map = new Map<string, T>();



  for (const item of items) {

    map.set(String(item.id), item);

  }



  return Array.from(map.values());

}



/* =========================================================

   LOGO HOOK

\========================================================= */



type HeroLogoState = {
  logoUrl: string | null;
  loading: boolean;
  resolved: boolean;
};

const heroLogoCache = new Map<string, string | null>();
const heroLogoPending = new Map<string, Promise<string | null>>();

function heroLogoKey(
  tmdbId?: string | number,
  rawTitle?: string,
  type: "movie" | "tv" = "movie",
  explicitYear?: string | number | null
) {
  const title = cleanMediaTitle(rawTitle || "").toLowerCase();
  const year =
    explicitYear != null && String(explicitYear).trim()
      ? String(explicitYear).trim()
      : extractTitleYear(rawTitle) || "";

  return `${type}:${String(tmdbId || "")}:${title}:${year}`;
}

async function resolveHeroLogo(
  tmdbId?: string | number,
  rawTitle?: string,
  type: "movie" | "tv" = "movie",
  explicitYear?: string | number | null
) {
  const key = heroLogoKey(tmdbId, rawTitle, type, explicitYear);

  if (heroLogoCache.has(key)) {
    return heroLogoCache.get(key) || null;
  }

  const pending = heroLogoPending.get(key);
  if (pending) return pending;

  const request = (async () => {
    const cleanTitle = cleanMediaTitle(rawTitle || "");
    const year =
      explicitYear != null && String(explicitYear).trim()
        ? String(explicitYear).trim()
        : extractTitleYear(rawTitle);

    const types = type === "tv" ? ["tv", "series"] : ["movie"];

    for (const requestType of types) {
      try {
        const query = new URLSearchParams();

        if (tmdbId && String(tmdbId) !== "0") {
          query.set("tmdbId", String(tmdbId));
        }
        if (cleanTitle) query.set("title", cleanTitle);
        if (year) query.set("year", String(year));
        query.set("type", requestType);

        const response = await fetch(
          `/api/title-logo?${query.toString()}`,
          { cache: "force-cache" }
        ).catch(() => null);

        if (!response?.ok) continue;

        const data = await response.json().catch(() => ({}));
        const found =
          safeImage(data?.logoUrl) ||
          safeImage(data?.logo) ||
          safeImage(data?.clearlogo) ||
          null;

        if (found) {
          // Preload the transparent image itself before declaring it ready.
          await new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = found;
          });

          heroLogoCache.set(key, found);
          return found;
        }
      } catch {}
    }

    heroLogoCache.set(key, null);
    return null;
  })().finally(() => {
    heroLogoPending.delete(key);
  });

  heroLogoPending.set(key, request);
  return request;
}

function useHeroLogo(
  tmdbId?: string | number,
  rawTitle?: string,
  type: "movie" | "tv" = "movie",
  explicitYear?: string | number | null
): HeroLogoState {
  const key = heroLogoKey(tmdbId, rawTitle, type, explicitYear);
  const cached = heroLogoCache.has(key);

  const [state, setState] = useState<HeroLogoState>(() => ({
    logoUrl: cached ? heroLogoCache.get(key) || null : null,
    loading: !cached,
    resolved: cached,
  }));

  useEffect(() => {
    let mounted = true;

    if (!tmdbId && !rawTitle) {
      setState({ logoUrl: null, loading: false, resolved: true });
      return;
    }

    const currentKey = heroLogoKey(tmdbId, rawTitle, type, explicitYear);

    if (heroLogoCache.has(currentKey)) {
      setState({
        logoUrl: heroLogoCache.get(currentKey) || null,
        loading: false,
        resolved: true,
      });
      return;
    }

    // Important: no text fallback while the logo is being resolved.
    setState({ logoUrl: null, loading: true, resolved: false });

    void resolveHeroLogo(tmdbId, rawTitle, type, explicitYear).then((logoUrl) => {
      if (!mounted) return;
      setState({ logoUrl, loading: false, resolved: true });
    });

    return () => {
      mounted = false;
    };
  }, [key, tmdbId, rawTitle, type, explicitYear]);

  return state;
}

type FanartMediaType = "movie" | "series";

const fanartBackdropCache = new Map<string, string | null>();
const fanartBackdropPending = new Map<string, Promise<string | null>>();

function fanartBackdropKey(
  tmdbId?: string | number | null,
  type: FanartMediaType = "movie"
) {
  return `${type}:${String(tmdbId || "")}`;
}

async function resolveFanartBackdrop(
  tmdbId?: string | number | null,
  type: FanartMediaType = "movie"
): Promise<string | null> {
  if (!tmdbId || String(tmdbId) === "0") return null;

  const key = fanartBackdropKey(tmdbId, type);

  if (fanartBackdropCache.has(key)) {
    return fanartBackdropCache.get(key) || null;
  }

  const pending = fanartBackdropPending.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      // IMPORTANT:
      // This stays same-origin on Cloudflare. app/api/[...path]/route.ts
      // proxies the request to Railway. No Railway URL/API key is exposed here.
      const response = await fetch(
        `/api/fanart/${type}?tmdbId=${encodeURIComponent(String(tmdbId))}`,
        { cache: "force-cache" }
      ).catch(() => null);

      if (!response?.ok) {
        fanartBackdropCache.set(key, null);
        return null;
      }

      const json = await response.json().catch(() => ({}));
      const backdrop =
        safeImage(json?.backdrop) ||
        safeImage(json?.fanart) ||
        safeImage(json?.background) ||
        null;

      if (backdrop && typeof window !== "undefined") {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = backdrop;
        });
      }

      fanartBackdropCache.set(key, backdrop);
      return backdrop;
    } catch {
      fanartBackdropCache.set(key, null);
      return null;
    }
  })().finally(() => {
    fanartBackdropPending.delete(key);
  });

  fanartBackdropPending.set(key, request);
  return request;
}

function useFanartBackdrop(
  tmdbId?: string | number | null,
  type: FanartMediaType = "movie",
  fallback?: string | null
) {
  const fallbackImage = safeImage(fallback);
  const key = fanartBackdropKey(tmdbId, type);

  const [image, setImage] = useState<string | null>(() => {
    if (fanartBackdropCache.has(key)) {
      return fanartBackdropCache.get(key) || fallbackImage;
    }
    return fallbackImage;
  });

  useEffect(() => {
    let mounted = true;
    const safeFallback = safeImage(fallback);

    if (!tmdbId || String(tmdbId) === "0") {
      setImage(safeFallback);
      return;
    }

    if (fanartBackdropCache.has(key)) {
      setImage(fanartBackdropCache.get(key) || safeFallback);
      return;
    }

    // Keep the existing image visible until the HD wallpaper is fully loaded.
    setImage(safeFallback);

    void resolveFanartBackdrop(tmdbId, type).then((backdrop) => {
      if (!mounted) return;
      setImage(backdrop || safeFallback);
    });

    return () => {
      mounted = false;
    };
  }, [key, tmdbId, type, fallback]);

  return image || fallbackImage;
}

function useHeroArtwork(
  tmdbId?: string | number,
  _title?: string,
  type: "movie" | "series" = "movie",
  fallback?: string | null
) {
  return useFanartBackdrop(tmdbId, type, fallback);
}

function ContinueDragRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);

  const dragRef = useRef({
    pressed: false,
    dragging: false,
    moved: false,
    startX: 0,
    startScrollLeft: 0,
    pointerId: -1,
  });

  const resetDrag = () => {
    const el = ref.current;
    const drag = dragRef.current;

    if (el) {
      el.style.cursor = "grab";
      el.style.scrollSnapType = "x mandatory";
      el.style.removeProperty("scroll-behavior");
    }

    drag.pressed = false;
    drag.dragging = false;
    drag.pointerId = -1;

    window.setTimeout(() => {
      dragRef.current.moved = false;
    }, 80);
  };

  return (
    <div
      ref={ref}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;

        const el = ref.current;
        if (!el) return;

        dragRef.current = {
          pressed: true,
          dragging: false,
          moved: false,
          startX: event.clientX,
          startScrollLeft: el.scrollLeft,
          pointerId: event.pointerId,
        };

        // IMPORTANT:
        // no pointer capture here.
        // A normal desktop click stays a normal click.
      }}
      onPointerMove={(event) => {
        const el = ref.current;
        const drag = dragRef.current;

        if (
          !el ||
          !drag.pressed ||
          event.pointerId !== drag.pointerId
        ) {
          return;
        }

        const delta = event.clientX - drag.startX;

        // Start a real drag only after an intentional mouse movement.
        if (!drag.dragging) {
          if (Math.abs(delta) < 7) return;

          drag.dragging = true;
          drag.moved = true;

          el.style.cursor = "grabbing";
          el.style.scrollSnapType = "none";
          el.style.scrollBehavior = "auto";

          el.setPointerCapture?.(event.pointerId);
        }

        event.preventDefault();
        el.scrollLeft = drag.startScrollLeft - delta;
      }}
      onPointerUp={(event) => {
        const el = ref.current;

        if (
          el &&
          el.hasPointerCapture?.(event.pointerId)
        ) {
          el.releasePointerCapture(event.pointerId);
        }

        resetDrag();
      }}
      onPointerCancel={resetDrag}
      onLostPointerCapture={() => {
        if (dragRef.current.dragging) {
          resetDrag();
        }
      }}
      onClickCapture={(event) => {
        // Cancel navigation ONLY when an actual drag happened.
        if (!dragRef.current.moved) return;

        event.preventDefault();
        event.stopPropagation();
      }}
      className="
        flex
        snap-x
        snap-mandatory
        gap-3
        overflow-x-auto
        overscroll-x-contain
        pb-4
        pr-6
        scrollbar-none
        cursor-grab
        select-none
        sm:gap-4
      "
      style={{
        WebkitOverflowScrolling: "touch",
      }}
    >
      {children}
    </div>
  );
}

function ContinueCard({ item }: { item: ContinueItem }) {
  const router = useRouter();

  const { logoUrl } = useHeroLogo(
    item.tmdbId || undefined,
    item.title,
    item.type === "series" ? "tv" : "movie"
  );
  
  const continueBackdrop = useFanartBackdrop(
    item.tmdbId || undefined,
    item.type === "series" ? "series" : "movie",
    item.image
  );
const percent = getContinuePercent(item);
  const cleanTitle = cleanMediaTitle(item.title);

  const episodeLabel =
    item.type === "series" && (item.season != null || item.episode != null)
      ? [
          item.season != null
            ? `S${String(item.season).padStart(2, "0")}`
            : null,
          item.episode != null
            ? `E${String(item.episode).padStart(2, "0")}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <button
      type="button"
      onClick={() => router.push(buildResumeHref(item))}
      className="
        group
        relative
        w-[300px]
        shrink-0
        snap-start
        overflow-hidden
        rounded-[18px]
        border
        border-white/[0.08]
        bg-[#08080d]
        text-left
        shadow-[0_18px_50px_rgba(0,0,0,.30)]
        transition-[transform,border-color,box-shadow]
        duration-500
        hover:-translate-y-1
        hover:border-[#c4adff]/25
        hover:shadow-[0_26px_70px_rgba(0,0,0,.48)]
        sm:w-[340px]
        lg:w-[365px]
      "
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[#09090e]">
        {item.image ? (
          <img
            src={continueBackdrop || item.image}
            alt=""
            draggable={false}
            className="
              pointer-events-none
              absolute
              inset-0
              h-full
              w-full
              select-none
              object-cover
              transition-transform
              duration-700
              ease-out
              group-hover:scale-[1.045]
            "
            style={{ objectPosition: "center 16%" }}
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(126,91,191,.20),transparent_38%),#09090e]" />
        )}

        {/* Cinema treatment */}
        <div className="pointer-events-none absolute inset-0 bg-black/30" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(4,4,8,.08)_0%,rgba(5,5,10,.18)_32%,rgba(7,6,13,.64)_68%,rgba(6,5,11,.97)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] bg-[radial-gradient(ellipse_at_center_bottom,rgba(102,67,165,.20),transparent_68%)]" />

        {/* Play on hover */}
        <div
          className="
            absolute
            left-3
            top-3
            grid
            h-9
            w-9
            place-items-center
            rounded-full
            border
            border-white/15
            bg-black/35
            opacity-0
            shadow-lg
            backdrop-blur-md
            transition-all
            duration-300
            group-hover:opacity-100
          "
        >
          <Play className="ml-0.5 h-4 w-4 fill-white text-white" />
        </div>

        {/* GTV signature + official title logo */}
        <div className="pointer-events-none absolute inset-x-5 bottom-[14%] flex flex-col items-center justify-end">
          <div className="mb-2.5 text-center text-[8px] font-semibold uppercase tracking-[0.30em] text-white/55 drop-shadow-[0_2px_8px_rgba(0,0,0,.9)] sm:text-[9px]">
            CONTINUEZ À REGARDER
          </div>

          <div className="flex h-[64px] w-full items-center justify-center sm:h-[70px]">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={cleanTitle}
                draggable={false}
                className="
                  max-h-full
                  w-auto
                  max-w-[68%]
                  select-none
                  object-contain
                  drop-shadow-[0_5px_18px_rgba(0,0,0,.88)]
                "
              />
            ) : (
              <div className="max-w-[82%] text-center text-[18px] font-semibold leading-[1.05] tracking-[-0.03em] text-white drop-shadow-[0_4px_14px_rgba(0,0,0,.95)] sm:text-[20px]">
                {cleanTitle || item.title}
              </div>
            )}
          </div>

          {episodeLabel && (
            <div className="mt-2 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55 drop-shadow-[0_2px_8px_rgba(0,0,0,.9)]">
              {episodeLabel}
            </div>
          )}
        </div>

        {/* Fine progress */}
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/[0.10]">
          <div
            className="h-full rounded-r-full bg-[#c7b2ff] shadow-[0_0_10px_rgba(199,178,255,.42)]"
            style={{
              width: `${Math.max(2, Math.min(100, percent))}%`,
            }}
          />
        </div>
      </div>
    </button>
  );
}

/* =========================================================

   CARD - MEDIA

\========================================================= */



function MediaCard({

  id,

  title,

  image,

  type,

  rating,

  year,

}: {

  id: string | number;

  title: string;

  image?: string | null;

  type: "movie" | "series";

  rating?: number;

  year?: string | number | null;

}) {

  const router = useRouter();



  const href = type === "movie" ? `/movies/${id}` : `/series/${id}`;



  return (

    <button

      type="button"

      onClick={() => router.push(href)}

      className="

        group
        snap-start

        relative

        w-[145px]

        sm:w-[165px]

        md:w-[180px]

        xl:w-[190px]

        shrink-0

        text-left

      "

    >

      <div

        className="

          relative

          aspect-[2/3]

          overflow-hidden

          rounded-[18px]

          bg-[#101014]

          shadow-[0_16px_40px_rgba(0,0,0,.25)]

          ring-1

          ring-white/[0.055]

          transition-all

          duration-500

          group-hover:-translate-y-1.5

          group-hover:scale-[1.025]

          group-hover:ring-white/[0.16]

          group-hover:shadow-[0_24px_65px_rgba(0,0,0,.40)]

        "

      >

        {image ? (

          <img

            src={image}

            alt={title}

            draggable={false}

            loading="lazy"

            decoding="async"

            className="

              absolute

              inset-0

              h-full

              w-full

              object-cover

              transition-transform

              duration-700

              group-hover:scale-[1.055]

            "

          />

        ) : (

          <div className="absolute inset-0 bg-gradient-to-br from-[#19191f] to-[#08080a]" />

        )}



        <div

          className="

            absolute

            inset-0

            bg-gradient-to-t

            from-black/95

            via-black/5

            to-transparent

            opacity-55

            transition-opacity

            duration-300

            group-hover:opacity-90

          "

        />



        <div

          className="

            absolute

            inset-0

            flex

            items-center

            justify-center

            bg-black/5

            opacity-0

            transition

            duration-300

            group-hover:opacity-100

          "

        >

          <div

            className="

              grid

              h-11

              w-11

              place-items-center

              rounded-full

              border

              border-white/25

              bg-black/30

              backdrop-blur-xl

            "

          >

            <Play className="h-4 w-4 translate-x-[1px] fill-white text-white" />

          </div>

        </div>



        <div

          className="

            absolute

            inset-x-0

            bottom-0

            translate-y-2

            px-3

            pb-3

            opacity-0

            transition-all

            duration-300

            group-hover:translate-y-0

            group-hover:opacity-100

          "

        >

          <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-white">

            {cleanMediaTitle(title)}

          </p>



          <div className="mt-1.5 flex items-center gap-2 text-[8px] text-white/45">

            {year && <span>{year}</span>}



            {rating && rating > 0 && (

              <>

                <span>•</span>

                <span className="flex items-center gap-1">

                  <Star className="h-2.5 w-2.5 fill-[#d8ccff] text-[#d8ccff]" />

                  {rating.toFixed(1)}

                </span>

              </>

            )}

          </div>

        </div>

      </div>

    </button>

  );

}



/* =========================================================

   SECTION RAIL

\========================================================= */



function RailSection({
  title,
  children,
  href,
}: {
  title: string;
  children: React.ReactNode;
  href: string;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);

  const dragRef = useRef({
    pressed: false,
    dragging: false,
    moved: false,
    startX: 0,
    startScrollLeft: 0,
    pointerId: -1,
  });

  const resetDrag = () => {
    const el = railRef.current;
    const drag = dragRef.current;

    if (el) {
      el.style.cursor = "grab";
      el.style.scrollSnapType = "x mandatory";
      el.style.removeProperty("scroll-behavior");
    }

    drag.pressed = false;
    drag.dragging = false;
    drag.pointerId = -1;

    window.setTimeout(() => {
      dragRef.current.moved = false;
    }, 80);
  };

  return (
    <section className="relative z-10 [content-visibility:auto] [contain-intrinsic-size:420px]">
      <div className="relative z-30 mb-4 flex items-center justify-between pointer-events-auto">
        <a
          href={href}
          className="group/title relative z-40 inline-flex cursor-pointer items-center gap-2 text-left pointer-events-auto"
          aria-label={`Voir ${title}`}
        >
          <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-white sm:text-[19px]">
            {title}
          </h2>

          <ChevronRight
            className="
              h-4
              w-4
              text-white/30
              transition-all
              duration-300
              group-hover/title:translate-x-1
              group-hover/title:text-white
            "
          />
        </a>
      </div>

      <div
        ref={railRef}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;

          const el = railRef.current;
          if (!el) return;

          dragRef.current = {
            pressed: true,
            dragging: false,
            moved: false,
            startX: event.clientX,
            startScrollLeft: el.scrollLeft,
            pointerId: event.pointerId,
          };

          // Do NOT capture the pointer on mouse-down.
          // This preserves normal desktop clicks on cards.
        }}
        onPointerMove={(event) => {
          const el = railRef.current;
          const drag = dragRef.current;

          if (
            !el ||
            !drag.pressed ||
            event.pointerId !== drag.pointerId
          ) {
            return;
          }

          const delta = event.clientX - drag.startX;

          if (!drag.dragging) {
            if (Math.abs(delta) < 7) return;

            drag.dragging = true;
            drag.moved = true;

            el.style.cursor = "grabbing";
            el.style.scrollSnapType = "none";
            el.style.scrollBehavior = "auto";

            // Capture only AFTER the gesture is confirmed as a drag.
            el.setPointerCapture?.(event.pointerId);
          }

          event.preventDefault();
          el.scrollLeft = drag.startScrollLeft - delta;
        }}
        onPointerUp={(event) => {
          const el = railRef.current;

          if (
            el &&
            el.hasPointerCapture?.(event.pointerId)
          ) {
            el.releasePointerCapture(event.pointerId);
          }

          resetDrag();
        }}
        onPointerCancel={resetDrag}
        onLostPointerCapture={() => {
          if (dragRef.current.dragging) {
            resetDrag();
          }
        }}
        onClickCapture={(event) => {
          // A simple click is NEVER blocked.
          if (!dragRef.current.moved) return;

          event.preventDefault();
          event.stopPropagation();
        }}
        className="
          flex
          snap-x
          snap-mandatory
          gap-3
          overflow-x-auto
          overscroll-x-contain
          pb-4
          pr-6
          scrollbar-none
          cursor-grab
          select-none
          sm:gap-4
        "
        style={{
          WebkitOverflowScrolling: "touch",
        }}
      >
        {children}
      </div>
    </section>
  );
}

export default function HomePage() {

  const router = useRouter();

  const { favorites } = useLibrary();



  const [currentSlide, setCurrentSlide] = useState(0);

  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);



  /* =======================================================

     HOME FEED — payload réduit côté Railway

  ======================================================= */



  const {

    data: homeFeed,

    isLoading: homeLoading,

  } = useQuery({

    queryKey: ["home-feed-v2"],

    queryFn: async () => {

      const res = await fetch("/api/home-feed", { cache: "no-store" });

      if (!res.ok) throw new Error("Impossible de charger l’accueil");

      return res.json() as Promise<{ movies?: XtreamMovie[]; series?: XtreamSeries[] }>;

    },

    staleTime: 15 * 60 * 1000,

    gcTime: 60 * 60 * 1000,

    retry: 0,

  });



  const movies: XtreamMovie[] = Array.isArray(homeFeed?.movies) ? homeFeed.movies : [];

  const series: XtreamSeries[] = Array.isArray(homeFeed?.series) ? homeFeed.series : [];

  const moviesLoading = homeLoading;

  const seriesLoading = homeLoading;



  /* =======================================================

     HERO

  ======================================================= */



  const heroSlides: HeroSlide[] = useMemo(() => {

    const movieCandidates = movies

      .filter((movie) => {

        return (

          movie?.stream_id &&

          movie?.stream_icon &&

          String(movie.stream_icon).startsWith("http")

        );

      })

      .slice(0, 8)

      .map((movie) => ({

        id: movie.stream_id,

        type: "movie" as const,

        rawTitle: movie.name || "Film",

        title: cleanMediaTitle(movie.name || "Film"),

        image: movie.stream_icon || "",
        backdrop:
          safeImage(
            Array.isArray(movie.backdrop_path)
              ? movie.backdrop_path[0]
              : movie.backdrop_path
          ) ||
          safeImage(movie.backdrop) ||
          null,

        year:

          yearFrom(

            movie.releaseDate || movie.releasedate,

            movie.name || ""

          ) || null,

        rating: ratingNum(movie.rating),

        genre: movie.genre || "",

        synopsis:

          movie.plot ||

          movie.description ||

          "Découvrez ce film dans votre catalogue GTV.",

        link: `/movies/${movie.stream_id}`,

        tmdbId: movie.tmdb_id || movie.tmdb,

      }));



    const seriesCandidates = series

      .filter((item) => {

        const image =

          item?.backdrop_path?.[0] ||

          item?.cover;



        return (

          item?.series_id &&

          image &&

          String(image).startsWith("http")

        );

      })

      .slice(0, 6)

      .map((item) => ({

        id: item.series_id,

        type: "series" as const,

        rawTitle: item.name || "Série",

        title: cleanMediaTitle(item.name || "Série"),

        image:
          item.backdrop_path?.[0] ||
          item.cover ||
          "",
        backdrop:
          safeImage(item.backdrop_path?.[0]) ||
          null,

        year:

          yearFrom(

            item.releaseDate || item.releasedate,

            item.name || ""

          ) || null,

        rating: ratingNum(item.rating),

        genre: item.genre || "",

        synopsis:

          item.plot ||

          item.description ||

          "Découvrez cette série dans votre catalogue GTV.",

        link: `/series/${item.series_id}`,

        tmdbId: item.tmdb_id || item.tmdb,

      }));



    const mixed = [

      ...movieCandidates.slice(0, 4),

      ...seriesCandidates.slice(0, 3),

    ];



    return mixed.slice(0, 6);

  }, [movies, series]);



  const activeSlide = heroSlides[currentSlide];



  const activeTmdbId = useMemo(() => {

    if (!activeSlide) return undefined;



    if (activeSlide.type === "movie") {

      const movie = movies.find(

        (item) => String(item.stream_id) === String(activeSlide.id)

      );



      return movie?.tmdb_id || movie?.tmdb;

    }



    const serie = series.find(

      (item) => String(item.series_id) === String(activeSlide.id)

    );



    return serie?.tmdb_id || serie?.tmdb;

  }, [activeSlide, movies, series]);



  const {
    logoUrl: heroLogo,
    loading: heroLogoLoading,
    resolved: heroLogoResolved,
  } = useHeroLogo(
    activeTmdbId,
    activeSlide?.rawTitle || activeSlide?.title,
    activeSlide?.type === "series" ? "tv" : "movie",
    activeSlide?.year || extractTitleYear(activeSlide?.rawTitle || activeSlide?.title)
  );

  const heroArtwork = useHeroArtwork(
    activeTmdbId,
    activeSlide?.title,
    activeSlide?.type === "series" ? "series" : "movie",
    activeSlide?.backdrop || activeSlide?.image || null
  );

  const heroFallbackImage =
    safeImage(activeSlide?.image) ||
    safeImage(activeSlide?.backdrop) ||
    null;

  const heroHasNativeBackdrop =
    Boolean(safeImage(activeSlide?.backdrop)) ||
    Boolean(
      heroArtwork &&
      heroFallbackImage &&
      heroArtwork !== heroFallbackImage
    );

  const heroPosterFallback =
    !heroHasNativeBackdrop && heroFallbackImage
      ? heroFallbackImage
      : null;

  // Resolve and preload the other Hero logos as soon as the feed is ready.
  useEffect(() => {
    for (const slide of heroSlides) {
      const tmdbId =
        slide.type === "movie"
          ? movies.find((movie) => String(movie.stream_id) === String(slide.id))?.tmdb_id
          : series.find((item) => String(item.series_id) === String(slide.id))?.tmdb_id;

      void resolveHeroLogo(
        tmdbId,
        slide.rawTitle || slide.title,
        slide.type === "series" ? "tv" : "movie",
        slide.year || extractTitleYear(slide.rawTitle || slide.title)
      );
    }
  }, [heroSlides, movies, series]);







  /* =======================================================

     HERO ROTATION

  ======================================================= */



  useEffect(() => {

    if (heroSlides.length <= 1) return;



    const timer = window.setInterval(() => {

      setCurrentSlide((prev) => {

        return (prev + 1) % heroSlides.length;

      });

    }, 11000);



    return () => {

      window.clearInterval(timer);

    };

  }, [heroSlides.length]);



  useEffect(() => {

    if (currentSlide >= heroSlides.length && heroSlides.length > 0) {

      setCurrentSlide(0);

    }

  }, [heroSlides.length, currentSlide]);



  /* =======================================================
     CONTINUE — 3 FILMS + 3 SÉRIES
  ======================================================= */

  useEffect(() => {
    const readContinueItems = () => {
      const read = (key: string, type: "movie" | "series") => {
        try {
          const raw = localStorage.getItem(key);
          const parsed = raw ? JSON.parse(raw) : [];

          if (!Array.isArray(parsed)) return [];

          return parsed
            .filter((item: ContinueItem) => {
              if (!item?.id || !item?.title || item.type !== type) return false;

              const position = Number(item.position || 0);
              const duration = Number(item.duration || 0);

              if (position <= 15) return false;
              if (duration > 0 && position / duration >= 0.97) return false;

              return true;
            })
            .sort(
              (a: ContinueItem, b: ContinueItem) =>
                numericTimestamp(b.updatedAt) - numericTimestamp(a.updatedAt)
            )
            .slice(0, 3);
        } catch {
          return [];
        }
      };

      setContinueItems([
        ...read("gtv_continue_movies", "movie"),
        ...read("gtv_continue_series", "series"),
      ]);
    };

    readContinueItems();
    window.addEventListener("storage", readContinueItems);
    window.addEventListener("gtv-continue-updated", readContinueItems as EventListener);

    return () => {
      window.removeEventListener("storage", readContinueItems);
      window.removeEventListener("gtv-continue-updated", readContinueItems as EventListener);
    };
  }, []);

  const continueMovies = useMemo(
    () => continueItems.filter((item) => item.type === "movie").slice(0, 3),
    [continueItems]
  );

  const continueSeries = useMemo(
    () => continueItems.filter((item) => item.type === "series").slice(0, 3),
    [continueItems]
  );





  /* =======================================================

     RAIL DATA

  ======================================================= */



  /*
    ARTWORK PRELOAD OPTIMISÉ
    - Hero actif: chargé par useHeroArtwork.
    - Seulement le Hero suivant est préchargé.
    - Continue: seulement les 3 films + 3 séries visibles.
    - resolveFanartBackdrop déduplique cache + requêtes en cours.
  */
  const nextHeroArtwork = useMemo(() => {
    if (!heroSlides.length) return null;

    const nextIndex =
      (currentSlide + 1) % heroSlides.length;

    const slide = heroSlides[nextIndex];
    if (!slide) return null;

    const tmdbId =
      slide.type === "movie"
        ? movies.find(
            (movie) =>
              String(movie.stream_id) === String(slide.id)
          )?.tmdb_id
        : series.find(
            (item) =>
              String(item.series_id) === String(slide.id)
          )?.tmdb_id;

    if (!tmdbId) return null;

    return {
      tmdbId: String(tmdbId),
      type:
        slide.type === "series"
          ? ("series" as const)
          : ("movie" as const),
    };
  }, [currentSlide, heroSlides, movies, series]);

  const nextHeroArtworkKey =
    nextHeroArtwork
      ? `${nextHeroArtwork.type}:${nextHeroArtwork.tmdbId}`
      : "";

  useEffect(() => {
    if (!nextHeroArtwork) return;

    void resolveFanartBackdrop(
      nextHeroArtwork.tmdbId,
      nextHeroArtwork.type
    );
  }, [nextHeroArtworkKey]);

  const continueArtworkKeys = useMemo(() => {
    const keys = new Set<string>();

    for (const item of continueMovies.slice(0, 3)) {
      if (item.tmdbId) {
        keys.add(`movie:${String(item.tmdbId)}`);
      }
    }

    for (const item of continueSeries.slice(0, 3)) {
      if (item.tmdbId) {
        keys.add(`series:${String(item.tmdbId)}`);
      }
    }

    return Array.from(keys).sort();
  }, [continueMovies, continueSeries]);

  const continueArtworkSignature =
    continueArtworkKeys.join("|");

  useEffect(() => {
    for (const key of continueArtworkKeys) {
      const separator = key.indexOf(":");
      if (separator <= 0) continue;

      const type =
        key.slice(0, separator) as FanartMediaType;

      const tmdbId =
        key.slice(separator + 1);

      if (!tmdbId) continue;

      void resolveFanartBackdrop(tmdbId, type);
    }
  }, [continueArtworkSignature]);

  const trendingMovies = useMemo(() => {

    return [...movies]

      .filter(

        (movie) =>

          movie.stream_icon &&

          String(movie.stream_icon).startsWith("http")

      )

      .sort((a, b) => ratingNum(b.rating) - ratingNum(a.rating))

      .slice(0, 18);

  }, [movies]);



  const newestMovies = useMemo(() => {

    return [...movies]

      .filter(

        (movie) =>

          movie.stream_icon &&

          String(movie.stream_icon).startsWith("http")

      )

      .sort(

        (a, b) =>

          numericTimestamp(b.added) -

          numericTimestamp(a.added)

      )

      .slice(0, 18);

  }, [movies]);



  const discoveryMovies = useMemo(() => {
    const excluded = new Set([
      ...trendingMovies.map((item) => String(item.stream_id)),
      ...newestMovies.map((item) => String(item.stream_id)),
    ]);

    const fresh = movies.filter(
      (item) => !excluded.has(String(item.stream_id))
    );

    return (fresh.length >= 8 ? fresh : movies).slice(0, 14);
  }, [movies, trendingMovies, newestMovies]);

  const discoverySeries = useMemo(() => {

    return [...series]

      .filter((item) => {

        const image =

          item.cover ||

          item.backdrop_path?.[0];



        return image && String(image).startsWith("http");

      })

      .sort(

        (a, b) =>

          ratingNum(b.rating) -

          ratingNum(a.rating)

      )

      .slice(0, 18);

  }, [series]);



  /* =======================================================

     FAVORITES

  ======================================================= */



  const favoriteItems = useMemo(() => {

    return Object.values(favorites || {}).slice(0, 18);

  }, [favorites]);



  /* =======================================================

     RENDER

  ======================================================= */



  const loading = moviesLoading && seriesLoading;



  return (

    <main

      className="

        relative

        min-h-[100dvh]

        overflow-x-hidden

        bg-[#060608]

        pb-28

        text-white

        md:pb-20

      "

    >

      {/* ===================================================

          HERO

      =================================================== */}



      <section

        className="

          relative

          h-[72vh]

          min-h-[600px]

          w-full

          overflow-hidden

          bg-[#0a0a0d]

          sm:h-[76vh]

          lg:h-[82vh]

          lg:min-h-[690px]

        "

      >

        {loading ? (

          <div className="absolute inset-0 grid place-items-center">

            <Loader2 className="h-9 w-9 animate-spin text-white/15" />

          </div>

        ) : activeSlide ? (

          <>

            <AnimatePresence mode="wait">

              <motion.div

                key={`${activeSlide.type}-${activeSlide.id}`}

                variants={heroImageVariants}

                initial="enter"

                animate="center"

                exit="exit"

                className="pointer-events-none absolute inset-0"

              >

                {heroPosterFallback ? (
                  <>
                    {/* No real landscape backdrop: create a cinematic background from the poster. */}
                    <img
                      src={heroPosterFallback}
                      loading="eager"
                      decoding="async"
                      fetchPriority="high"
                      alt=""
                      aria-hidden="true"
                      className="
                        absolute
                        -inset-[8%]
                        h-[116%]
                        w-[116%]
                        scale-125
                        object-cover
                        object-center
                        blur-[46px]
                        saturate-[1.05]
                        brightness-[.46]
                        lg:scale-[1.38]
                        lg:blur-[58px]
                      "
                    />

                    <div className="absolute inset-0 bg-black/20" />

                    <img
                      src={heroPosterFallback}
                      loading="eager"
                      decoding="async"
                      fetchPriority="high"
                      alt={activeSlide.title}
                      className="
                        absolute
                        inset-x-0
                        top-0
                        block
                        h-[56%]
                        w-full
                        object-cover
                        object-[center_22%]
                        opacity-90
                        [mask-image:linear-gradient(to_bottom,black_0%,black_62%,transparent_100%)]
                        sm:h-[62%]
                        lg:hidden
                      "
                    />
                  </>
                ) : (
                  <img
                    src={heroArtwork || activeSlide.image}
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    alt={activeSlide.title}
                    className="
                      absolute
                      inset-0
                      h-full
                      w-full
                      object-cover
                      object-[center_30%]
                      sm:object-[center_38%]
                      lg:object-[center_58%]
                    "
                  />
                )}

              </motion.div>

            </AnimatePresence>



            <div className="pointer-events-none absolute inset-0 bg-black/10" />



            <div

              className="

                pointer-events-none
                absolute

                inset-0

                bg-gradient-to-r

                from-[#060608]/92

                via-[#060608]/62

                via-[42%]

                to-transparent

                lg:from-[#060608]

                lg:via-[#060608]/78

                lg:via-[36%]

              "

            />



            <div

              className="

                pointer-events-none
                absolute

                inset-x-0

                top-0

                h-36

                bg-gradient-to-b

                from-black/65

                to-transparent

              "

            />



            <div

              className="

                pointer-events-none
                absolute

                inset-x-0

                bottom-0

                h-[42%]

                lg:h-[48%]

                bg-gradient-to-t

                from-[#060608]

                via-[#060608]/68

                to-transparent

              "

            />



            <div

              className="

                pointer-events-none
                absolute

                inset-y-0

                right-0

                w-[40%]

                bg-gradient-to-l

                from-black/15

                to-transparent

              "

            />



            <div

              className="

                relative

                z-10

                flex

                h-full

                max-w-[1900px]

                items-end

                px-4

                pb-[118px]

                sm:px-7

                sm:pb-[130px]

                lg:px-12

                lg:pb-[138px]

                xl:px-14

              "

            >

              <AnimatePresence mode="wait">

                <motion.div

                  key={`hero-content-${activeSlide.type}-${activeSlide.id}`}

                  variants={heroContentVariants}

                  initial="hidden"

                  animate="show"

                  exit="hidden"

                  className="max-w-[680px]"

                >

                  <div className="mb-4 flex items-center gap-2">

                    <span

                      className="

                        h-1.5

                        w-1.5

                        rounded-full

                        bg-[#d8ccff]

                        shadow-[0_0_14px_rgba(216,204,255,.9)]

                      "

                    />



                    <p className="text-[9px] font-semibold uppercase tracking-[0.30em] text-[#d8ccff]/75">

                      À la une sur GTV

                    </p>

                  </div>



                  {heroLogoLoading || !heroLogoResolved ? null : heroLogo ? (
            <div className="mb-5 flex min-h-[85px] items-end">

                      <img

                        src={heroLogo}

                        decoding="async"

                        alt={activeSlide.title}

                        className="

                          max-h-[125px]

                          max-w-[350px]

                          object-contain

                          object-left

                          drop-shadow-[0_14px_30px_rgba(0,0,0,.55)]

                          sm:max-w-[460px]

                          lg:max-h-[165px]

                          lg:max-w-[560px]

                        "

                      />

                    </div>
          ) : (
            <h1

                      className="

                        mb-4

                        max-w-[700px]

                        text-4xl

                        font-semibold

                        leading-[0.95]

                        tracking-[-0.045em]

                        text-white

                        drop-shadow-2xl

                        sm:text-5xl

                        lg:text-6xl

                        xl:text-7xl

                      "

                    >

                      {activeSlide.title}

                    </h1>
          )}



                  <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[11px] font-medium text-white/65 sm:text-xs">

                    {activeSlide.year && (

                      <span>{activeSlide.year}</span>

                    )}



{typeof activeSlide.rating === "number" && activeSlide.rating > 0 && (

  <>

    <span className="text-white/25">•</span>



    <span className="flex items-center gap-1 text-white/75">

      <Star className="h-3 w-3 fill-[#d8ccff] text-[#d8ccff]" />

      {activeSlide.rating.toFixed(1)}

    </span>

  </>

)}



                    <span className="text-white/25">•</span>



                    <span className="rounded-[5px] border border-white/15 bg-white/[0.07] px-1.5 py-[2px] text-[9px] text-white/65">

                      {activeSlide.type === "series" ? "SÉRIE" : "FILM"}

                    </span>



                    {activeSlide.genre && (

                      <>

                        <span className="text-white/25">•</span>



                        <span className="line-clamp-1 max-w-[350px]">

                          {activeSlide.genre}

                        </span>

                      </>

                    )}

                  </div>



                  <p

                    className="

                      mb-7

                      line-clamp-3

                      max-w-[650px]

                      text-[12px]

                      leading-6

                      text-white/54

                      sm:text-[13px]

                      lg:text-[14px]

                    "

                  >

                    {activeSlide.synopsis}

                  </p>



                  <div className="flex flex-wrap items-center gap-2.5">

                    <button

                      type="button"

                      onClick={() => router.push(activeSlide.link)}

                      className="

                        inline-flex

                        h-11

                        items-center

                        gap-2.5

                        rounded-[10px]

                        bg-white

                        px-6

                        text-[13px]

                        font-semibold

                        text-[#111318]

                        shadow-[0_12px_38px_rgba(0,0,0,.28)]

                        transition-all

                        duration-300

                        hover:scale-[1.02]

                        hover:bg-white/90

                        active:scale-[.98]

                        sm:h-12

                        sm:px-6

                        sm:text-[13px]

                      "

                    >

                      <Play className="h-4 w-4 fill-current" />

                      Regarder

                    </button>



                    <button
                      type="button"
                      onClick={() => router.push(activeSlide.link)}
                      aria-label="Ajouter à ma liste"
                      className="
                        inline-flex
                        h-11
                        w-11
                        items-center
                        justify-center
                        rounded-full
                        border
                        border-white/15
                        bg-white/15
                        text-white
                        backdrop-blur-xl
                        transition-all
                        duration-300
                        hover:scale-105
                        hover:bg-white/25
                        sm:h-12
                        sm:w-12
                      "
                    >
                      <Plus className="h-6 w-6" />
                    </button>



                    <button

                      type="button"

                      onClick={() => router.push(activeSlide.link)}

                      className="

                        inline-flex

                        h-11

                        items-center

                        gap-2

                        rounded-[14px]

                        px-3

                        text-[11px]

                        font-medium

                        text-white/50

                        transition-colors

                        hover:text-white

                      "

                    >

                      <Info className="h-4 w-4" />

                      Plus d&apos;infos

                    </button>

                  </div>

                </motion.div>

              </AnimatePresence>

            </div>



            {heroSlides.length > 1 && (

              <div

                className="

                  absolute

                  bottom-[118px]

                  right-4

                  z-20

                  hidden

                  items-center

                  gap-2

                  sm:flex

                  sm:right-7

                  lg:bottom-[145px]

                  lg:right-12

                "

              >

                {heroSlides.map((slide, index) => {

                  const active = index === currentSlide;



                  return (

                    <button

                      key={`${slide.type}-${slide.id}`}

                      type="button"

                      aria-label={`Afficher ${slide.title}`}

                      onClick={() => setCurrentSlide(index)}

                      className={cn(

                        "h-[3px] rounded-full transition-all duration-500",

                        active

                          ? "w-9 bg-[#d8ccff] shadow-[0_0_9px_rgba(216,204,255,.6)]"

                          : "w-4 bg-white/20 hover:bg-white/40"

                      )}

                    />

                  );

                })}

              </div>

            )}

          </>

        ) : null}

      </section>



      {/* ===================================================

          CONTENT

      =================================================== */}



      <div

        className="

          relative

          z-[100]

          isolate

          -mt-[92px]

          space-y-9

          px-4

          sm:px-7

          lg:-mt-[112px]

          lg:px-12

          xl:px-14

        "

      >

        {/* =================================================
            CONTINUER À REGARDER — PREMIUM
        ================================================= */}

        {(continueMovies.length > 0 || continueSeries.length > 0) && (
          <section className="relative overflow-hidden rounded-[26px] border border-white/[0.07] bg-[#0b0b12]/90 p-4 shadow-[0_28px_90px_rgba(0,0,0,.34)] backdrop-blur-2xl sm:p-5 lg:p-6">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(163,116,255,.10),transparent_30%),radial-gradient(circle_at_80%_100%,rgba(103,73,255,.06),transparent_28%)]" />

            <div className="relative mb-5 flex items-center justify-between">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[0.28em] text-[#c8b6ff]/55">
                  Votre sélection
                </p>
                <h2 className="mt-1 text-[20px] font-semibold tracking-[-0.025em] text-white sm:text-[23px]">
                  Continuer à regarder
                </h2>
              </div>
            </div>

            <div className="relative grid gap-6 xl:grid-cols-2 xl:gap-8">
              {continueMovies.length > 0 && (
                <div className="min-w-0">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="grid h-7 w-7 place-items-center rounded-[9px] border border-[#b79cff]/20 bg-[#b79cff]/10">
                      <Play className="h-3.5 w-3.5 fill-[#cdbdff] text-[#cdbdff]" />
                    </div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#cdbdff]">Films</p>
                    <span className="text-[10px] text-white/30">· {continueMovies.length} en cours</span>
                  </div>

                  <ContinueDragRow>
                    {continueMovies.map((item) => (
                      <ContinueCard key={`home-movie-${item.id}`} item={item} />
                    ))}
                  </ContinueDragRow>
                </div>
              )}

              {continueSeries.length > 0 && (
                <div className="min-w-0 xl:border-l xl:border-white/[0.07] xl:pl-8">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="grid h-7 w-7 place-items-center rounded-[9px] border border-[#b79cff]/20 bg-[#b79cff]/10">
                      <Clock3 className="h-3.5 w-3.5 text-[#cdbdff]" />
                    </div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#cdbdff]">Séries</p>
                    <span className="text-[10px] text-white/30">· {continueSeries.length} en cours</span>
                  </div>

                  <ContinueDragRow>
                    {continueSeries.map((item) => (
                      <ContinueCard
                        key={`home-series-${item.seriesId || item.id}-${item.id}`}
                        item={item}
                      />
                    ))}
                  </ContinueDragRow>
                </div>
              )}
            </div>
          </section>
        )}

        {/* =================================================

            TRENDING

        ================================================= */}



        {trendingMovies.length > 0 && (

          <RailSection

            title="Tendances"

            href="/movies"

          >

            {trendingMovies.map((movie) => (

              <MediaCard

                key={`trend-${movie.stream_id}`}

                id={movie.stream_id}

                type="movie"

                title={movie.name}

                image={movie.stream_icon}

                rating={ratingNum(movie.rating)}

                year={

                  yearFrom(

                    movie.releaseDate || movie.releasedate,

                    movie.name

                  ) || null

                }

              />

            ))}

          </RailSection>

        )}



        {/* =================================================

            NEW MOVIES

        ================================================= */}



        {newestMovies.length > 0 && (

          <RailSection

            title="Nouveautés"

            href="/movies"

          >

            {newestMovies.map((movie) => (

              <MediaCard

                key={`new-${movie.stream_id}`}

                id={movie.stream_id}

                type="movie"

                title={movie.name}

                image={movie.stream_icon}

                rating={ratingNum(movie.rating)}

                year={

                  yearFrom(

                    movie.releaseDate || movie.releasedate,

                    movie.name

                  ) || null

                }

              />

            ))}

          </RailSection>

        )}



        {/* =================================================

            SERIES

        ================================================= */}



        {discoveryMovies.length > 0 && (
          <RailSection
            title="Films à découvrir"
            href="/movies"
          >
            {discoveryMovies.map((movie) => (
              <MediaCard
                key={`discover-movie-${movie.stream_id}`}
                id={movie.stream_id}
                type="movie"
                title={movie.name}
                image={movie.stream_icon}
                rating={ratingNum(movie.rating)}
                year={
                  yearFrom(
                    movie.releaseDate || movie.releasedate,
                    movie.name
                  ) || null
                }
              />
            ))}
          </RailSection>
        )}

        {discoverySeries.length > 0 && (
          <RailSection
            title="Séries à découvrir"
            href="/series"
          >
            {discoverySeries.map((item) => (
              <MediaCard
                key={`series-${item.series_id}`}
                id={item.series_id}
                type="series"
                title={item.name}
                image={item.cover || item.backdrop_path?.[0]}
                rating={ratingNum(item.rating)}
                year={
                  yearFrom(
                    item.releaseDate || item.releasedate,
                    item.name
                  ) || null
                }
              />
            ))}
          </RailSection>
        )}



        {/* =================================================

            FAVORITES

        ================================================= */}



        {favoriteItems.length > 0 && (

          <RailSection

            title="Ma liste"

            href="/favorites"

          >

            {favoriteItems.map((fav: any) => (

              <MediaCard

                key={`fav-${fav.type || "movie"}-${fav.id}`}

                id={fav.id}

                type={

                  fav.type === "series"

                    ? "series"

                    : "movie"

                }

                title={fav.name || fav.title || "Contenu"}

                image={fav.poster || fav.image || fav.cover}

                rating={

                  typeof fav.rating !== "undefined"

                    ? ratingNum(fav.rating)

                    : undefined

                }

                year={fav.year || null}

              />

            ))}

          </RailSection>

        )}



        {/* =================================================

            FOOT SPACER

        ================================================= */}



        <div className="h-4" />

      </div>

    </main>

  );

}
