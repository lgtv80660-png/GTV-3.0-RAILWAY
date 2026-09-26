export type CachedChannel = {
  num: number;
  name: string;
  stream_id: number;
  stream_icon: string;
  category_id: string;
};

type CacheEnvelope<T> = {
  value: T;
  expiresAt: number;
};

const memory = new Map<string, CacheEnvelope<unknown>>();
const PREFIX = "gtv:";

function now() {
  return Date.now();
}

export function readLiveCache<T>(key: string): T | null {
  const mem = memory.get(key);
  if (mem && mem.expiresAt > now()) return mem.value as T;

  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (!parsed?.expiresAt || parsed.expiresAt <= now()) {
      sessionStorage.removeItem(`${PREFIX}${key}`);
      return null;
    }

    memory.set(key, parsed as CacheEnvelope<unknown>);
    return parsed.value;
  } catch {
    return null;
  }
}

export function writeLiveCache<T>(key: string, value: T, ttlMs: number) {
  const data: CacheEnvelope<T> = {
    value,
    expiresAt: now() + ttlMs,
  };

  memory.set(key, data as CacheEnvelope<unknown>);

  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify(data));
  } catch {
    // sessionStorage plein : le cache mémoire reste actif.
  }
}

export function readAllCachedChannels(): CachedChannel[] {
  if (typeof window === "undefined") return [];

  const merged = new Map<number, CachedChannel>();

  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const storageKey = sessionStorage.key(i);
      if (!storageKey || !storageKey.startsWith(`${PREFIX}live-channels:`)) continue;

      const logicalKey = storageKey.slice(PREFIX.length);
      const list = readLiveCache<CachedChannel[]>(logicalKey) ?? [];

      for (const channel of list) {
        if (Number.isFinite(channel.stream_id)) merged.set(channel.stream_id, channel);
      }
    }
  } catch {
    return [...merged.values()];
  }

  return [...merged.values()];
}
