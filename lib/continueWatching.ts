export function saveLastPlayed(item: {
  type: "movie" | "series";
  id: string | number;
  title: string;
  image?: string | null;
  seriesId?: string | number | null;
  season?: string | number | null;
  episode?: string | number | null;
  ext?: string | null;
  position?: number;
  duration?: number;
}) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(
    "gtv_last_played",
    JSON.stringify({
      ...item,
      updatedAt: Date.now(),
    })
  );

  window.dispatchEvent(
    new Event("gtv-continue-updated")
  );
}