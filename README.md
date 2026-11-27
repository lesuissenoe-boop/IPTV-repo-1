# Écran — films, séries et TV en direct

Application web façon Apple (iPhone d'abord) qui réunit :

- **Un catalogue global** des films et séries de Netflix, Prime Video, Disney+, Apple TV+, Canal+, Max, Paramount+… (données TMDB / JustWatch), avec la plateforme où chaque titre est disponible en France. Le bouton « Regarder » ouvre l'application officielle.
- **La recherche** par titre, type, plateforme et genre.
- **Ma liste** (watchlist) avec « À voir » / « Déjà vus ».
- **La TV en direct** : lecteur IPTV pour listes M3U (chaînes gratuites iptv-org par défaut, ou vos propres listes), favoris et zapping.

> Écran ne diffuse aucun contenu des plateformes de streaming. Utilisez uniquement des listes IPTV que vous avez le droit de regarder.

## Mise en route

1. Ouvrez l'application (par exemple via GitHub Pages).
2. Créez une clé gratuite sur [themoviedb.org → Paramètres → API](https://www.themoviedb.org/settings/api).
3. Dans l'app, ⚙️ Réglages → collez le « Jeton d'accès en lecture » → Enregistrer.
4. Sur iPhone : Safari → Partager → **Sur l'écran d'accueil** pour l'installer comme une app.

## Héberger sur GitHub Pages

Settings → Pages → Source : « Deploy from a branch » → choisir la branche et le dossier `/ (root)`.

## Lancer en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Structure

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page, barre d'onglets |
| `css/style.css` | Design (thème sombre, verre dépoli, animations) |
| `js/app.js` | Navigation, Accueil, Recherche, Fiche, Ma liste, Réglages |
| `js/tmdb.js` | Accès au catalogue TMDB |
| `js/live.js` | TV en direct : lecture M3U et lecteur HLS |
| `js/store.js` | Sauvegarde locale (clé, watchlist, favoris) |
| `js/ui.js` | Icônes, feuilles modales, notifications |

Ce produit utilise l'API TMDB mais n'est ni approuvé ni certifié par TMDB.
