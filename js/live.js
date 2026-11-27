// TV en direct : lecture des listes M3U et du lecteur vidéo (HLS).
import { live } from './store.js?v=4';
import { esc, icons, toast, onVisible, openSheet, haptic } from './ui.js?v=4';

// ---- Analyse M3U ----------------------------------------------------------
export function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attrs = {};
      line.replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k.toLowerCase()] = v; });
      const comma = line.lastIndexOf(',');
      const name = (comma >= 0 ? line.slice(comma + 1) : '').trim() || attrs['tvg-name'] || 'Sans nom';
      current = {
        name,
        logo: attrs['tvg-logo'] || '',
        group: (attrs['group-title'] || 'Autres').split(';')[0].trim() || 'Autres',
      };
    } else if (line.startsWith('#EXTGRP:') && current) {
      current.group = line.slice(8).trim() || current.group;
    } else if (!line.startsWith('#')) {
      if (current) {
        channels.push({ ...current, url: line });
        current = null;
      } else if (/^https?:\/\//.test(line)) {
        channels.push({ name: line.split('/').pop(), logo: '', group: 'Autres', url: line });
      }
    }
  }
  return channels;
}

// ---- Lecteur --------------------------------------------------------------
let hls = null;

function preferNative(video) {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.vendor || '').includes('Apple');
  return apple && video.canPlayType('application/vnd.apple.mpegurl');
}

export function stopPlayback() {
  if (hls) { hls.destroy(); hls = null; }
  const v = document.getElementById('liveVideo');
  if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
}

function play(channel, { onError } = {}) {
  const video = document.getElementById('liveVideo');
  if (!video) return;
  stopPlayback();

  const fail = (msg) => onError?.(msg);
  const insecure = channel.url.startsWith('http://') && location.protocol === 'https:';
  if (insecure) return fail('Ce flux n’est pas sécurisé (http) : il est bloqué par le navigateur.');

  if (!preferNative(video) && window.Hls && window.Hls.isSupported()) {
    hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
    hls.on(window.Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) fail('Chaîne indisponible pour le moment (hors ligne, géobloquée ou protégée).');
      else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else fail('Impossible de lire cette chaîne.');
    });
    hls.loadSource(channel.url);
    hls.attachMedia(video);
  } else {
    video.src = channel.url;
    video.onerror = () => fail('Chaîne indisponible pour le moment (hors ligne, géobloquée ou protégée).');
  }
  video.play().catch(() => { /* lecture auto refusée : l'utilisateur appuiera sur lecture */ });
}

// ---- Vue « En direct » ----------------------------------------------------
const state = {
  channels: [],
  loadedId: null,
  query: '',
  group: 'Toutes',
  onlyFav: false,
  current: null,
  filtered: [],
  hiddenInsecure: 0,
};

