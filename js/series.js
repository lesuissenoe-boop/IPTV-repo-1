// Calculs du suivi de séries : épisodes diffusés, progression, prochain épisode à voir.

export const epKey = (s, e) => `${s}-${e}`;

/** Un épisode est-il déjà diffusé ? (d'après le dernier épisode diffusé connu) */
export function isAired(meta, s, e) {
  if (!meta.last) return false;
  return s < meta.last.s || (s === meta.last.s && e <= meta.last.e);
}

/** Liste ordonnée des épisodes diffusés : [{ s, e }]. */
export function airedEpisodes(meta) {
  const out = [];
  (meta.seasons || []).forEach(({ n, count }) => {
    for (let e = 1; e <= count; e++) if (isAired(meta, n, e)) out.push({ s: n, e });
  });
  return out;
}

export function progress(entry) {
  const aired = airedEpisodes(entry);
  const seen = new Set(entry.watched || []);
  const watched = aired.filter((x) => seen.has(epKey(x.s, x.e))).length;
  return { watched, total: aired.length, pct: aired.length ? watched / aired.length : 0 };
}

/** Premier épisode diffusé et pas encore vu, après le dernier épisode vu. */
export function nextToWatch(entry) {
  const aired = airedEpisodes(entry);
  const seen = new Set(entry.watched || []);
  let lastSeen = -1;
  aired.forEach((x, i) => { if (seen.has(epKey(x.s, x.e))) lastSeen = i; });
  const after = aired.slice(lastSeen + 1).find((x) => !seen.has(epKey(x.s, x.e)));
  return after || aired.find((x) => !seen.has(epKey(x.s, x.e))) || null;
}

/** État lisible d'une série suivie. */
export function seriesState(entry) {
  const p = progress(entry);
  const next = nextToWatch(entry);
  if (next) return { kind: 'watching', next, ...p };
  if (entry.next) return { kind: 'uptodate', ...p };
  return { kind: 'finished', ...p };
}

export const epLabel = (s, e) => `S${s} · É${e}`;

export function formatDate(iso, opts = { day: 'numeric', month: 'long' }) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('fr-FR', sameYear ? opts : { ...opts, year: 'numeric' });
}
