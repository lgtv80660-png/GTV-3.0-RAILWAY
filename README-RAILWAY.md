# GTV 3.0 — Railway Backend

Backend séparé pour GTV 3.0 : Xtream, HLS, VOD, FFmpeg, football, beIN/FIFA, métadonnées et publicité.

## Déploiement Railway

Le `Dockerfile` installe FFmpeg et lance `next start` sur le port fourni par Railway.
Définir au minimum `XTREAM_SERVER_URL`. Ajouter `TMDB_API_KEY` et `FANART_API_KEY` pour les enrichissements visuels.

Le frontend Cloudflare doit définir :
`RAILWAY_BACKEND_URL=https://votre-service.up.railway.app`

## Routes de compatibilité ajoutées

- `/api/account`
- `/api/auth`
- `/api/epg`
- `/api/images`
- `/api/live`
- `/api/stream-live`
- `/api/sports/today`
- `/api/fanart/movie`

Elles complètent les routes déjà présentes et évitent les 404 provenant de composants existants.

## Commandes locales

- `npm install`
- `npm run dev`
- `npm run build`

## Passe Performance V2

Voir `PERFORMANCE-V2.md`. Les appels Xtream sont dédupliqués/cachés, `/api/home-feed` réduit le payload du frontend et les segments HLS sont relayés en streaming direct.
