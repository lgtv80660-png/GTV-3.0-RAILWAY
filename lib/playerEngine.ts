export type EngineKind = "hls" | "native";

export interface EngineHandle {
  kind: EngineKind;
  destroy: () => void;
}

export async function attach(
  video: HTMLVideoElement,
  opts: { url: string; ext: string; isLive: boolean }
): Promise<EngineHandle> {
  const Hls = (await import("hls.js")).default;

  // Support HLS (Chrome, Firefox, Edge, webOS, etc.)
  if (Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
      maxBufferLength: 30,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: 10,
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      }
    });

    hls.loadSource(opts.url);
    hls.attachMedia(video);
    video.play().catch(() => {});

    return {
      kind: "hls",
      destroy: () => hls.destroy(),
    };
  }

  // Fallback Safari / iOS (HLS Natif)
  video.src = opts.url;
  video.load();
  video.play().catch(() => {});

  return {
    kind: "native",
    destroy: () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}