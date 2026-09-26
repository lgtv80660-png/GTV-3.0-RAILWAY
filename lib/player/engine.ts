export type EngineKind = "mpegts" | "hls" | "native" | "unsupported";

export interface EngineHandle {
  kind: EngineKind;
  destroy: () => void;
}

const NATIVE_OK = ["mp4", "m4v", "mov", "webm", "ogg"];
const RISKY = ["mkv", "avi", "wmv", "flv"];

export function pickEngine(url: string, ext: string, isLive: boolean): EngineKind {
  const u = url.toLowerCase();
  const e = ext.toLowerCase().replace(/^\./, "");

  if (isLive || e === "m3u8" || u.includes("ext=m3u8") || u.includes("/api/hls") || /\.m3u8(\?|$)/.test(u)) {
    return "hls";
  }

  if (e === "ts") {
    return "mpegts";
  }

  if (NATIVE_OK.includes(e) || RISKY.includes(e)) {
    return "native";
  }

  return "native";
}

export async function attach(
  video: HTMLVideoElement,
  opts: { url: string; ext: string; isLive: boolean },
): Promise<EngineHandle> {
  const kind = pickEngine(opts.url, opts.ext, opts.isLive);

  if (kind === "hls") {
    const Hls = (await import("hls.js")).default;
    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 6,
        fragLoadingMaxRetry: 8,
        fragLoadingRetryDelay: 500,
        ...(opts.isLive ? { liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 10 } : {}),
      });

      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          hls.destroy();
        }
      });

      hls.loadSource(opts.url);
      hls.attachMedia(video);
      return { kind: "hls", destroy: () => hls.destroy() };
    }

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = opts.url;
      return { kind: "native", destroy: () => void (video.src = "") };
    }

    video.src = opts.url;
    return { kind: "native", destroy: () => void (video.src = "") };
  }

  if (kind === "mpegts") {
    // @ts-ignore
    const mpegts = (await import("mpegts.js")).default;
    if (mpegts && (mpegts.getFeatureList().mseLivePlayback || mpegts.isSupported())) {
      const player = mpegts.createPlayer(
        { type: "mpegts", isLive: opts.isLive, url: opts.url },
        {
          enableStashBuffer: false,
          stashInitialSize: 128,
          lazyLoad: false,
          liveBufferLatencyChasing: opts.isLive,
          liveBufferLatencyChasingOnPaused: false,
          liveBufferLatencyMaxLatency: 3.0,
          liveBufferLatencyMinRemain: 0.5,
          autoCleanupSourceBuffer: true,
        },
      );
      player.attachMediaElement(video);
      player.load();
      return {
        kind: "mpegts",
        destroy: () => {
          try {
            player.destroy();
          } catch {}
        },
      };
    }
    video.src = opts.url;
    return { kind: "native", destroy: () => void (video.src = "") };
  }

  video.src = opts.url;
  return { kind: "native", destroy: () => void (video.src = "") };
}