async function loadPlaylist(pl) {
  if (state.loadedId === pl.id && state.channels.length) return;
  let text = live.content(pl.id);
  if (!text) {
    const res = await fetch(pl.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await res.text();
  }
  let channels = parseM3U(text);
  state.hiddenInsecure = 0;
  if (location.protocol === 'https:') {
    const before = channels.length;
    channels = channels.filter((c) => !c.url.startsWith('http://'));
    state.hiddenInsecure = before - channels.length;
  }
  state.channels = channels;
  state.loadedId = pl.id;
  state.group = 'Toutes';
}

export function renderLive(view, setTitle) {
  setTitle('En direct');
  const playlists = live.playlists();
  const active = playlists.find((p) => p.id === live.activeId) || playlists[0];

  view.innerHTML = `
    <section class="page live-page">
      <h1 class="large-title">En direct</h1>
      <div class="player-card">
        <div class="player-frame">
          <video id="liveVideo" playsinline controls></video>
          <div id="liveOverlay" class="player-overlay">
            <div class="player-overlay-inner">${icons.tv}<p>Choisissez une chaîne</p></div>
          </div>
        </div>
        <div class="now-playing">
          <div class="np-logo" id="npLogo"></div>
          <div class="np-text">
            <div class="np-label">EN DIRECT</div>
            <div class="np-name" id="npName">Aucune chaîne</div>
          </div>
          <button class="round-btn" id="prevCh" aria-label="Chaîne précédente">${icons.chevronUp}</button>
          <button class="round-btn" id="nextCh" aria-label="Chaîne suivante">${icons.chevronDown}</button>
          <button class="round-btn" id="favCh" aria-label="Favori">${icons.starOutline}</button>
        </div>
      </div>

      <div class="live-controls">
        <div class="select-pill">
          <select id="plSelect" aria-label="Liste de chaînes">
            ${playlists.map((p) => `<option value="${esc(p.id)}" ${p.id === active.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
            <option value="__add">+ Ajouter une liste…</option>
          </select>
        </div>
        <label class="search-field">
          ${icons.search}
          <input id="liveSearch" type="search" placeholder="Rechercher une chaîne" autocomplete="off" value="${esc(state.query)}">
        </label>
      </div>
      <div class="chips" id="groupChips"></div>
      <p class="live-status" id="liveStatus">Chargement des chaînes…</p>
      <ul class="channel-list" id="channelList"></ul>
      <div id="chSentinel"></div>
    </section>`;

  const $ = (id) => view.querySelector('#' + id);
  const list = $('channelList');
  let shown = 0;
  const PAGE = 80;

  const statusText = () => {
    const n = state.filtered.length;
    let s = `${n.toLocaleString('fr-FR')} chaîne${n > 1 ? 's' : ''}`;
    if (state.hiddenInsecure) s += ` · ${state.hiddenInsecure} non sécurisée${state.hiddenInsecure > 1 ? 's' : ''} masquée${state.hiddenInsecure > 1 ? 's' : ''}`;
    return s;
  };

  const renderChips = () => {
    const counts = {};
    state.channels.forEach((c) => { counts[c.group] = (counts[c.group] || 0) + 1; });
    const groups = Object.keys(counts).sort((a, b) => a.localeCompare(b, 'fr'));
    const favCount = live.favorites().length;
    $('groupChips').innerHTML =
      `<button class="chip ${state.onlyFav ? 'active' : ''}" data-fav="1">${icons.star} Favoris${favCount ? ` (${favCount})` : ''}</button>` +
      ['Toutes', ...groups].map((g) => `<button class="chip ${!state.onlyFav && state.group === g ? 'active' : ''}" data-group="${esc(g)}">${esc(translateGroup(g))}</button>`).join('');
  };

  const applyFilter = () => {
    const q = normalizeText(state.query);
    const favs = new Set(live.favorites());
    state.filtered = state.channels.filter((c) =>
      (state.onlyFav ? favs.has(c.url) : state.group === 'Toutes' || c.group === state.group) &&
      (!q || normalizeText(c.name).includes(q)));
    list.innerHTML = '';
    shown = 0;
    renderMore();
    $('liveStatus').textContent = state.filtered.length ? statusText() :
      (state.onlyFav ? 'Aucun favori pour l’instant. Appuyez sur ☆ pendant la lecture.' : 'Aucune chaîne trouvée.');
  };

  const channelRow = (c, i) => `
    <li><button class="channel ${state.current?.url === c.url ? 'playing' : ''}" data-i="${i}">
      <span class="ch-logo">${c.logo ? `<img src="${esc(c.logo)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span>${esc(initials(c.name))}</span></span>
      <span class="ch-text"><span class="ch-name">${esc(c.name)}</span><span class="ch-group">${esc(translateGroup(c.group))}</span></span>
      ${live.isFavorite(c.url) ? `<span class="ch-fav">${icons.star}</span>` : ''}
      <span class="ch-live">${state.current?.url === c.url ? '<span class="eq"><i></i><i></i><i></i></span>' : ''}</span>
    </button></li>`;

  const renderMore = () => {
    if (shown >= state.filtered.length) return;
    const next = state.filtered.slice(shown, shown + PAGE);
    list.insertAdjacentHTML('beforeend', next.map((c, k) => channelRow(c, shown + k)).join(''));
    shown += next.length;
  };

  const updateNowPlaying = () => {
    const c = state.current;
    $('npName').textContent = c ? c.name : 'Aucune chaîne';
    $('npLogo').innerHTML = c?.logo ? `<img src="${esc(c.logo)}" alt="" onerror="this.remove()">` : (c ? `<span>${esc(initials(c.name))}</span>` : '');
    $('favCh').innerHTML = c && live.isFavorite(c.url) ? icons.star : icons.starOutline;
    $('favCh').classList.toggle('on', !!(c && live.isFavorite(c.url)));
    list.querySelectorAll('.channel').forEach((b) => {
      const ch = state.filtered[+b.dataset.i];
      const on = ch && c && ch.url === c.url;
      b.classList.toggle('playing', !!on);
      b.querySelector('.ch-live').innerHTML = on ? '<span class="eq"><i></i><i></i><i></i></span>' : '';
    });
  };

  const showOverlay = (msg) => {
    const o = $('liveOverlay');
    if (!o) return;
    o.hidden = !msg;
    if (msg) o.innerHTML = `<div class="player-overlay-inner error">${icons.tv}<p>${esc(msg)}</p><small>Essayez une autre chaîne.</small></div>`;
  };

  const playChannel = (c) => {
    state.current = c;
    live.lastChannel = c.url;
    showOverlay(null);
    updateNowPlaying();
    play(c, { onError: showOverlay });
  };

  const zap = (dir) => {
    if (!state.filtered.length) return;
    const idx = state.filtered.findIndex((c) => c.url === state.current?.url);
    const next = state.filtered[(idx + dir + state.filtered.length) % state.filtered.length];
    haptic();
    playChannel(next);
  };

  // Événements
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.channel');
    if (!b) return;
    playChannel(state.filtered[+b.dataset.i]);
    view.querySelector('.player-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('groupChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.fav) state.onlyFav = !state.onlyFav;
    else { state.onlyFav = false; state.group = chip.dataset.group; }
    renderChips();
    applyFilter();
  });
  let t;
  $('liveSearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.query = e.target.value; applyFilter(); }, 150);
  });
  $('prevCh').addEventListener('click', () => zap(-1));
  $('nextCh').addEventListener('click', () => zap(1));
  $('favCh').addEventListener('click', () => {
    if (!state.current) return;
    const on = live.toggleFavorite(state.current.url);
    haptic();
    toast(on ? 'Ajoutée aux favoris' : 'Retirée des favoris');
    updateNowPlaying();
    renderChips();
    if (state.onlyFav) applyFilter();
  });
  $('plSelect').addEventListener('change', (e) => {
    if (e.target.value === '__add') {
      e.target.value = live.activeId;
      openAddPlaylist(() => renderLive(view, setTitle));
      return;
    }
    live.activeId = e.target.value;
    stopPlayback();
    state.current = null;
    renderLive(view, setTitle);
  });

  const onKey = (e) => {
    if (e.target.tagName === 'INPUT' || document.body.classList.contains('sheet-open')) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); zap(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); zap(-1); }
    if (e.key.toLowerCase() === 'f') $('favCh').click();
  };
  document.addEventListener('keydown', onKey);
  const stopObserving = onVisible($('chSentinel'), renderMore);

  loadPlaylist(active)
    .then(() => {
      if (!view.isConnected) return;
      renderChips();
      applyFilter();
      const last = state.current || state.channels.find((c) => c.url === live.lastChannel);
      if (last) {
        state.current = last;
        updateNowPlaying();
        $('liveOverlay').innerHTML = `<button class="resume-btn">${icons.play}<span>Reprendre ${esc(last.name)}</span></button>`;
        $('liveOverlay').querySelector('.resume-btn').addEventListener('click', () => playChannel(last));
      }
    })
    .catch(() => {
      $('liveStatus').innerHTML = 'Impossible de charger cette liste. Vérifiez votre connexion ou l’adresse de la liste.';
    });

  // Nettoyage quand on quitte l'onglet
  return () => {
    document.removeEventListener('keydown', onKey);
    stopObserving();
    stopPlayback();
  };
}

