// Accès au catalogue TMDB (The Movie Database) : films, séries et plateformes de diffusion.
import { settings } from './store.js?v=5';

const BASE = 'https://api.themoviedb.org/3';

export const img = (path, size = 'w500') => (path ? `https://image.tmdb.org/t/p/${size}${path}` : '');

// Plateformes mises en avant. Les identifiants sont ceux de TMDB / JustWatch.
// `search` construit un lien de recherche sur le site (qui ouvre l'appli sur iPhone quand elle est installée).
export const PROVIDERS = [
  { id: 8, name: 'Netflix', color: '#e50914', search: (q) => `https://www.netflix.com/search?q=${q}` },
  { id: 119, name: 'Prime Video', color: '#1a98ff', search: (q) => `https://www.primevideo.com/search/ref=atv_nb_sug?phrase=${q}` },
  { id: 337, name: 'Disney+', color: '#113ccf', search: (q) => `https://www.disneyplus.com/search?q=${q}` },
  { id: 350, name: 'Apple TV+', color: '#555555', search: (q) => `https://tv.apple.com/search?term=${q}` },
  { id: 381, name: 'Canal+', color: '#222222' },
  { id: 1899, name: 'Max', color: '#002be7' },
  { id: 531, name: 'Paramount+', color: '#0064ff' },
];
const PROVIDER_ALIASES = { 9: 119, 10: 119, 2: 350, 1796: 8 }; // variantes (Amazon, Apple iTunes, Netflix avec pub…)

/** Identifiant « principal » d'une plateforme (regroupe les variantes). */
export const mainProviderId = (id) => PROVIDER_ALIASES[id] || id;

/** Vrai si l'utilisateur est abonné à cette plateforme. */
export function isSubscribed(providerId, subs = settings.subscriptions) {
  return subs.includes(mainProviderId(providerId));
}

export function providerLink(providerId, title, fallback) {
  const p = PROVIDERS.find((x) => x.id === (PROVIDER_ALIASES[providerId] || providerId));
  return p?.search ? p.search(encodeURIComponent(title)) : fallback;
}

export class TmdbError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const cache = new Map();

export async function api(path, params = {}) {
  const key = settings.apiKey;
  if (!key) throw new TmdbError('NO_KEY', 'Clé TMDB manquante');

  const url = new URL(BASE + path);
  const all = { language: 'fr-FR', ...params };
  Object.entries(all).forEach(([k, v]) => v !== undefined && v !== '' && url.searchParams.set(k, v));

  const headers = { accept: 'application/json' };
  // Deux formats de clé : « jeton d'accès en lecture » (long, commence par eyJ) ou « clé API » (32 caractères).
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set('api_key', key);

  const cacheKey = url.toString() + '|' + key.slice(-6);
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const promise = fetch(url, { headers })
    .then(async (res) => {
      if (res.status === 401) throw new TmdbError('BAD_KEY', 'Clé TMDB invalide');
      if (!res.ok) throw new TmdbError('HTTP', `Erreur TMDB (${res.status})`);
      return res.json();
    })
    .catch((err) => {
      cache.delete(cacheKey);
      if (err instanceof TmdbError) throw err;
      throw new TmdbError('NETWORK', 'Connexion impossible au catalogue');
    });
  cache.set(cacheKey, promise);
  return promise;
}

export function clearCache() {
  cache.clear();
}

export function normalize(r, fallbackType) {
  const type = r.media_type || fallbackType;
  return {
    id: r.id,
    type,
    title: r.title || r.name || '',
    year: (r.release_date || r.first_air_date || '').slice(0, 4),
    poster: r.poster_path,
    backdrop: r.backdrop_path,
    overview: r.overview || '',
    rating: r.vote_average || 0,
    popularity: r.popularity || 0,
    genreIds: r.genre_ids || [],
  };
}

const onlyMedia = (r) => r.media_type === 'movie' || r.media_type === 'tv';

