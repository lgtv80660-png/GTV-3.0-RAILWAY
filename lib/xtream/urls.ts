export interface XtreamCredentials {
  baseUrl?: string;
  host?: string;
  serverUrl?: string;
  username: string;
  password: string;
}

/**
 * Nettoie et formate l'URL de base du serveur Xtream
 */
export function getCleanBaseUrl(
  creds: Partial<XtreamCredentials>
): string {
  const rawBaseUrl =
    creds.baseUrl ||
    creds.host ||
    creds.serverUrl ||
    "";

  return rawBaseUrl.replace(/\/+$/, "");
}

/**
 * Construit l'URL directe Live / Movie / Series
 */
export function buildStreamUrl(
  creds: Partial<XtreamCredentials>,
  type: "live" | "movie" | "series" | string,
  id: string | number,
  ext: string = "ts"
): string {
  const baseUrl =
    getCleanBaseUrl(creds);

  const username =
    creds.username || "";

  const password =
    creds.password || "";

  return `${baseUrl}/${type}/${username}/${password}/${id}.${ext}`;
}

/**
 * Construit player_api.php
 */
export function buildPlayerApiUrl(
  creds: Partial<XtreamCredentials>,
  action?: string,
  params: Record<
    string,
    string | number
  > = {}
): string {
  const baseUrl =
    getCleanBaseUrl(creds);

  const username =
    creds.username || "";

  const password =
    creds.password || "";

  const url =
    new URL(
      `${baseUrl}/player_api.php`
    );

  url.searchParams.set(
    "username",
    username
  );

  url.searchParams.set(
    "password",
    password
  );

  if (action) {
    url.searchParams.set(
      "action",
      action
    );
  }

  Object.entries(params).forEach(
    ([key, value]) => {
      if (
        value !== undefined &&
        value !== null
      ) {
        url.searchParams.set(
          key,
          String(value)
        );
      }
    }
  );

  return url.toString();
}

export function buildMovieInfoUrl(
  creds: Partial<XtreamCredentials>,
  vodId: string | number
): string {
  return buildPlayerApiUrl(
    creds,
    "get_vod_info",
    { vod_id: vodId }
  );
}

export function buildSeriesInfoUrl(
  creds: Partial<XtreamCredentials>,
  seriesId: string | number
): string {
  return buildPlayerApiUrl(
    creds,
    "get_series_info",
    { series_id: seriesId }
  );
}

export function buildEpgUrl(
  creds: Partial<XtreamCredentials>,
  streamId: string | number,
  limit: number = 10
): string {
  return buildPlayerApiUrl(
    creds,
    "get_simple_data_table",
    {
      stream_id: streamId,
      limit,
    }
  );
}
