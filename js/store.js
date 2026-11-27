// Stockage local (sur l'appareil) : réglages, watchlist, chaînes favorites.
const PREFIX = 'ecran.';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée) : on continue sans */
  }
}

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(what) {
  listeners.forEach((fn) => fn(what));
}

export const settings = {
  get apiKey() { return read('apiKey', ''); },
  set apiKey(v) { write('apiKey', v.trim()); emit('settings'); },
  get region() { return read('region', 'FR'); },
  set region(v) { write('region', v); emit('settings'); },
  // Plateformes auxquelles l'utilisateur est abonné (identifiants TMDB).
  get subscriptions() { return read('subscriptions', []); },
  set subscriptions(v) { write('subscriptions', v); emit('settings'); },
};

// ---- Suivi des séries ------------------------------------------------------
// Une entrée par série suivie :
// { id, title, poster, backdrop, seasons: [{ n, count }], last: { s, e } | null,
//   next: { s, e, date } | null, status, watched: ['1-1', '1-2', …], updatedAt }
export const tracking = {
  all() {
    return read('tracking', {});
  },
  get(id) {
    return this.all()[id] || null;
  },
  save(entry) {
    const all = this.all();
    all[entry.id] = { ...entry, updatedAt: Date.now() };
    write('tracking', all);
    emit('tracking');
  },
  remove(id) {
    const all = this.all();
    delete all[id];
    write('tracking', all);
    emit('tracking');
  },
  /** Met à jour les infos de diffusion (sans toucher aux épisodes vus ni à la date d'activité). */
  refreshMeta(meta) {
    const all = this.all();
    const cur = all[meta.id];
    if (!cur) return;
    all[meta.id] = { ...cur, ...meta, watched: cur.watched, updatedAt: cur.updatedAt };
    write('tracking', all);
  },
  /** Coche / décoche des épisodes. Crée le suivi si besoin. */
  setWatched(meta, keys, watched) {
    const cur = this.get(meta.id) || { ...meta, watched: [] };
    const set = new Set(cur.watched);
    keys.forEach((k) => (watched ? set.add(k) : set.delete(k)));
    this.save({ ...cur, ...meta, watched: [...set] });
  },
};

// ---- Watchlist -------------------------------------------------------------
const itemKey = (type, id) => `${type}:${id}`;

export const watchlist = {
  all() {
    return read('watchlist', []);
  },
  has(type, id) {
    return this.all().some((i) => itemKey(i.type, i.id) === itemKey(type, id));
  },
  get(type, id) {
    return this.all().find((i) => itemKey(i.type, i.id) === itemKey(type, id));
  },
  add(item) {
    if (this.has(item.type, item.id)) return;
    const { id, type, title, year, poster, backdrop } = item;
    write('watchlist', [{ id, type, title, year, poster, backdrop, watched: false, addedAt: Date.now() }, ...this.all()]);
    emit('watchlist');
  },
  remove(type, id) {
    write('watchlist', this.all().filter((i) => itemKey(i.type, i.id) !== itemKey(type, id)));
    emit('watchlist');
  },
  toggle(item) {
    if (this.has(item.type, item.id)) { this.remove(item.type, item.id); return false; }
    this.add(item);
    return true;
  },
  setWatched(type, id, watched) {
    write('watchlist', this.all().map((i) => (itemKey(i.type, i.id) === itemKey(type, id) ? { ...i, watched } : i)));
    emit('watchlist');
  },
};

// ---- TV en direct ----------------------------------------------------------
export const DEFAULT_PLAYLISTS = [
  { id: 'fr', name: 'France', url: 'https://iptv-org.github.io/iptv/countries/fr.m3u', builtin: true },
  { id: 'fr-lang', name: 'Chaînes en français (monde)', url: 'https://iptv-org.github.io/iptv/languages/fra.m3u', builtin: true },
  { id: 'news', name: 'Info (monde)', url: 'https://iptv-org.github.io/iptv/categories/news.m3u', builtin: true },
  { id: 'all', name: 'Monde entier', url: 'https://iptv-org.github.io/iptv/index.m3u', builtin: true },
];

export const live = {
  playlists() {
    return [...DEFAULT_PLAYLISTS, ...read('playlists', [])];
  },
  addPlaylist(pl) {
    const custom = read('playlists', []);
    const entry = { id: 'c' + Date.now(), ...pl };
    write('playlists', [...custom, entry]);
    return entry;
  },
  removePlaylist(id) {
    write('playlists', read('playlists', []).filter((p) => p.id !== id));
    try { localStorage.removeItem(PREFIX + 'plcontent.' + id); } catch { /* ignore */ }
    if (this.activeId === id) this.activeId = 'fr';
  },
  // Les listes importées depuis un fichier sont stockées telles quelles.
  saveContent(id, text) { write('plcontent.' + id, text); },
  content(id) { return read('plcontent.' + id, null); },
  get activeId() { return read('activePlaylist', 'fr'); },
  set activeId(v) { write('activePlaylist', v); },
  favorites() { return read('liveFav', []); },
  isFavorite(url) { return this.favorites().includes(url); },
  toggleFavorite(url) {
    const favs = this.favorites();
    const next = favs.includes(url) ? favs.filter((u) => u !== url) : [...favs, url];
    write('liveFav', next);
    return next.includes(url);
  },
  get lastChannel() { return read('lastChannel', null); },
  set lastChannel(url) { write('lastChannel', url); },
};

export function resetAll() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
  emit('settings');
  emit('watchlist');
}

// ---- Sauvegarde / restauration ---------------------------------------------
// Le code contient tout ce qui est enregistré (sauf le contenu des listes TV importées depuis un fichier).
const BACKUP_PREFIX = 'ECRAN1:';

export function exportData() {
  const data = {};
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX) && !k.startsWith(PREFIX + 'plcontent.') && k !== PREFIX + 'lastBackup')
      .forEach((k) => { data[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k)); });
  } catch { /* stockage indisponible */ }
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, date: new Date().toISOString(), data }));
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  write('lastBackup', Date.now());
  return BACKUP_PREFIX + btoa(bin);
}

/** Lit un code de sauvegarde sans rien modifier. Lève une erreur si le code est invalide. */
export function readBackup(code) {
  const clean = String(code || '').replace(/\s+/g, '');
  if (!clean.startsWith(BACKUP_PREFIX)) throw new Error('FORMAT');
  const bin = atob(clean.slice(BACKUP_PREFIX.length));
  const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed.data !== 'object') throw new Error('FORMAT');
  return parsed;
}

export function importData(code) {
  const parsed = readBackup(code);
  Object.entries(parsed.data).forEach(([k, v]) => write(k, v));
  emit('settings');
  emit('watchlist');
  emit('tracking');
  return parsed;
}

export function lastBackup() {
  return read('lastBackup', null);
}
