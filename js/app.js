// Point d'entrée : navigation par onglets et écrans Accueil / Recherche / Fiche / Ma liste / Réglages.
import { settings, watchlist, tracking, onChange, live, resetAll } from './store.js?v=4';
import { tmdb, img, PROVIDERS, GENRES, providerLink, isSubscribed, TmdbError, clearCache } from './tmdb.js?v=4';
import { epKey, isAired, progress, nextToWatch, seriesState, epLabel, formatDate } from './series.js?v=4';
import { icons, esc, toast, openSheet, closeAllSheets, onVisible, haptic } from './ui.js?v=4';
import { renderLive } from './live.js?v=4';

const view = document.getElementById('view');
const navbar = document.getElementById('navbar');
const navTitle = document.getElementById('navTitle');
let cleanup = null;
let providerLogos = {};

// Icônes de la barre d'onglets
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icons[el.dataset.icon]; });
document.getElementById('settingsBtn').innerHTML = icons.gear;
document.getElementById('settingsBtn').addEventListener('click', openSettings);

const setTitle = (t) => { navTitle.textContent = t; };

// La barre du haut devient floutée et affiche un petit titre quand on défile (comme iOS).
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 44);
}, { passive: true });

// ---- Navigation ------------------------------------------------------------
const routes = {
  accueil: renderHome,
  recherche: renderSearch,
  direct: (v) => renderLive(v, setTitle),
  liste: renderWatchlist,
};

function route() {
  const [, tab = 'accueil', ...rest] = (location.hash || '#/accueil').split('/');
  const render = routes[tab] || routes.accueil;
  closeAllSheets();
  if (cleanup) { cleanup(); cleanup = null; }
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === (routes[tab] ? tab : 'accueil')));
  window.scrollTo(0, 0);
  navbar.classList.remove('scrolled');
  view.innerHTML = '';
  cleanup = render(view, rest) || null;
}
window.addEventListener('hashchange', route);

// Un 2e appui sur l'onglet actif remonte en haut de la page.
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', (e) => {
  if (t.classList.contains('active')) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
}));

// ---- Composants ------------------------------------------------------------
const typeLabel = (t) => (t === 'tv' ? 'Série' : 'Film');

function posterCard(item, { wide = false, sub = '', focus = '' } = {}) {
  const pic = wide ? img(item.backdrop, 'w780') : img(item.poster, 'w342');
  const inList = watchlist.has(item.type, item.id);
  return `<button class="card ${wide ? 'card-wide' : ''}" data-type="${item.type}" data-id="${item.id}" ${focus ? `data-focus="${focus}"` : ''} aria-label="${esc(item.title)}">
    <div class="card-img">${pic ? `<img src="${pic}" alt="" loading="lazy">` : `<div class="card-ph">${icons.film}<span>${esc(item.title)}</span></div>`}
      ${inList ? `<span class="card-badge">${icons.check}</span>` : ''}
      ${wide ? `<span class="card-wide-title">${esc(item.title)}</span>` : ''}
    </div>
    ${wide ? '' : `<div class="card-title">${esc(item.title)}</div><div class="card-sub">${sub ? esc(sub) : typeLabel(item.type) + (item.year ? ' · ' + item.year : '')}</div>`}
  </button>`;
}

function skeletonRow(n = 6, wide = false) {
  return Array.from({ length: n }, () => `<div class="card ${wide ? 'card-wide' : ''} skeleton"><div class="card-img"></div>${wide ? '' : '<div class="sk-line"></div><div class="sk-line short"></div>'}</div>`).join('');
}

// Ouvre la fiche quand on touche une affiche, n'importe où dans l'appli.
document.addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-id]');
  if (!card) return;
  haptic();
  openDetail(card.dataset.type, +card.dataset.id, { focus: card.dataset.focus });
});

function errorBox(err) {
  if (err instanceof TmdbError && (err.code === 'NO_KEY' || err.code === 'BAD_KEY')) return onboarding(err.code === 'BAD_KEY');
  return `<div class="empty"><div class="empty-icon">${icons.film}</div><h3>Catalogue indisponible</h3>
    <p>${esc(err.message || 'Une erreur est survenue.')}</p><button class="btn" onclick="location.reload()">Réessayer</button></div>`;
}

function onboarding(bad = false) {
  return `<div class="onboarding">
    <div class="onb-glow"></div>
    <div class="onb-icon">${icons.sparkles}</div>
    <h2>${bad ? 'Clé TMDB invalide' : 'Bienvenue sur Écran'}</h2>
    <p>${bad ? 'La clé enregistrée n’est pas acceptée par TMDB. Vérifiez-la dans les réglages.' :
      'Pour afficher le catalogue de Netflix, Prime Video, Disney+ et des autres plateformes, ajoutez votre clé TMDB gratuite.'}</p>
    <ol class="onb-steps">
      <li><span>Créez un compte gratuit sur <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener">themoviedb.org</a></span></li>
      <li><span>Ouvrez <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Paramètres → API</a> et demandez une clé (usage personnel)</span></li>
      <li><span>Copiez le « Jeton d’accès en lecture » et collez-le ici</span></li>
    </ol>
    <button class="btn primary" data-open-settings>${icons.key} Ajouter ma clé</button>
    <p class="muted small">La TV en direct fonctionne déjà sans clé.</p>
  </div>`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-open-settings]')) openSettings();
});

