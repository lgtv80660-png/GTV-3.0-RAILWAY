import { cookies } from "next/headers";
import { XtreamCredentials } from "./xtream/types";

// Host préinstallé
const DEFAULT_HOST = process.env.XTREAM_SERVER_URL || "https://gmztv.vercel.app";

export async function requireSession(): Promise<XtreamCredentials> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("gtv_session")?.value;

  if (sessionCookie) {
    try {
      const parsed = JSON.parse(sessionCookie);
      return {
        serverUrl: parsed.serverUrl || DEFAULT_HOST,
        username: parsed.username,
        password: parsed.password,
      };
    } catch (e) {
      // Ignorer l'erreur
    }
  }

  throw new Error("Session non trouvée. Veuillez vous connecter.");
}