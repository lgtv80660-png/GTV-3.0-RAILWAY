import { cookies } from "next/headers";
import { XtreamCredentials } from "./xtream/types";

export async function requireSession(): Promise<XtreamCredentials> {
  const cookieStore =
    await cookies();

  const sessionCookie =
    cookieStore.get(
      "gtv_session"
    )?.value;

  if (!sessionCookie) {
    throw new Error(
      "Session non trouvée. Veuillez vous connecter."
    );
  }

  try {
    const parsed =
      JSON.parse(
        sessionCookie
      );

    const serverUrl =
      parsed?.serverUrl ||
      process.env
        .XTREAM_SERVER_URL;

    const username =
      parsed?.username;

    const password =
      parsed?.password;

    if (
      !serverUrl ||
      !username ||
      !password
    ) {
      throw new Error(
        "Session Xtream incomplète"
      );
    }

    return {
      serverUrl:
        String(
          serverUrl
        ).replace(
          /\/+$/,
          ""
        ),
      username:
        String(
          username
        ),
      password:
        String(
          password
        ),
    };
  } catch {
    throw new Error(
      "Session non trouvée. Veuillez vous connecter."
    );
  }
}
