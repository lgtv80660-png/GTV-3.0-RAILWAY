import { requireSession } from "@/lib/session";
import { buildStreamUrl } from "@/lib/xtream/urls";
import { spawn } from "child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let sessionData: any;
  try {
    sessionData = await requireSession();
  } catch {
    return new Response("Non authentifié", { status: 401 });
  }

  const creds = sessionData?.user || sessionData;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "movie";
  const id = searchParams.get("id");
  const ext = searchParams.get("ext") || "mkv";

  if (!id) return new Response("ID manquant", { status: 400 });

  const upstreamUrl = buildStreamUrl(creds, type, id, ext);

  // Commande FFmpeg optimisée pour corriger le son (AC3/DTS -> AAC Stereo)
  const ffmpeg = spawn("ffmpeg", [
    "-headers", "User-Agent: VLC/3.0.20 LibVLC/3.0.20\r\n",
    "-i", upstreamUrl,
    "-map", "0:v:0",          // Prendre la première piste vidéo
    "-map", "0:a:0?",         // Prendre la première piste audio si elle existe
    "-c:v", "copy",           // Copier la vidéo sans réencodage (0% CPU)
    "-c:a", "aac",            // Convertir le son en AAC (support universel web)
    "-ac", "2",               // Forcer la sortie en Stereo (2 canaux) pour éviter les problèmes 5.1/7.1
    "-b:a", "128k",           // Débit audio optimal
    "-movflags", "frag_keyframe+empty_moov+default_base_moof",
    "-f", "mp4",
    "pipe:1"
  ]);

  const stream = new ReadableStream({
    start(controller) {
      ffmpeg.stdout.on("data", (chunk) => controller.enqueue(chunk));
      ffmpeg.stdout.on("end", () => controller.close());
      ffmpeg.stderr.on("data", () => {});
      ffmpeg.on("error", (err) => controller.error(err));
    },
    cancel() {
      ffmpeg.kill("SIGKILL");
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "video/mp4",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}