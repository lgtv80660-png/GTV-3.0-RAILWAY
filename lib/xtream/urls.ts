export interface XtreamCredentials {
  baseUrl?: string;
  host?: string;
  serverUrl?: string;
  username: string;
  password: string;
}

/**
 * Nettoie et formate l'URL de base du serveur Xtream (supprime le slash final)
 */
export function getCleanBaseUrl(creds: Partial<XtreamCredentials>): string {
  const rawBaseUrl = creds.baseUrl || creds.host || creds.serverUrl || "";
  return rawBaseUrl.replace(/\/+$/, "");
}

/**
 * Construit l'URL directe pour les flux média (Live, Movie, Series)
 * Exemple : http://xtream-server.com:8080/live/username/password/123.m3u8
 */
export function buildStreamUrl(
  creds: Partial<XtreamCredentials>,
  type: "live" | "movie" | "series" | string,
  id: string | number,
  ext: string = "ts"
): string {
  const baseUrl = getCleanBaseUrl(creds);
  const username = creds.username || "";
  const password = creds.password || "";

  return `${baseUrl}/${type}/${username}/${password}/${id}.${ext}`;
}

/**
 * Construit l'URL d'API Xtream Player (player_api.php) avec actions dynamiques
 * Exemple : http://xtream-server.com:8080/player_api.php?username=...&password=...&action=get_live_categories
 */
export function buildPlayerApiUrl(
  creds: Partial<XtreamCredentials>,
  action?: string,
  params: Record<string, string | number> = {}
): string {
  const baseUrl = getCleanBaseUrl(creds);
  const username = creds.username || "";
  const password = creds.password || "";

  const url = new URL(`${baseUrl}/player_api.php`);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);

  if (action) {
    url.searchParams.set("action", action);
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

/**
 * Raccourci pour l'URL d'information d'une VOD (Movie)
 */
export function buildMovieInfoUrl(creds: Partial<XtreamCredentials>, vodId: string | number): string {
  return buildPlayerApiUrl(creds, "get_vod_info", { vod_id: vodId });
}

/**
 * Raccourci pour l'URL d'information d'une Série (Saisons / Épisodes)
 */
export function buildSeriesInfoUrl(creds: Partial<XtreamCredentials>, seriesId: string | number): string {
  return buildPlayerApiUrl(creds, "get_series_info", { series_id: seriesId });
}

/**
 * Raccourci pour l'URL EPG d'une chaîne Live
 */
export function buildEpgUrl(creds: Partial<XtreamCredentials>, streamId: string | number, limit: number = 10): string {
  return buildPlayerApiUrl(creds, "get_simple_data_table", { stream_id: streamId, limit });
}