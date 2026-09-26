# GTV 3.0 Railway — Performance V2

## Optimisations backend

- Cache Xtream par utilisateur/action/catégorie avec TTL adapté et déduplication des requêtes simultanées.
- Route `/api/home-feed` pour éviter d'envoyer les catalogues complets à la Home Cloudflare.
- HLS playlist simplifiée et logs verbeux supprimés.
- Segments HLS streamés directement depuis l'upstream: pas de `arrayBuffer()` complet en mémoire.
- Cache 24 h des recherches TMDB utilisées par les images de catégories, acteurs et logos de titres.
- FFmpeg reste uniquement côté Railway via le Dockerfile Alpine.

## Variables

- `XTREAM_SERVER_URL`
- `TMDB_API_KEY`
- `FANART_API_KEY`
- `RAILWAY_PUBLIC_URL`
- `FFMPEG_PATH=ffmpeg`
- variables CinePub déjà utilisées par votre route `/api/ad` si nécessaire

## Vérification

Parsing/transpilation TypeScript de tous les fichiers du projet: aucune erreur de syntaxe.
Le `npm install` complet a dépassé le délai de l'environnement, donc exécuter `npm install && npm run build` dans Railway/CI avant mise en production.