// ---- Accueil ---------------------------------------------------------------
function renderHome(v) {
  setTitle('Accueil');
  if (!settings.apiKey) {
    v.innerHTML = `<section class="page"><h1 class="large-title">Accueil</h1>${onboarding()}</section>`;
    return;
  }

  const subs = settings.subscriptions;
  const orderedProviders = [...PROVIDERS.filter((p) => subs.includes(p.id)), ...PROVIDERS.filter((p) => !subs.includes(p.id))];
  const rows = [
    { title: 'À regarder gratuitement', badge: 'free', more: '#/recherche/free', load: () => tmdb.discover('all', { access: 'free' }).then((d) => d.results) },
    ...(subs.length ? [{ title: 'Inclus dans tes abonnements', badge: 'mine', more: '#/recherche/mine', load: () => tmdb.discover('all', { providers: subs }).then((d) => d.results) }] : []),
    { title: 'Tendances de la semaine', load: () => tmdb.trending().then((r) => r.slice(6)) },
    ...orderedProviders.map((p) => ({
      title: subs.includes(p.id) ? `Dans ton abonnement ${p.name}` : `À l’affiche sur ${p.name}`, provider: p, more: `#/recherche/p${p.id}`,
      load: () => tmdb.discover('all', { providers: [p.id] }).then((d) => d.results),
    })),
    { title: 'Films populaires', load: () => tmdb.discover('movie').then((d) => d.results) },
    { title: 'Séries populaires', load: () => tmdb.discover('tv').then((d) => d.results) },
    { title: 'Les mieux notés', wide: true, load: () => tmdb.discover('movie', { sort: 'vote_average.desc', minVotes: 3000 }).then((d) => d.results) },
    { title: 'Pour rire', load: () => tmdb.discover('all', { genre: 35 }).then((d) => d.results) },
    { title: 'Frissons garantis', load: () => tmdb.discover('movie', { genre: 53 }).then((d) => d.results) },
    { title: 'En famille', load: () => tmdb.discover('all', { genre: 10751 }).then((d) => d.results) },
  ];

  v.innerHTML = `<section class="page home">
    <div class="hero" id="hero"><div class="hero-track" id="heroTrack"><div class="hero-slide skeleton"></div></div><div class="hero-dots" id="heroDots"></div></div>
    <h1 class="large-title home-title">Accueil</h1>
    ${subs.length ? '' : `<button class="subs-cta" data-open-settings>
      ${accessBadge('mine')}<span class="subs-cta-text"><b>Tu as des abonnements ?</b><small>Netflix, Disney+, Canal+… Indique-les pour voir ce qui est inclus.</small></span>${icons.chevronRight}</button>`}
    <section class="row" id="upNextRow" hidden>
      <header class="row-head"><h2>${accessBadge('next')}À suivre</h2><a class="row-more" href="#/liste/series">Mes séries ${icons.chevronRight}</a></header>
      <div class="row-scroll"></div></section>
    ${rows.map((r, i) => `<section class="row" data-row="${i}">
      <header class="row-head"><h2>${r.provider ? providerBadge(r.provider) : r.badge ? accessBadge(r.badge) : ''}${esc(r.title)}</h2>
      ${r.more ? `<a class="row-more" href="${r.more}">Tout voir ${icons.chevronRight}</a>` : ''}</header>
      <div class="row-scroll">${skeletonRow(6, r.wide)}</div></section>`).join('')}
  </section>`;

  // Bandeau principal
  tmdb.trending().then((items) => {
    const top = items.filter((i) => i.backdrop).slice(0, 6);
    const track = v.querySelector('#heroTrack');
    if (!track) return;
    track.innerHTML = top.map((i) => `
      <button class="hero-slide card" data-type="${i.type}" data-id="${i.id}">
        <img src="${img(i.backdrop, 'w1280')}" alt="">
        <div class="hero-shade"></div>
        <div class="hero-info">
          <span class="hero-kicker">${typeLabel(i.type)} · Tendance</span>
          <h2>${esc(i.title)}</h2>
          <p>${esc(i.overview.slice(0, 140))}${i.overview.length > 140 ? '…' : ''}</p>
          <span class="hero-cta">${icons.play} Découvrir</span>
        </div>
      </button>`).join('');
    const dots = v.querySelector('#heroDots');
    dots.innerHTML = top.map((_, k) => `<i class="${k === 0 ? 'on' : ''}"></i>`).join('');
    let idx = 0;
    track.addEventListener('scroll', () => {
      idx = Math.round(track.scrollLeft / track.clientWidth);
      dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === idx));
    }, { passive: true });
    // Défilement automatique
    const timer = setInterval(() => {
      if (!track.isConnected) return clearInterval(timer);
      if (document.hidden || document.body.classList.contains('sheet-open')) return;
      idx = (idx + 1) % top.length;
      track.scrollTo({ left: idx * track.clientWidth, behavior: 'smooth' });
    }, 6000);
  }).catch((err) => { v.querySelector('.page').innerHTML = `<h1 class="large-title">Accueil</h1>${errorBox(err)}`; });

  // Les rangées se chargent quand elles approchent de l'écran.
  const stops = [];
  v.querySelectorAll('.row[data-row]').forEach((rowEl) => {
    const r = rows[+rowEl.dataset.row];
    let done = false;
    stops.push(onVisible(rowEl, () => {
      if (done) return;
      done = true;
      r.load().then((items) => {
        const list = items.filter((i) => (r.wide ? i.backdrop : i.poster));
        if (!list.length) { rowEl.remove(); return; }
        rowEl.querySelector('.row-scroll').innerHTML = list.map((i) => posterCard(i, { wide: r.wide })).join('');
      }).catch(() => rowEl.remove());
    }, '300px'));
  });
  ensureProviderLogos().then(() => v.querySelectorAll('[data-plogo]').forEach(fillLogo));

  // « À suivre » : prochains épisodes des séries en cours
  const drawUpNext = () => {
    const row = v.querySelector('#upNextRow');
    if (!row) return;
    const items = Object.values(tracking.all())
      .map((e) => ({ e, st: seriesState(e) }))
      .filter((x) => x.st.kind === 'watching')
      .sort((a, b) => b.e.updatedAt - a.e.updatedAt);
    row.hidden = !items.length;
    row.querySelector('.row-scroll').innerHTML = items.map(({ e, st }) =>
      posterCard({ id: e.id, type: 'tv', title: e.title, poster: e.poster }, { sub: epLabel(st.next.s, st.next.e), focus: 'episodes' })).join('');
  };
  drawUpNext();
  refreshTracked().then(drawUpNext);
  const off = onChange((w) => w === 'tracking' && drawUpNext());
  return () => { stops.forEach((s) => s()); off(); };
}