// Fusionne deux listes en alternant (films / séries).
function interleave(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

export const tmdb = {
  async trending(page = 1) {
    const d = await api('/trending/all/week', { page });
    return d.results.filter(onlyMedia).map((r) => normalize(r));
  },

  /** type : 'movie' | 'tv' | 'all' */
  /**
   * access : undefined | 'free' (gratuit, avec ou sans pub) | 'mine' (gratuit + mes abonnements)
   */
  async discover(type, { providers = [], genre, page = 1, sort = 'popularity.desc', minVotes, access } = {}) {
    if (access === 'mine') {
      const subs = settings.subscriptions;
      if (!subs.length) return this.discover(type, { genre, page, sort, minVotes, access: 'free' });
      const [free, paid] = await Promise.all([
        this.discover(type, { genre, page, sort, minVotes, access: 'free' }),
        this.discover(type, { providers: subs, genre, page, sort, minVotes }),
      ]);
      const seen = new Set();
      const results = interleave(paid.results, free.results)
        .filter((i) => (seen.has(i.type + i.id) ? false : seen.add(i.type + i.id)));
      return { results, totalPages: Math.max(free.totalPages, paid.totalPages) };
    }
    if (type === 'all') {
      const [m, t] = await Promise.all([
        this.discover('movie', { providers, genre, page, sort, minVotes, access }),
        this.discover('tv', { providers, genre: mapGenreToTv(genre), page, sort, minVotes, access }),
      ]);
      return { results: interleave(m.results, t.results), totalPages: Math.max(m.totalPages, t.totalPages) };
    }
    const params = { page, sort_by: sort, 'vote_count.gte': minVotes, with_genres: genre };
    if (providers.length) {
      params.with_watch_providers = providers.join('|');
      params.watch_region = settings.region;
      params.with_watch_monetization_types = 'flatrate|free|ads';
    } else if (access === 'free') {
      params.with_watch_monetization_types = 'free|ads';
      params.watch_region = settings.region;
    }
    const d = await api(`/discover/${type}`, params);
    return { results: d.results.map((r) => normalize(r, type)), totalPages: d.total_pages };
  },

  async search(query, page = 1) {
    const d = await api('/search/multi', { query, page, include_adult: 'false' });
    return { results: d.results.filter(onlyMedia).map((r) => normalize(r)), totalPages: d.total_pages };
  },

  async details(type, id) {
    const d = await api(`/${type}/${id}`, {
      append_to_response: 'credits,videos,watch/providers,recommendations',
      include_video_language: 'fr,en,null',
    });
    const providers = d['watch/providers']?.results?.[settings.region] || {};
    const videos = d.videos?.results || [];
    const trailer =
      videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer' && v.iso_639_1 === 'fr') ||
      videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer') ||
      videos.find((v) => v.site === 'YouTube');
    return {
      ...normalize(d, type),
      tagline: d.tagline || '',
      genres: (d.genres || []).map((g) => g.name),
      runtime: d.runtime || d.episode_run_time?.[0] || 0,
      seasons: d.number_of_seasons || 0,
      status: d.status,
      cast: (d.credits?.cast || []).slice(0, 15).map((c) => ({ name: c.name, role: c.character, photo: c.profile_path })),
      director: (d.credits?.crew || []).find((c) => c.job === 'Director')?.name || d.created_by?.[0]?.name || '',
      trailer: trailer ? trailer.key : null,
      // Séries : infos de diffusion pour le suivi des épisodes
      tvMeta: type === 'tv' ? {
        id: d.id,
        title: d.name,
        poster: d.poster_path,
        backdrop: d.backdrop_path,
        status: d.status,
        seasons: (d.seasons || []).filter((x) => x.season_number > 0 && x.episode_count > 0)
          .map((x) => ({ n: x.season_number, count: x.episode_count, name: x.name })),
        last: d.last_episode_to_air ? { s: d.last_episode_to_air.season_number, e: d.last_episode_to_air.episode_number } : null,
        next: d.next_episode_to_air ? {
          s: d.next_episode_to_air.season_number, e: d.next_episode_to_air.episode_number, date: d.next_episode_to_air.air_date,
        } : null,
      } : null,
      watch: {
        link: providers.link || '',
        free: dedupe([...(providers.free || []), ...(providers.ads || [])]),
        flatrate: dedupe(providers.flatrate || []),
        rent: dedupe(providers.rent || []),
        buy: dedupe(providers.buy || []),
      },
      recommendations: (d.recommendations?.results || []).filter((r) => r.poster_path).map((r) => normalize(r, type)),
    };
  },

  async season(tvId, n) {
    const d = await api(`/tv/${tvId}/season/${n}`);
    return (d.episodes || []).map((e) => ({
      s: n,
      e: e.episode_number,
      name: e.name || `Épisode ${e.episode_number}`,
      overview: e.overview || '',
      still: e.still_path,
      date: e.air_date,
      runtime: e.runtime || 0,
    }));
  },

  async genres(type) {
    const d = await api(`/genre/${type}/list`);
    return d.genres;
  },

  async providerLogos() {
    const d = await api('/watch/providers/movie', { watch_region: settings.region });
    const map = {};
    d.results.forEach((p) => { map[p.provider_id] = p.logo_path; });
    return map;
  },
};

function dedupe(list) {
  const seen = new Set();
  return list
    .sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
    .filter((p) => (seen.has(p.provider_id) ? false : seen.add(p.provider_id)));
}

// Certains genres films n'existent pas tels quels pour les séries.
const MOVIE_TO_TV_GENRE = { 28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768 };
function mapGenreToTv(genre) {
  if (!genre) return genre;
  return MOVIE_TO_TV_GENRE[genre] || genre;
}

// Liste de genres unifiée pour la recherche (identifiants films).
export const GENRES = [
  { id: 28, name: 'Action' },
  { id: 35, name: 'Comédie' },
  { id: 18, name: 'Drame' },
  { id: 878, name: 'Science-fiction' },
  { id: 53, name: 'Thriller' },
  { id: 27, name: 'Horreur' },
  { id: 10749, name: 'Romance' },
  { id: 16, name: 'Animation' },
  { id: 99, name: 'Documentaire' },
  { id: 80, name: 'Crime' },
  { id: 14, name: 'Fantastique' },
  { id: 10751, name: 'Famille' },
  { id: 9648, name: 'Mystère' },
  { id: 36, name: 'Histoire' },
];
