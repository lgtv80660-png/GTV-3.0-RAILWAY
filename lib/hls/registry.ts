type HlsSession = {
  id: string;
  targetUrl: string;
  baseUrl: string;
  lastAccessed: number; // 👈 Modifié pour suivre l'activité réelle
};

const sessions = new Map<string, HlsSession>();

// ⏳ Temps avant expiration (ex: 2 heures d'inactivité)
const SESSION_TTL = 1000 * 60 * 60 * 2; 

// 🧹 Nettoyeur automatique (tourne en tâche de fond toutes les 15 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of Array.from(sessions.entries())) {
    if (now - session.lastAccessed > SESSION_TTL) {
      sessions.delete(id); // Libère la RAM
    }
  }
}, 1000 * 60 * 15);

export function registerHlsSession(id: string, targetUrl: string): HlsSession {
  // Petite optimisation : on extrait le baseUrl rapidement
  const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf("/") + 1);
  
  const session: HlsSession = {
    id,
    targetUrl,
    baseUrl,
    lastAccessed: Date.now(),
  };
  
  sessions.set(id, session);
  return session;
}

export function getHlsSession(id: string): HlsSession | undefined {
  const session = sessions.get(id);
  
  if (session) {
    // 👈 À chaque fois que le flux demande un segment, on rafraîchit le timer !
    session.lastAccessed = Date.now();
  }
  
  return session;
}