/** Badge carré coloré devant le titre d'une rangée. */
function accessBadge(kind) {
  const map = { free: ['#30d158', '0€'], mine: ['#0a84ff', icons.check], next: ['#bf5af2', icons.play] };
  const [color, content] = map[kind];
  return `<span class="pbadge abadge" style="--pc:${color}">${content}</span>`;
}

/** Rafraîchit en arrière-plan les infos de diffusion des séries suivies. */
let lastRefresh = 0;
function refreshTracked() {
  if (!settings.apiKey || Date.now() - lastRefresh < 10 * 60 * 1000) return Promise.resolve();
  lastRefresh = Date.now();
  const ids = Object.values(tracking.all()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20).map((e) => e.id);
  return Promise.allSettled(ids.map((id) => tmdb.details('tv', id).then((d) => tracking.refreshMeta(d.tvMeta))));
}

function providerBadge(p) {
  return `<span class="pbadge" data-plogo="${p.id}" style="--pc:${p.color}">${esc(p.name[0])}</span>`;
}
function fillLogo(el) {
  const path = providerLogos[el.dataset.plogo];
  if (path) el.innerHTML = `<img src="${img(path, 'w92')}" alt="">`;
}
async function ensureProviderLogos() {
  if (Object.keys(providerLogos).length) return providerLogos;
  try { providerLogos = await tmdb.providerLogos(); } catch { /* logos facultatifs */ }
  return providerLogos;
}

// ---- Recherche -------------------------------------------------------------
const searchState = { query: '', type: 'all', providers: [], genre: null, access: null };