function openAddPlaylist(done) {
  const sheet = openSheet({
    className: 'sheet-small',
    content: `
      <h2 class="sheet-title">Ajouter une liste</h2>
      <p class="muted">Collez l’adresse d’une liste M3U ou importez un fichier. N’utilisez que des listes que vous avez le droit de regarder.</p>
      <form id="plForm" class="form">
        <label class="field"><span>Nom</span><input id="plName" required placeholder="Ma liste" maxlength="40"></label>
        <label class="field"><span>Adresse (URL)</span><input id="plUrl" type="url" placeholder="https://…/liste.m3u" inputmode="url"></label>
        <div class="or">ou</div>
        <label class="file-btn"><input id="plFile" type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain"><span id="plFileLabel">Choisir un fichier…</span></label>
        <button class="btn primary block" type="submit">Ajouter</button>
      </form>`,
  });
  const form = sheet.el.querySelector('#plForm');
  const file = sheet.el.querySelector('#plFile');
  file.addEventListener('change', () => {
    sheet.el.querySelector('#plFileLabel').textContent = file.files[0]?.name || 'Choisir un fichier…';
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = sheet.el.querySelector('#plName').value.trim();
    const url = sheet.el.querySelector('#plUrl').value.trim();
    const f = file.files[0];
    if (!url && !f) { toast('Ajoutez une adresse ou un fichier'); return; }
    let text = null;
    if (f) {
      text = await f.text();
      if (!parseM3U(text).length) { toast('Ce fichier ne contient aucune chaîne'); return; }
    }
    const entry = live.addPlaylist({ name, url: url || '' });
    if (text) live.saveContent(entry.id, text);
    live.activeId = entry.id;
    sheet.close();
    toast('Liste ajoutée');
    done();
  });
}

// ---- Aides ----------------------------------------------------------------
function normalizeText(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function initials(name) {
  return name.replace(/\(.*?\)|\[.*?\]/g, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
}

const GROUP_FR = {
  Undefined: 'Autres', General: 'Généraliste', News: 'Info', Sports: 'Sport', Kids: 'Enfants', Movies: 'Films',
  Music: 'Musique', Entertainment: 'Divertissement', Documentary: 'Documentaire', Culture: 'Culture',
  Lifestyle: 'Art de vivre', Religious: 'Religion', Business: 'Économie', Education: 'Éducation',
  Comedy: 'Humour', Series: 'Séries', Travel: 'Voyage', Cooking: 'Cuisine', Shop: 'Shopping',
  Weather: 'Météo', Science: 'Sciences', Auto: 'Auto', Animation: 'Animation', Classic: 'Classiques',
  Family: 'Famille', Legislative: 'Parlement', Outdoor: 'Nature', Relax: 'Détente', Public: 'Service public',
};
function translateGroup(g) {
  return GROUP_FR[g] || g;
}
