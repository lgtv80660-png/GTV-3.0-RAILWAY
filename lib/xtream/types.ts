export type StreamKind = "live" | "movie" | "series";

export interface XtreamCredentials {
  baseUrl?: string;
  url?: string;
  serverUrl?: string;
  username?: string;
  user?: string;
  password?: string;
  pass?: string;
}

export interface Category {
  category_id: string;
  category_name: string;
  parent_id?: number;
}

export type VodCategory = Category;
export type SeriesCategory = Category;
export type LiveCategory = Category;

export interface VodStream {
  stream_id: number | string;
  name?: string;
  title?: string;
  stream_icon?: string;
  cover?: string;
  container_extension?: string;
  rating?: string | number;
  year?: string | number;
  added?: string | number;
  category_id?: string;
}

export interface SeriesItem {
  series_id: number | string;
  name?: string;
  title?: string;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  rating?: string | number;
  category_id?: string;
}

export interface Episode {
  id: string | number;
  episode_num: number;
  title?: string;
  container_extension?: string;
  info?: {
    movie_image?: string;
    plot?: string;
    duration?: string;
    duration_secs?: number;
  };
}

export interface SeriesDetails {
  info?: SeriesItem;
  episodes?: Record<string, Episode[]>;
}