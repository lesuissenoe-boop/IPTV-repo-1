// Point d'entrée : navigation par onglets et écrans Accueil / Recherche / Fiche / Ma liste / Réglages.
import { settings, watchlist, onChange, live, resetAll } from './store.js';
import { tmdb, img, PROVIDERS, GENRES, providerLink, TmdbError, clearCache } from './tmdb.js';
import { icons, esc, toast, openSheet, closeAllSheets, onVisible, haptic } from './ui.js';
import { renderLive } from './live.js';

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

function posterCard(item, { wide = false } = {}) {
  const pic = wide ? img(item.backdrop, 'w780') : img(item.poster, 'w342');
  const inList = watchlist.has(item.type, item.id);
  return `<button class="card ${wide ? 'card-wide' : ''}" data-type="${item.type}" data-id="${item.id}" aria-label="${esc(item.title)}">
    <div class="card-img">${pic ? `<img src="${pic}" alt="" loading="lazy">` : `<div class="card-ph">${icons.film}<span>${esc(item.title)}</span></div>`}
      ${inList ? `<span class="card-badge">${icons.check}</span>` : ''}
      ${wide ? `<span class="card-wide-title">${esc(item.title)}</span>` : ''}
    </div>
    ${wide ? '' : `<div class="card-title">${esc(item.title)}</div><div class="card-sub">${typeLabel(item.type)}${item.year ? ' · ' + item.year : ''}</div>`}
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
  openDetail(card.dataset.type, +card.dataset.id);
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

  const rows = [
    { title: 'Tendances de la semaine', load: () => tmdb.trending().then((r) => r.slice(6)) },
    ...PROVIDERS.slice(0, 6).map((p) => ({
      title: `À l’affiche sur ${p.name}`, provider: p,
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
    ${rows.map((r, i) => `<section class="row" data-row="${i}">
      <header class="row-head"><h2>${r.provider ? providerBadge(r.provider) : ''}${esc(r.title)}</h2>
      ${r.provider ? `<a class="row-more" href="#/recherche/p${r.provider.id}">Tout voir ${icons.chevronRight}</a>` : ''}</header>
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
  v.querySelectorAll('.row').forEach((rowEl) => {
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
  return () => stops.forEach((s) => s());
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
const searchState = { query: '', type: 'all', providers: [], genre: null };

function renderSearch(v, params = []) {
  setTitle('Rechercher');
  if (params[0]?.startsWith('p')) {
    searchState.providers = [+params[0].slice(1)];
    searchState.query = '';
  }
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
      ${PROVIDERS.map((p) => `<button class="chip pchip ${searchState.providers.includes(p.id) ? 'active' : ''}" data-p="${p.id}">${providerBadge(p)}${esc(p.name)}</button>`).join('')}
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

  const filtersActive = () => searchState.providers.length || searchState.genre;

  const fetchPage = (p) => {
    const { query, type, providers, genre } = searchState;
    if (query) {
      return tmdb.search(query, p).then((d) => ({
        totalPages: d.totalPages,
        results: d.results.filter((i) => (type === 'all' || i.type === type) && (!genre || i.genreIds.includes(genre))),
      }));
    }
    return tmdb.discover(type, { providers, genre, page: p });
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
    let hint = '';
    if (searchState.query && p.length) hint = 'Le filtre par plateforme s’applique quand la recherche est vide.';
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
    const id = +b.dataset.p;
    searchState.providers = searchState.providers.includes(id) ? searchState.providers.filter((x) => x !== id) : [...searchState.providers, id];
    b.classList.toggle('active');
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
async function openDetail(type, id) {
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

  const stream = d.watch.flatrate;
  const firstStream = stream[0];
  const watchHref = (p) => providerLink(p.provider_id, d.title, d.watch.link || `https://www.themoviedb.org/${type}/${id}/watch`);

  const providerList = (label, list) => list.length ? `
    <div class="avail-group"><div class="avail-label">${label}</div><div class="avail-list">
      ${list.map((p) => `<a class="avail" href="${esc(watchHref(p))}" target="_blank" rel="noopener">
        <img src="${img(p.logo_path, 'w154')}" alt=""><span>${esc(p.provider_name)}</span></a>`).join('')}
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
      ${firstStream ? `<a class="btn primary big" href="${esc(watchHref(firstStream))}" target="_blank" rel="noopener">${icons.play} Regarder sur ${esc(firstStream.provider_name)}</a>`
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
      ${providerList('Abonnement', d.watch.flatrate)}${providerList('Location', d.watch.rent)}${providerList('Achat', d.watch.buy)}
      ${!stream.length && !d.watch.rent.length && !d.watch.buy.length ? `<p class="muted">Ce titre n’est disponible sur aucune plateforme en ${regionName()} pour le moment.</p>` : ''}
      <p class="muted tiny">Disponibilités fournies par JustWatch via TMDB.</p>
    </section>
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
function renderWatchlist(v) {
  setTitle('Ma liste');
  const draw = () => {
    const all = watchlist.all();
    const items = all.filter((i) => (listTab === 'watched' ? i.watched : !i.watched));
    const nTo = all.filter((i) => !i.watched).length;
    const nSeen = all.length - nTo;
    v.innerHTML = `<section class="page">
      <h1 class="large-title">Ma liste</h1>
      <div class="segmented wide" id="listSeg">
        <button data-k="towatch" class="${listTab === 'towatch' ? 'on' : ''}">À voir${nTo ? ` (${nTo})` : ''}</button>
        <button data-k="watched" class="${listTab === 'watched' ? 'on' : ''}">Déjà vus${nSeen ? ` (${nSeen})` : ''}</button>
      </div>
      ${items.length ? `<div class="grid">${items.map((i) => posterCard(i)).join('')}</div>` : `
        <div class="empty"><div class="empty-icon">${icons.bookmark}</div>
        <h3>${listTab === 'watched' ? 'Rien de vu pour l’instant' : 'Votre liste est vide'}</h3>
        <p>${listTab === 'watched' ? 'Dans une fiche, appuyez sur « Marquer comme vu ».' : 'Ajoutez des films et des séries avec le bouton « + Ma liste ».'}</p>
        ${listTab === 'towatch' ? '<a class="btn primary" href="#/recherche">Explorer le catalogue</a>' : ''}</div>`}
    </section>`;
    v.querySelector('#listSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      listTab = b.dataset.k;
      draw();
    });
  };
  draw();
  return onChange((what) => what === 'watchlist' && draw());
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
  const sheet = openSheet({
    className: 'sheet-settings',
    content: `
      <h2 class="sheet-title">Réglages</h2>
      <div class="group-title">Catalogue (TMDB)</div>
      <div class="group">
        <label class="field"><span>Clé ou jeton d’accès TMDB</span>
          <input id="apiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Collez votre clé ici" value="${esc(settings.apiKey)}"></label>
        <div class="field-row">
          <button class="btn primary" id="saveKey">Enregistrer</button>
          <button class="btn glass" id="showKey">${icons.eye} Afficher</button>
        </div>
        <p class="muted small" id="keyStatus">Gratuite : <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">themoviedb.org → Paramètres → API</a>. Elle reste uniquement sur cet appareil.</p>
      </div>
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