function renderSearch(v, params = []) {
  setTitle('Rechercher');
  if (params[0] === 'free' || params[0] === 'mine') {
    searchState.access = params[0];
    searchState.providers = [];
    searchState.query = '';
  } else if (params[0]?.startsWith('p')) {
    searchState.providers = [+params[0].slice(1)];
    searchState.access = null;
    searchState.query = '';
  }
  const subs = settings.subscriptions;
  if (searchState.access === 'mine' && !subs.length) searchState.access = 'free';
  if (!settings.apiKey) {
    v.innerHTML = `<section class="page"><h1 class="large-title">Rechercher</h1>${onboarding()}</section>`;
    return;
  }

  v.innerHTML = `<section class="page search-page">
    <h1 class="large-title">Rechercher</h1>
    <div class="search-sticky">
      <label class="search-field big">${icons.search}
        <input id="q" type="search" placeholder="Films, séries, acteurs…" autocomplete="off" enterkeyhint="search" value="${esc(searchState.query)}">
      </label>
      <div class="segmented" id="seg">
        ${[['all', 'Tout'], ['movie', 'Films'], ['tv', 'Séries']].map(([k, l]) => `<button data-type="${k}" class="${searchState.type === k ? 'on' : ''}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="chips providers" id="provChips">
      <button class="chip pchip" data-access="free">${accessBadge('free')}Gratuit</button>
      ${subs.length ? `<button class="chip pchip" data-access="mine">${accessBadge('mine')}Je peux regarder</button>` : ''}
      ${PROVIDERS.map((p) => `<button class="chip pchip" data-p="${p.id}">${providerBadge(p)}${esc(p.name)}${subs.includes(p.id) ? ' <span class="mine-dot"></span>' : ''}</button>`).join('')}
    </div>
    <div class="chips" id="genreChips">
      ${GENRES.map((g) => `<button class="chip ${searchState.genre === g.id ? 'active' : ''}" data-g="${g.id}">${esc(g.name)}</button>`).join('')}
    </div>
    <p class="search-hint" id="hint"></p>
    <div class="grid" id="results"></div>
    <div id="sentinel"></div>
  </section>`;

  const $ = (s) => v.querySelector(s);
  const results = $('#results');
  let page = 1;
  let totalPages = 1;
  let loading = false;
  let token = 0;

  const filtersActive = () => searchState.providers.length || searchState.genre || searchState.access;
  const syncChips = () => {
    $('#provChips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('active',
      c.dataset.access ? searchState.access === c.dataset.access : searchState.providers.includes(+c.dataset.p)));
  };
  syncChips();

  const fetchPage = (p) => {
    const { query, type, providers, genre, access } = searchState;
    if (query) {
      return tmdb.search(query, p).then((d) => ({
        totalPages: d.totalPages,
        results: d.results.filter((i) => (type === 'all' || i.type === type) && (!genre || i.genreIds.includes(genre))),
      }));
    }
    return tmdb.discover(type, { providers, genre, page: p, access });
  };

  const load = async (reset) => {
    if (loading && !reset) return;
    if (reset) { page = 1; totalPages = 1; results.innerHTML = skeletonRow(12); }
    if (page > totalPages) return;
    const my = ++token;
    loading = true;
    try {
      const d = await fetchPage(page);
      if (my !== token) return;
      if (reset) results.innerHTML = '';
      totalPages = Math.min(d.totalPages, 30);
      page += 1;
      results.insertAdjacentHTML('beforeend', d.results.map((i) => posterCard(i)).join(''));
      if (reset && !d.results.length) {
        results.innerHTML = `<div class="empty"><div class="empty-icon">${icons.search}</div><h3>Aucun résultat</h3><p>Essayez un autre titre ou retirez des filtres.</p></div>`;
      }
      // Si la page n'a donné aucun résultat après filtrage, on charge la suivante.
      if (!reset && !d.results.length && page <= totalPages) { loading = false; return load(false); }
    } catch (err) {
      if (my === token) results.innerHTML = errorBox(err);
    } finally {
      if (my === token) loading = false;
    }
  };

  const updateHint = () => {
    const p = searchState.providers.map((id) => PROVIDERS.find((x) => x.id === id)?.name).filter(Boolean);
    const subNames = PROVIDERS.filter((x) => subs.includes(x.id)).map((x) => x.name);
    let hint = '';
    if (searchState.query && (p.length || searchState.access)) hint = 'Les filtres Gratuit et plateformes s’appliquent quand la recherche est vide.';
    else if (searchState.access === 'free') hint = `Gratuit en ${regionName()}, avec ou sans publicité`;
    else if (searchState.access === 'mine') hint = `Gratuit ou inclus dans ${subNames.length > 1 ? 'tes abonnements' : 'ton abonnement'} ${subNames.join(', ')}`;
    else if (!searchState.query && p.length) hint = `Disponible en streaming sur ${p.join(', ')}`;
    else if (!searchState.query && !filtersActive()) hint = 'Les plus populaires du moment';
    $('#hint').textContent = hint;
    $('#provChips').classList.toggle('dimmed', !!searchState.query);
  };

  const refresh = () => { updateHint(); load(true); };

  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { searchState.query = e.target.value.trim(); refresh(); }, 300);
  });
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#seg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    searchState.type = b.dataset.type;
    $('#seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    refresh();
  });
  $('#provChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.dataset.access) {
      searchState.access = searchState.access === b.dataset.access ? null : b.dataset.access;
      searchState.providers = [];
    } else {
      const id = +b.dataset.p;
      searchState.providers = searchState.providers.includes(id) ? searchState.providers.filter((x) => x !== id) : [...searchState.providers, id];
      searchState.access = null;
    }
    syncChips();
    haptic();
    refresh();
  });
  $('#genreChips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const id = +b.dataset.g;
    searchState.genre = searchState.genre === id ? null : id;
    $('#genreChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', +x.dataset.g === searchState.genre));
    haptic();
    refresh();
  });

  ensureProviderLogos().then(() => v.querySelectorAll('[data-plogo]').forEach(fillLogo));
  refresh();
  return onVisible($('#sentinel'), () => !loading && page > 1 && load(false));
}

// ---- Fiche détaillée -------------------------------------------------------
async function openDetail(type, id, { focus } = {}) {
  const sheet = openSheet({
    className: 'sheet-detail',
    content: `<div class="detail-loading"><div class="spinner"></div></div>`,
  });
  let d;
  try {
    d = await tmdb.details(type, id);
  } catch (err) {
    sheet.el.innerHTML = errorBox(err);
    return;
  }
  ensureProviderLogos();

  const meta = [
    typeLabel(type),
    d.year,
    type === 'movie' && d.runtime ? formatRuntime(d.runtime) : '',
    type === 'tv' && d.seasons ? `${d.seasons} saison${d.seasons > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ');

  const w = d.watch;
  const watchHref = (p) => providerLink(p.provider_id, d.title, w.link || `https://www.themoviedb.org/${type}/${id}/watch`);
  const access = accessInfo(w);

  const providerList = (label, list, { mark = false } = {}) => list.length ? `
    <div class="avail-group"><div class="avail-label">${label}</div><div class="avail-list">
      ${list.map((p) => `<a class="avail ${mark && isSubscribed(p.provider_id) ? 'mine' : ''}" href="${esc(watchHref(p))}" target="_blank" rel="noopener">
        <img src="${img(p.logo_path, 'w154')}" alt=""><span>${esc(p.provider_name)}</span>
        ${mark && isSubscribed(p.provider_id) ? `<span class="mine-tag">${icons.check}</span>` : ''}</a>`).join('')}
    </div></div>` : '';

  sheet.el.innerHTML = `
    <div class="detail-hero">
      ${d.backdrop ? `<img class="detail-backdrop" src="${img(d.backdrop, 'w1280')}" alt="">` : ''}
      <div class="detail-shade"></div>
      <div class="detail-head">
        ${d.poster ? `<img class="detail-poster" src="${img(d.poster, 'w342')}" alt="">` : ''}
        <div>
          <h2 class="detail-title">${esc(d.title)}</h2>
          ${d.tagline ? `<p class="detail-tagline">${esc(d.tagline)}</p>` : ''}
          <p class="detail-meta">${esc(meta)}${d.rating ? ` · <span class="rating">${icons.star}${d.rating.toFixed(1)}</span>` : ''}</p>
          <p class="detail-genres">${d.genres.map(esc).join(' · ')}</p>
        </div>
      </div>
    </div>
    <div class="detail-actions">
      <div class="access-pill ${access.kind}">${access.icon}<span>${esc(access.label)}</span></div>
      ${access.p ? `<a class="btn primary big ${access.kind === 'free' ? 'free' : ''}" href="${esc(watchHref(access.p))}" target="_blank" rel="noopener">${icons.play} ${esc(access.cta)}</a>`
        : `<button class="btn primary big" data-scroll-avail>${icons.eye} Où regarder</button>`}
      <div class="detail-actions-row">
        <button class="btn glass" id="listBtn"></button>
        ${d.trailer ? `<button class="btn glass" id="trailerBtn">${icons.play} Bande-annonce</button>` : ''}
      </div>
      <button class="btn glass" id="watchedBtn" hidden></button>
    </div>
    ${d.overview ? `<section class="detail-section"><p class="overview">${esc(d.overview)}</p>
      ${d.director ? `<p class="muted small">${type === 'tv' ? 'Création' : 'Réalisation'} : ${esc(d.director)}</p>` : ''}</section>` : ''}
    <section class="detail-section" id="avail">
      <h3>Disponible sur</h3>
      ${providerList('Gratuit', w.free)}${providerList('Abonnement', w.flatrate, { mark: true })}${providerList('Location', w.rent)}${providerList('Achat', w.buy)}
      ${access.kind === 'none' ? `<p class="muted">Ce titre n’est disponible sur aucune plateforme en ${regionName()} pour le moment.</p>` : ''}
      <p class="muted tiny">Disponibilités fournies par JustWatch via TMDB.</p>
    </section>
    ${d.tvMeta?.seasons.length ? '<section class="detail-section" id="episodes"></section>' : ''}
    ${d.cast.length ? `<section class="detail-section"><h3>Distribution</h3><div class="row-scroll cast">
      ${d.cast.map((c) => `<div class="person"><div class="person-img">${c.photo ? `<img src="${img(c.photo, 'w185')}" alt="" loading="lazy">` : `<span>${esc(c.name[0] || '')}</span>`}</div>
        <div class="person-name">${esc(c.name)}</div><div class="person-role">${esc(c.role || '')}</div></div>`).join('')}
    </div></section>` : ''}
    ${d.recommendations.length ? `<section class="detail-section"><h3>Vous aimerez aussi</h3><div class="row-scroll">${d.recommendations.slice(0, 15).map((i) => posterCard(i)).join('')}</div></section>` : ''}
  `;

  const listBtn = sheet.el.querySelector('#listBtn');
  const watchedBtn = sheet.el.querySelector('#watchedBtn');
  const sync = () => {
    const entry = watchlist.get(type, id);
    listBtn.innerHTML = entry ? `${icons.check} Dans ma liste` : `${icons.plus} Ma liste`;
    listBtn.classList.toggle('on', !!entry);
    watchedBtn.hidden = !entry;
    if (entry) watchedBtn.innerHTML = entry.watched ? `${icons.check} Vu` : `${icons.eye} Marquer comme vu`;
    watchedBtn.classList.toggle('on', !!entry?.watched);
  };
  sync();
  listBtn.addEventListener('click', () => {
    const added = watchlist.toggle(d);
    haptic();
    toast(added ? 'Ajouté à Ma liste' : 'Retiré de Ma liste');
    sync();
  });
  watchedBtn.addEventListener('click', () => {
    const entry = watchlist.get(type, id);
    watchlist.setWatched(type, id, !entry.watched);
    haptic();
    sync();
  });
  sheet.el.querySelector('#trailerBtn')?.addEventListener('click', () => openTrailer(d.trailer));
  sheet.el.querySelector('[data-scroll-avail]')?.addEventListener('click', () => {
    sheet.el.querySelector('#avail').scrollIntoView({ behavior: 'smooth' });
  });

  const epBox = sheet.el.querySelector('#episodes');
  if (epBox) {
    renderEpisodes(epBox, d.tvMeta);
    if (focus === 'episodes') setTimeout(() => epBox.scrollIntoView({ behavior: 'smooth', block: 'start' }), 350);
  }
}

/** Ce que l'utilisateur peut faire pour regarder : gratuit, inclus, abonnement requis, payant. */
function accessInfo(w) {
  const mine = w.flatrate.filter((p) => isSubscribed(p.provider_id));
  if (w.free.length) {
    const p = w.free[0];
    return { kind: 'free', p, icon: accessBadge('free'), label: `Gratuit sur ${p.provider_name}`, cta: `Regarder gratuitement sur ${p.provider_name}` };
  }
  if (mine.length) {
    const p = mine[0];
    return { kind: 'mine', p, icon: icons.check, label: `Inclus dans ton abonnement ${p.provider_name}`, cta: `Regarder sur ${p.provider_name}` };
  }
  if (w.flatrate.length) {
    const names = w.flatrate.slice(0, 3).map((p) => p.provider_name).join(', ');
    return { kind: 'sub', p: w.flatrate[0], icon: icons.key, label: `Abonnement requis : ${names}`, cta: `Voir sur ${w.flatrate[0].provider_name}` };
  }
  if (w.rent.length || w.buy.length) return { kind: 'paid', icon: icons.key, label: 'Payant : location ou achat uniquement' };
  return { kind: 'none', icon: icons.eye, label: `Pas disponible en streaming en ${regionName()}` };
}

// ---- Suivi des épisodes ------------------------------------------------------
function renderEpisodes(box, meta) {
  tracking.refreshMeta(meta);
  const entry = () => tracking.get(meta.id) || { ...meta, watched: [] };
  let season = nextToWatch(entry())?.s || meta.seasons[0].n;
  let episodes = [];

  box.innerHTML = `<h3>Épisodes</h3>
    <div class="track-card" id="trackCard"></div>
    <div class="chips seasons" id="seasonChips">${meta.seasons.map((x) =>
      `<button class="chip" data-s="${x.n}">Saison ${x.n}</button>`).join('')}</div>
    <div class="season-bar"><span id="seasonCount" class="muted small"></span><button class="link-btn" id="seasonAll"></button></div>
    <ul class="episodes" id="epList"></ul>`;
  const $ = (q) => box.querySelector(q);

  const drawCard = () => {
    const e = entry();
    const tracked = !!tracking.get(meta.id);
    const st = seriesState(e);
    const pct = Math.round(st.pct * 100);
    let main;
    if (!tracked) main = `<div class="tc-title">Suis ta progression</div><div class="tc-sub">Coche les épisodes que tu as vus pour retrouver le prochain à regarder.</div>`;
    else if (st.kind === 'watching') main = `<div class="tc-label">À SUIVRE</div><div class="tc-title">${epLabel(st.next.s, st.next.e)}</div>`;
    else if (st.kind === 'uptodate') main = `<div class="tc-label ok">À JOUR</div><div class="tc-title">Tu as tout vu</div>`;
    else main = `<div class="tc-label ok">TERMINÉE</div><div class="tc-title">Série terminée ✓</div>`;
    const nextAir = meta.next?.date ? `<div class="tc-air">${icons.sparkles} Nouvel épisode le ${esc(formatDate(meta.next.date))} (${epLabel(meta.next.s, meta.next.e)})</div>` : '';
    $('#trackCard').innerHTML = `
      <div class="tc-main"><div>${main}</div>
        ${tracked && st.kind === 'watching' ? `<button class="btn primary" id="markNext">${icons.check} Vu</button>` : ''}</div>
      ${tracked ? `<div class="progress"><i style="width:${pct}%"></i></div>
        <div class="tc-foot"><span>${st.watched} / ${st.total} épisodes vus</span><button class="link-btn danger" id="untrack">Ne plus suivre</button></div>` : ''}
      ${nextAir}`;
    $('#markNext')?.addEventListener('click', () => {
      const n = st.next;
      tracking.setWatched(meta, [epKey(n.s, n.e)], true);
      haptic();
      toast(`${epLabel(n.s, n.e)} marqué comme vu`);
      if (n.s !== season) { season = n.s; loadSeason(); } else drawList();
      drawCard();
    });
    $('#untrack')?.addEventListener('click', () => {
      if (!confirm('Ne plus suivre cette série ? Ta progression sera effacée.')) return;
      tracking.remove(meta.id);
      drawCard();
      drawList();
    });
  };

  const drawList = () => {
    const seen = new Set(entry().watched);
    const aired = episodes.filter((x) => isAired(meta, x.s, x.e));
    const allSeen = aired.length && aired.every((x) => seen.has(epKey(x.s, x.e)));
    const nSeen = aired.filter((x) => seen.has(epKey(x.s, x.e))).length;
    $('#seasonCount').textContent = episodes.length ? `${nSeen} / ${aired.length} vus${aired.length < episodes.length ? ` · ${episodes.length - aired.length} à venir` : ''}` : '';
    $('#seasonAll').textContent = allSeen ? 'Tout décocher' : 'Tout marquer comme vu';
    $('#seasonAll').hidden = !aired.length;
    $('#epList').innerHTML = episodes.map((x) => {
      const on = seen.has(epKey(x.s, x.e));
      const aired = isAired(meta, x.s, x.e);
      const sub = [x.date ? formatDate(x.date, { day: 'numeric', month: 'short' }) : '', x.runtime ? `${x.runtime} min` : ''].filter(Boolean).join(' · ');
      return `<li class="ep ${on ? 'seen' : ''} ${aired ? '' : 'future'}">
        <div class="ep-img">${x.still ? `<img src="${img(x.still, 'w300')}" alt="" loading="lazy">` : `<span>${x.e}</span>`}</div>
        <div class="ep-text">
          <div class="ep-title">${x.e}. ${esc(x.name)}</div>
          <div class="ep-meta">${aired ? esc(sub) : `Diffusion ${x.date ? 'le ' + esc(formatDate(x.date)) : 'à venir'}`}</div>
          ${x.overview ? `<p class="ep-overview">${esc(x.overview)}</p>` : ''}
        </div>
        <button class="ep-check" data-e="${x.e}" ${aired ? '' : 'disabled'} aria-pressed="${on}" aria-label="${on ? 'Marquer comme non vu' : 'Marquer comme vu'}">${icons.check}</button>
      </li>`;
    }).join('');
  };

  const loadSeason = async () => {
    box.querySelectorAll('#seasonChips .chip').forEach((c) => c.classList.toggle('active', +c.dataset.s === season));
    box.querySelector(`#seasonChips .chip[data-s="${season}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
    $('#epList').innerHTML = '<li class="ep-loading"><div class="spinner"></div></li>';
    const want = season;
    try {
      const list = await tmdb.season(meta.id, want);
      if (want !== season) return;
      episodes = list;
      drawList();
    } catch {
      $('#epList').innerHTML = '<li class="muted small">Impossible de charger les épisodes.</li>';
    }
  };

  $('#seasonChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    season = +c.dataset.s;
    loadSeason();
  });
  $('#epList').addEventListener('click', (e) => {
    const b = e.target.closest('.ep-check');
    if (!b || b.disabled) return;
    const key = epKey(season, +b.dataset.e);
    tracking.setWatched(meta, [key], !entry().watched.includes(key));
    haptic();
    drawList();
    drawCard();
  });
  $('#seasonAll').addEventListener('click', () => {
    const aired = episodes.filter((x) => isAired(meta, x.s, x.e)).map((x) => epKey(x.s, x.e));
    const seen = new Set(entry().watched);
    const allSeen = aired.every((k) => seen.has(k));
    tracking.setWatched(meta, aired, !allSeen);
    haptic();
    toast(allSeen ? `Saison ${season} décochée` : `Saison ${season} marquée comme vue`);
    drawList();
    drawCard();
  });

  drawCard();
  loadSeason();
}

function openTrailer(key) {
  openSheet({
    className: 'sheet-trailer',
    content: `<div class="trailer-frame"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&playsinline=1&rel=0"
      title="Bande-annonce" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`,
  });
}

function formatRuntime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}

const REGIONS = { FR: 'France', BE: 'Belgique', CH: 'Suisse', CA: 'Canada', LU: 'Luxembourg', US: 'États-Unis' };
const regionName = () => REGIONS[settings.region] || settings.region;

// ---- Ma liste --------------------------------------------------------------
let listTab = 'towatch';
function renderWatchlist(v, params = []) {
  setTitle('Ma liste');
  if (params[0] === 'series') listTab = 'series';
  const draw = () => {
    const all = watchlist.all();
    const nTo = all.filter((i) => !i.watched).length;
    const nSeen = all.length - nTo;
    const series = Object.values(tracking.all());
    const nSeries = series.filter((e) => seriesState(e).kind === 'watching').length;
    let body;
    if (listTab === 'series') body = seriesList(series);
    else {
      const items = all.filter((i) => (listTab === 'watched' ? i.watched : !i.watched));
      body = items.length ? `<div class="grid">${items.map((i) => posterCard(i)).join('')}</div>` : `
        <div class="empty"><div class="empty-icon">${icons.bookmark}</div>
        <h3>${listTab === 'watched' ? 'Rien de vu pour l’instant' : 'Ta liste est vide'}</h3>
        <p>${listTab === 'watched' ? 'Dans une fiche, appuie sur « Marquer comme vu ».' : 'Ajoute des films et des séries avec le bouton « + Ma liste ».'}</p>
        ${listTab === 'towatch' ? '<a class="btn primary" href="#/recherche">Explorer le catalogue</a>' : ''}</div>`;
    }
    v.innerHTML = `<section class="page">
      <h1 class="large-title">Ma liste</h1>
      <div class="segmented wide" id="listSeg">
        <button data-k="towatch" class="${listTab === 'towatch' ? 'on' : ''}">À voir${nTo ? ` (${nTo})` : ''}</button>
        <button data-k="series" class="${listTab === 'series' ? 'on' : ''}">Séries${nSeries ? ` (${nSeries})` : ''}</button>
        <button data-k="watched" class="${listTab === 'watched' ? 'on' : ''}">Déjà vus${nSeen ? ` (${nSeen})` : ''}</button>
      </div>
      ${body}
    </section>`;
    v.querySelector('#listSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      listTab = b.dataset.k;
      draw();
    });
  };
  draw();
  refreshTracked().then(() => v.isConnected && listTab === 'series' && draw());
  return onChange((what) => (what === 'watchlist' || what === 'tracking') && draw());
}

function seriesList(series) {
  if (!series.length) {
    return `<div class="empty"><div class="empty-icon">${icons.tv}</div><h3>Aucune série suivie</h3>
      <p>Ouvre une série et coche les épisodes que tu as vus : tu retrouveras ici le prochain à regarder.</p>
      <a class="btn primary" href="#/recherche">Trouver une série</a></div>`;
  }
  const order = { watching: 0, uptodate: 1, finished: 2 };
  const rows = series.map((e) => ({ e, st: seriesState(e) }))
    .sort((a, b) => order[a.st.kind] - order[b.st.kind] || b.e.updatedAt - a.e.updatedAt);
  const section = (kind, title) => {
    const list = rows.filter((r) => r.st.kind === kind);
    if (!list.length) return '';
    return `<div class="group-title list-group-title">${title}</div><div class="series-list">${list.map(({ e, st }) => {
      let line;
      if (st.kind === 'watching') line = `<span class="sr-next">À suivre : ${epLabel(st.next.s, st.next.e)}</span>`;
      else if (e.next?.date) line = `<span class="sr-air">Nouvel épisode le ${esc(formatDate(e.next.date))}</span>`;
      else line = '<span class="sr-done">Série terminée</span>';
      return `<button class="card series-row" data-type="tv" data-id="${e.id}" data-focus="episodes">
        <div class="sr-poster">${e.poster ? `<img src="${img(e.poster, 'w185')}" alt="" loading="lazy">` : icons.tv}</div>
        <div class="sr-text"><div class="sr-title">${esc(e.title)}</div>${line}
          <div class="progress"><i style="width:${Math.round(st.pct * 100)}%"></i></div>
          <div class="sr-count">${st.watched} / ${st.total} épisodes</div></div>
        <span class="sr-chev">${icons.chevronRight}</span>
      </button>`;
    }).join('')}</div>`;
  };
  return section('watching', 'En cours') + section('uptodate', 'À jour : en attente de nouveaux épisodes') + section('finished', 'Terminées');
}

// Met à jour les pastilles ✓ des affiches quand la liste change.
onChange((what) => {
  if (what !== 'watchlist') return;
  document.querySelectorAll('.view .card[data-id]').forEach((c) => {
    const has = watchlist.has(c.dataset.type, +c.dataset.id);
    const badge = c.querySelector('.card-badge');
    if (has && !badge) c.querySelector('.card-img')?.insertAdjacentHTML('beforeend', `<span class="card-badge">${icons.check}</span>`);
    if (!has && badge) badge.remove();
  });
});

// ---- Réglages --------------------------------------------------------------
function openSettings() {
  const customs = live.playlists().filter((p) => !p.builtin);
  let subsChanged = false;
  const keyBlock = `
      <div class="group-title">Catalogue (TMDB)</div>
      <div class="group">
        <label class="field"><span>Clé ou jeton d’accès TMDB</span>
          <input id="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Collez votre clé ici" value="${esc(settings.apiKey)}"></label>
        <div class="field-row">
          <button class="btn primary" id="saveKey">Enregistrer</button>
          <button class="btn glass" id="showKey">${icons.eye} Afficher</button>
        </div>
        <p class="muted small" id="keyStatus">Gratuite : <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org → Paramètres → API</a>. Elle reste uniquement sur cet appareil.</p>
      </div>`;
  const subsBlock = `
      <div class="group-title">Mes abonnements</div>
      <div class="group subs-group">
        ${PROVIDERS.map((p) => `<label class="switch-row">${providerBadge(p)}<span class="sw-name">${esc(p.name)}</span>
          <input type="checkbox" class="switch" data-sub="${p.id}" ${settings.subscriptions.includes(p.id) ? 'checked' : ''}></label>`).join('')}
        <p class="muted small">Coche ce que tu as : l’appli mettra en avant ce que tu peux regarder sans payer en plus. Aucun abonnement ? Laisse tout décoché, tu verras le gratuit.</p>
      </div>`;
  const sheet = openSheet({
    className: 'sheet-settings',
    onClose: () => { if (subsChanged) setTimeout(route, 0); },
    content: `
      <h2 class="sheet-title">Réglages</h2>
      ${settings.apiKey ? subsBlock + keyBlock : keyBlock + subsBlock}
      <div class="group-title">Pays</div>
      <div class="group">
        <label class="field"><span>Disponibilités des plateformes pour</span>
          <select id="region">${Object.entries(REGIONS).map(([k, n]) => `<option value="${k}" ${settings.region === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      ${customs.length ? `<div class="group-title">Mes listes TV</div><div class="group">
        ${customs.map((p) => `<div class="list-row"><span>${esc(p.name)}</span><button class="icon-btn danger" data-del="${esc(p.id)}" aria-label="Supprimer">${icons.trash}</button></div>`).join('')}
      </div>` : ''}
      <div class="group-title">Installer sur l’iPhone</div>
      <div class="group"><p class="small">Dans Safari, appuyez sur <b>Partager</b> puis <b>Sur l’écran d’accueil</b>. Écran s’ouvrira en plein écran comme une vraie app.</p></div>
      <div class="group">
        <button class="btn danger-text block" id="reset">Effacer toutes mes données</button>
      </div>
      <p class="muted tiny center">Écran ne diffuse aucun contenu des plateformes : il vous indique où regarder et ouvre l’application officielle. Ce produit utilise l’API TMDB mais n’est ni approuvé ni certifié par TMDB.</p>
    `,
  });
  const $ = (s) => sheet.el.querySelector(s);
  $('#showKey').addEventListener('click', () => {
    const i = $('#apiKey');
    i.type = i.type === 'password' ? 'text' : 'password';
  });
  $('#saveKey').addEventListener('click', async () => {
    const key = $('#apiKey').value.trim();
    const status = $('#keyStatus');
    settings.apiKey = key;
    clearCache();
    providerLogos = {};
    if (!key) { status.textContent = 'Clé supprimée.'; return; }
    status.textContent = 'Vérification…';
    try {
      await tmdb.genres('movie');
      status.innerHTML = `<span class="ok">${icons.check} Clé valide. Le catalogue est prêt !</span>`;
      toast('Clé enregistrée');
      setTimeout(() => { sheet.close(); route(); }, 700);
    } catch (err) {
      status.innerHTML = `<span class="ko">${esc(err.code === 'BAD_KEY' ? 'Clé refusée par TMDB. Vérifiez-la.' : err.message)}</span>`;
    }
  });
  sheet.el.querySelectorAll('[data-sub]').forEach((c) => c.addEventListener('change', () => {
    settings.subscriptions = [...sheet.el.querySelectorAll('[data-sub]:checked')].map((x) => +x.dataset.sub);
    subsChanged = true;
    haptic();
  }));
  ensureProviderLogos().then(() => sheet.el.querySelectorAll('[data-plogo]').forEach(fillLogo));
  $('#region').addEventListener('change', (e) => {
    settings.region = e.target.value;
    clearCache();
    providerLogos = {};
    toast(`Pays : ${regionName()}`);
  });
  sheet.el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    live.removePlaylist(b.dataset.del);
    b.closest('.list-row').remove();
    toast('Liste supprimée');
  }));
  $('#reset').addEventListener('click', () => {
    if (!confirm('Effacer la clé, la watchlist, les favoris et les listes TV ?')) return;
    resetAll();
    clearCache();
    sheet.close();
    route();
  });
}

route();
