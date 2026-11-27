// Petits utilitaires d'interface : icônes, échappement HTML, notifications, feuilles modales.

const svg = (body, fill = false) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;

export const icons = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  tv: svg('<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="m8 2 4 4 4-4"/>'),
  bookmark: svg('<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1Z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: svg('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z"/>', true),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7"/>'),
  star: svg('<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z"/>', true),
  starOutline: svg('<path d="m12 2.8 2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.4 6.4-.8Z"/>'),
  film: svg('<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>'),
  chevronRight: svg('<path d="m9 5 7 7-7 7"/>'),
  chevronUp: svg('<path d="m6 15 6-6 6 6"/>'),
  chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2"/>'),
  sparkles: svg('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/>', true),
};

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function html(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? values[i] ?? '' : ''), '');
}

export function fragment(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content;
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export function haptic() {
  try { navigator.vibrate?.(8); } catch { /* ignore */ }
}

/**
 * Ouvre une feuille modale qui glisse depuis le bas (comme sur iOS).
 * Retourne { el, close }.
 */
export function openSheet({ className = '', content = '', onClose } = {}) {
  const root = document.getElementById('sheetRoot');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet ${className}" role="dialog" aria-modal="true">
    <button class="sheet-close" aria-label="Fermer">${icons.close}</button>
    <div class="sheet-body">${content}</div></div>`;
  root.appendChild(wrap);
  document.body.classList.add('sheet-open');
  requestAnimationFrame(() => wrap.classList.add('open'));

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    wrap.classList.add('closing');
    setTimeout(() => {
      wrap.remove();
      if (!root.children.length) document.body.classList.remove('sheet-open');
    }, 320);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && root.lastElementChild === wrap) close();
  };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.sheet-backdrop').addEventListener('click', close);
  wrap.querySelector('.sheet-close').addEventListener('click', close);

  // Glisser vers le bas pour fermer
  const sheet = wrap.querySelector('.sheet');
  const body = wrap.querySelector('.sheet-body');
  let startY = null;
  let dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (body.scrollTop > 0) { startY = null; return; }
    startY = e.touches[0].clientY;
    dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (startY == null) return;
    sheet.style.transform = '';
    if (dy > 120) close();
    startY = null;
  });

  return { el: wrap.querySelector('.sheet-body'), wrap, close };
}

export function closeAllSheets() {
  document.querySelectorAll('.sheet-wrap').forEach((w) => w.querySelector('.sheet-close').click());
}

/** Charge plus d'éléments quand `sentinel` devient visible. */
export function onVisible(sentinel, cb, rootMargin = '600px') {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => e.isIntersecting && cb());
  }, { rootMargin });
  io.observe(sentinel);
  return () => io.disconnect();
}
