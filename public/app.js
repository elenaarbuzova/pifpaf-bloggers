const authScreen = document.getElementById('auth-screen');
const dashScreen = document.getElementById('dash-screen');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const addForm = document.getElementById('add-form');
const feedEl = document.getElementById('feed');
const toastEl = document.getElementById('toast');

let currentUser = null;
let videos = [];
let pollTimer = null;
let viewMode = localStorage.getItem('feedView') || 'grid';
let dashSection = localStorage.getItem('dashSection') || 'reels';
let viewsByDay = [];
let chartPeriod = '7D';
let openMenuId = null;
let pendingAddId = null;
let lastStats = null;
const refreshingIds = new Set();

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(data?.error || `Ошибка ${res.status}`);
  }
  return data;
}

function showToast(message, isError = false) {
  toastEl.hidden = false;
  toastEl.textContent = message;
  toastEl.classList.toggle('is-error', isError);
  toastEl.classList.add('is-on');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove('is-on');
  }, 3200);
}

function confirmDialog({ title, message, confirmText = 'Удалить', cancelText = 'Отмена' }) {
  const modal = document.getElementById('confirm-modal');
  const titleEl = document.getElementById('confirm-title');
  const messageEl = document.getElementById('confirm-message');
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  const backdrop = modal.querySelector('[data-confirm-dismiss]');

  titleEl.textContent = title;
  messageEl.textContent = message;
  okBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;

  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  cancelBtn.focus();

  return new Promise((resolve) => {
    const cleanup = (result) => {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

function setError(el, msg) {
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
}

function formatViews(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(num);
}

function formatDate(value) {
  if (!value) return 'дата скоро';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function showAuth() {
  authScreen.classList.remove('is-hidden');
  dashScreen.classList.add('is-hidden');
  stopPolling();
}

function showDash() {
  authScreen.classList.add('is-hidden');
  dashScreen.classList.remove('is-hidden');
}

function setButtonLoading(btn, loading, idleText, loadingText = 'Секунду…') {
  btn.disabled = loading;
  btn.dataset.idle = btn.dataset.idle || idleText || btn.textContent;
  btn.textContent = loading ? loadingText : btn.dataset.idle;
}

function setAddStatus(type, text) {
  const el = document.getElementById('add-status');
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'add-status';
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.className = `add-status is-${type}`;
}

function pluralReels(n) {
  return n === 1 ? 'Reel' : 'Reels';
}

function updateHeroStats(stats) {
  const el = document.getElementById('hero-stats');
  if (!stats.total_videos) {
    el.textContent = 'Пока без Reels — добавь первый по ссылке';
    return;
  }
  const count = stats.ready_count || stats.total_videos;
  el.textContent = `${formatViews(stats.total_views)} просмотров · ${count} ${pluralReels(count)}`;
}

function closeAllMenus() {
  document.querySelectorAll('.card-menu').forEach((menu) => {
    menu.hidden = true;
  });
  document.querySelectorAll('.card-menu-btn').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.card.is-menu-open').forEach((card) => {
    card.classList.remove('is-menu-open');
  });
  openMenuId = null;
}

function checkPendingAdd() {
  if (!pendingAddId) return;
  const video = videos.find((v) => v.id === pendingAddId);
  if (!video) return;
  if (video.status === 'ready') {
    setAddStatus('success', 'Готово');
    pendingAddId = null;
    setTimeout(() => setAddStatus(null), 2800);
  } else if (video.status === 'failed') {
    setAddStatus('error', video.error_message || 'Не удалось получить данные');
    pendingAddId = null;
  }
}

function setDashSection(section) {
  dashSection = section;
  localStorage.setItem('dashSection', section);

  document.querySelectorAll('.dash-tab').forEach((tab) => {
    const active = tab.dataset.dash === section;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  const reelsPanel = document.getElementById('dash-panel-reels');
  const analyticsPanel = document.getElementById('dash-panel-analytics');
  const showReels = section === 'reels';

  reelsPanel.classList.toggle('is-hidden', !showReels);
  reelsPanel.hidden = !showReels;
  analyticsPanel.classList.toggle('is-hidden', showReels);
  analyticsPanel.hidden = showReels;

  closeAllMenus();

  if (!showReels) {
    renderChart();
    renderAnalyticsDetails();
  }
}

document.querySelectorAll('.dash-tab').forEach((tab) => {
  tab.addEventListener('click', () => setDashSection(tab.dataset.dash));
});

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    const isLogin = tab.dataset.tab === 'login';
    loginForm.classList.toggle('is-hidden', !isLogin);
    registerForm.classList.toggle('is-hidden', isLogin);
    setError(document.getElementById('login-error'), null);
    setError(document.getElementById('register-error'), null);
  });
});

document.querySelectorAll('[data-view]').forEach((chip) => {
  chip.classList.toggle('is-active', chip.dataset.view === viewMode);
  chip.addEventListener('click', () => {
    viewMode = chip.dataset.view;
    localStorage.setItem('feedView', viewMode);
    document.querySelectorAll('[data-view]').forEach((c) => {
      c.classList.toggle('is-active', c.dataset.view === viewMode);
    });
    renderFeed();
  });
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  setError(err, null);
  setButtonLoading(btn, true, 'Войти');
  try {
    const fd = new FormData(loginForm);
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password'),
      }),
    });
    currentUser = data.user;
    await enterDashboard();
  } catch (ex) {
    setError(err, ex.message);
  } finally {
    setButtonLoading(btn, false);
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('register-btn');
  const err = document.getElementById('register-error');
  setError(err, null);
  setButtonLoading(btn, true, 'Создать кабинет');
  try {
    const fd = new FormData(registerForm);
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: fd.get('username'),
        password: fd.get('password'),
        instagram_handle: fd.get('instagram_handle'),
      }),
    });
    currentUser = data.user;
    showToast('Кабинет готов — можно добавлять рилсы');
    await enterDashboard();
  } catch (ex) {
    setError(err, ex.message);
  } finally {
    setButtonLoading(btn, false);
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    /* ignore */
  }
  currentUser = null;
  videos = [];
  showAuth();
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('add-btn');
  const err = document.getElementById('add-error');
  const input = document.getElementById('reel-url');
  setError(err, null);
  setAddStatus('loading', 'Получаем данные…');
  setButtonLoading(btn, true, 'Добавить', 'Добавляем…');
  try {
    const data = await api('/api/videos', {
      method: 'POST',
      body: JSON.stringify({ instagram_url: input.value.trim() }),
    });
    pendingAddId = data.video.id;
    videos = [data.video, ...videos.filter((v) => v.id !== data.video.id)];
    input.value = '';
    renderFeed({ animateId: data.video.id });
    loadStats();
    startPolling();
  } catch (ex) {
    setAddStatus('error', ex.message);
    pendingAddId = null;
    setError(err, ex.message);
  } finally {
    setButtonLoading(btn, false);
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.card-menu-wrap')) closeAllMenus();
});

function renderSkeleton() {
  feedEl.className = 'feed feed-grid';
  feedEl.innerHTML = `
    <div class="skeleton-grid">
      ${Array.from({ length: 4 })
        .map(
          () => `
        <div class="sk-card">
          <div class="sk-cover"></div>
          <div class="sk-line"></div>
          <div class="sk-line short"></div>
        </div>`
        )
        .join('')}
    </div>`;
}

function renderEmpty() {
  feedEl.innerHTML = `
    <div class="empty">
      <h3>У тебя пока нет Reels</h3>
      <p>Добавь первый Reel по ссылке из Instagram — обложка и просмотры подтянутся сами.</p>
    </div>`;
}

function statusLabel(status) {
  if (status === 'processing') return 'собирается';
  if (status === 'failed') return 'ошибка';
  return 'готово';
}

function getCardStatus(video) {
  if (refreshingIds.has(video.id) && video.status === 'processing') {
    return { label: 'обновляется', className: 'processing' };
  }
  return { label: statusLabel(video.status), className: video.status };
}

function cardHtml(video, { isNew = false } = {}) {
  const cover = video.cover_url
    ? `<img src="${escapeAttr(video.cover_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : '';
  const status = getCardStatus(video);
  return `
    <article class="card${video.status === 'processing' ? ' is-processing' : ''}${isNew ? ' is-new' : ''}" data-id="${video.id}">
      <a class="card-cover" href="${escapeAttr(video.instagram_url)}" target="_blank" rel="noopener">
        ${cover}
        <span class="status-pill ${status.className}">${status.label}</span>
      </a>
      <div class="card-body">
        <div class="card-row">
          <div class="views">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" stroke-width="1.8"/>
              <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
            </svg>
            <span class="views-value">${video.status === 'ready' ? formatViews(video.views_count) : '—'}</span>
          </div>
          <div class="card-menu-wrap">
            <button type="button" class="card-menu-btn" aria-label="Действия" aria-expanded="false">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="3" cy="8" r="1.6" fill="currentColor"/>
                <circle cx="8" cy="8" r="1.6" fill="currentColor"/>
                <circle cx="13" cy="8" r="1.6" fill="currentColor"/>
              </svg>
            </button>
            <div class="card-menu" hidden>
              <a class="card-menu-item" href="${escapeAttr(video.instagram_url)}" target="_blank" rel="noopener">Открыть в Instagram</a>
              <button type="button" class="card-menu-item" data-action="refresh">Обновить</button>
              <button type="button" class="card-menu-item danger" data-action="delete">Удалить</button>
            </div>
          </div>
        </div>
        <div class="meta">${formatDate(video.publish_date || video.created_at)} · Instagram</div>
        ${
          video.status === 'failed' && video.error_message
            ? `<div class="meta meta-error">${escapeHtml(video.error_message)}</div>`
            : ''
        }
      </div>
    </article>`;
}

function patchCard(card, video) {
  if (video.status !== 'processing') refreshingIds.delete(video.id);

  card.classList.toggle('is-processing', video.status === 'processing');

  const pill = card.querySelector('.status-pill');
  const status = getCardStatus(video);
  if (pill.textContent !== status.label || !pill.classList.contains(status.className)) {
    pill.className = `status-pill ${status.className}`;
    pill.textContent = status.label;
  }

  const cover = card.querySelector('.card-cover');
  const pillEl = cover.querySelector('.status-pill');
  let img = cover.querySelector('img');
  if (video.cover_url) {
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      cover.insertBefore(img, pillEl);
    }
    if (img.getAttribute('src') !== video.cover_url) {
      img.setAttribute('src', video.cover_url);
    }
  } else if (img) {
    img.remove();
  }

  const viewsValue = card.querySelector('.views-value');
  const viewsText = video.status === 'ready' ? formatViews(video.views_count) : '—';
  if (viewsValue && viewsValue.textContent !== viewsText) {
    viewsValue.textContent = viewsText;
  }

  const meta = card.querySelector('.card-body > .meta:not(.meta-error)');
  const metaText = `${formatDate(video.publish_date || video.created_at)} · Instagram`;
  if (meta && meta.textContent !== metaText) {
    meta.textContent = metaText;
  }

  let errEl = card.querySelector('.meta-error');
  if (video.status === 'failed' && video.error_message) {
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'meta meta-error';
      card.querySelector('.card-body').appendChild(errEl);
    }
    if (errEl.textContent !== video.error_message) {
      errEl.textContent = video.error_message;
    }
  } else if (errEl) {
    errEl.remove();
  }
}

function renderFeed({ animateId = null } = {}) {
  feedEl.className = `feed feed-${viewMode}`;

  if (!videos.length) {
    closeAllMenus();
    renderEmpty();
    return;
  }

  const empty = feedEl.querySelector('.empty, .skeleton-grid');
  if (empty) feedEl.innerHTML = '';

  const keepMenu = openMenuId;
  videos.forEach((video) => {
    let card = feedEl.querySelector(`.card[data-id="${video.id}"]`);
    if (!card) {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(video, { isNew: animateId === video.id });
      card = tmp.firstElementChild;
      feedEl.appendChild(card);
      if (animateId === video.id) {
        setTimeout(() => card.classList.remove('is-new'), 400);
      }
    } else {
      patchCard(card, video);
      feedEl.appendChild(card);
    }
  });

  feedEl.querySelectorAll('.card').forEach((card) => {
    if (!videos.some((v) => v.id === card.dataset.id)) {
      card.remove();
    }
  });

  if (keepMenu) {
    const card = feedEl.querySelector(`.card[data-id="${keepMenu}"]`);
    const menu = card?.querySelector('.card-menu');
    const menuBtn = card?.querySelector('.card-menu-btn');
    if (menu && menuBtn) {
      menu.hidden = false;
      menuBtn.setAttribute('aria-expanded', 'true');
      card.classList.add('is-menu-open');
      openMenuId = keepMenu;
    } else {
      openMenuId = null;
    }
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

feedEl.addEventListener('click', async (e) => {
  const menuBtn = e.target.closest('.card-menu-btn');
  if (menuBtn) {
    e.stopPropagation();
    const card = menuBtn.closest('.card');
    const id = card?.dataset.id;
    const menu = card?.querySelector('.card-menu');
    if (!id || !menu) return;
    if (openMenuId === id) {
      closeAllMenus();
      return;
    }
    closeAllMenus();
    menu.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    card.classList.add('is-menu-open');
    openMenuId = id;
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  e.stopPropagation();
  closeAllMenus();
  const card = btn.closest('.card');
  const id = card?.dataset.id;
  if (!id) return;

  if (btn.dataset.action === 'delete') {
    const ok = await confirmDialog({
      title: 'Удалить Reel из ленты?',
      message: 'Reel исчезнет из ленты. Это действие нельзя отменить.',
      confirmText: 'Удалить',
      cancelText: 'Отмена',
    });
    if (!ok) return;
    btn.disabled = true;
    try {
      await api(`/api/videos/${id}`, { method: 'DELETE' });
      videos = videos.filter((v) => v.id !== id);
      if (pendingAddId === id) pendingAddId = null;
      renderFeed();
      loadStats();
      showToast('Удалили из ленты');
    } catch (ex) {
      showToast(ex.message, true);
      btn.disabled = false;
    }
    return;
  }

  if (btn.dataset.action === 'refresh') {
    closeAllMenus();
    refreshingIds.add(id);
    videos = videos.map((v) =>
      v.id === id ? { ...v, status: 'processing', error_message: null } : v
    );
    renderFeed();

    try {
      const data = await api(`/api/videos/${id}/refresh`, {
        method: 'POST',
        body: '{}',
      });
      videos = videos.map((v) => (v.id === id ? data.video : v));
      renderFeed();
      loadStats();
      startPolling();
    } catch (ex) {
      refreshingIds.delete(id);
      showToast(ex.message, true);
      renderFeed();
    }
  }
});

async function loadStats() {
  try {
    const stats = await api('/api/videos/stats');
    lastStats = stats;
    updateHeroStats(stats);

    viewsByDay = stats.views_by_day || [];
    renderChart();
    renderAnalyticsDetails();
  } catch {
    document.getElementById('hero-stats').textContent = '—';
  }
}

function renderAnalyticsStatsBody(stats) {
  if (!stats?.total_videos) {
    return `
      <p class="analytics-empty">Пока нет данных для аналитики.</p>
      <p class="analytics-empty-sub">Добавь Reel — здесь появятся просмотры и сводка.</p>`;
  }

  const processing = videos.filter((v) => v.status === 'processing').length;
  const failed = videos.filter((v) => v.status === 'failed').length;

  return `
    <div class="analytics-detail-meta analytics-stats-meta">
      ${processing ? `<span class="is-processing">${processing} собирается</span>` : ''}
      ${failed ? `<span class="is-failed">${failed} с ошибкой</span>` : ''}
      ${!processing && !failed ? '<span class="is-ok">Все Reels обработаны</span>' : ''}
    </div>
    <div class="analytics-stats-grid">
      <div class="analytics-stat-card">
        <span class="analytics-detail-label">Всего просмотров</span>
        <strong>${formatViews(stats.total_views)}</strong>
      </div>
      <div class="analytics-stat-card">
        <span class="analytics-detail-label">Средние просмотры</span>
        <strong>${formatViews(stats.avg_views)}</strong>
      </div>
      <div class="analytics-stat-card">
        <span class="analytics-detail-label">${periodViewsLabel(chartPeriod)}</span>
        <strong>${formatViews(sumViewsForPeriod(viewsByDay, chartPeriod))}</strong>
      </div>
      <div class="analytics-stat-card">
        <span class="analytics-detail-label">Reels в ленте</span>
        <strong>${stats.total_videos}</strong>
      </div>
    </div>`;
}

function renderAnalyticsDetails() {
  const statsEl = document.getElementById('analytics-stats');
  if (!statsEl) return;
  statsEl.innerHTML = renderAnalyticsStatsBody(lastStats);
}

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function periodLength(period) {
  if (period === '30D') return 30;
  if (period === '90D') return 90;
  return 7;
}

function periodViewsLabel(period) {
  if (period === '30D') return 'За 30 дней';
  if (period === '90D') return 'За 90 дней';
  return 'За 7 дней';
}

function sumViewsForPeriod(days, period) {
  return buildChartSeries(days, period).reduce((sum, p) => sum + p.views, 0);
}

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildChartSeries(days, period) {
  const count = periodLength(period);
  const map = new Map(days.map((d) => [d.date, Number(d.views) || 0]));
  const series = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = toDateKey(d);
    series.push({
      date: key,
      views: map.get(key) || 0,
      weekday: WEEKDAYS[d.getDay()],
      dayNum: d.getDate(),
      month: d.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', ''),
    });
  }
  return series;
}

function niceMax(value) {
  if (value <= 0) return 4;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const n = value / base;
  if (n <= 1) return base;
  if (n <= 2) return 2 * base;
  if (n <= 5) return 5 * base;
  return 10 * base;
}

function buildYTicks(maxVal, steps = 4) {
  const step = maxVal / steps;
  return Array.from({ length: steps + 1 }, (_, i) => Math.round(step * i));
}

function axisLabelIndices(count, period) {
  const maxLabels = period === '7D' ? 7 : period === '30D' ? 6 : 5;
  if (count <= maxLabels) {
    return Array.from({ length: count }, (_, i) => i);
  }
  const indices = [0];
  const step = (count - 1) / (maxLabels - 1);
  for (let i = 1; i < maxLabels - 1; i += 1) {
    indices.push(Math.round(i * step));
  }
  indices.push(count - 1);
  return [...new Set(indices)].sort((a, b) => a - b);
}

function formatAxisDate(p, period) {
  if (period === '7D') return p.weekday;
  return `${p.dayNum} ${p.month}`;
}

function formatAxisValue(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 10_000) return `${Math.round(num / 1000)}K`;
  if (num >= 1_000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(num);
}

function smoothLinePath(points, floorY) {
  if (!points.length) return '';
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  }

  const atFloor = (y) => floorY != null && Math.abs(y - floorY) < 0.5;

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    if (atFloor(p1.y) || atFloor(p2.y)) {
      const cp1x = p1.x + (p2.x - p1.x) / 3;
      const cp2x = p1.x + (2 * (p2.x - p1.x)) / 3;
      d += ` C ${cp1x.toFixed(2)} ${p1.y.toFixed(2)}, ${cp2x.toFixed(2)} ${p2.y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    } else {
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
    }
  }
  return d;
}

function renderChart() {
  const container = document.getElementById('views-chart');
  if (!container) return;

  const series = buildChartSeries(viewsByDay, chartPeriod);
  const count = series.length;
  const hasViews = series.some((p) => p.views > 0);
  const rawMax = hasViews ? Math.max(...series.map((p) => p.views)) : 0;
  const maxVal = niceMax(rawMax);

  const W = 900;
  const H = 252;
  const pad = { top: 18, right: 20, bottom: 36, left: 52 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const baseY = pad.top + chartH;

  const coords = series.map((p, i) => {
    const x = pad.left + (i / Math.max(count - 1, 1)) * chartW;
    const y = hasViews
      ? baseY - (p.views / maxVal) * chartH
      : baseY;
    return { ...p, x, y, idx: i };
  });

  const yTicks = buildYTicks(maxVal);
  const yGrid = yTicks
    .map((val) => {
      const y = baseY - (val / maxVal) * chartH;
      return `
        <line class="chart-grid-line" x1="${pad.left}" y1="${y.toFixed(2)}" x2="${W - pad.right}" y2="${y.toFixed(2)}" />
        <text class="chart-y-label" x="${pad.left - 10}" y="${(y + 4).toFixed(2)}" text-anchor="end">${formatAxisValue(val)}</text>`;
    })
    .join('');

  const labelIdx = axisLabelIndices(count, chartPeriod);
  const xLabels = labelIdx
    .map((i) => {
      const p = coords[i];
      return `<text class="chart-axis-label" x="${p.x.toFixed(2)}" y="${H - 10}" text-anchor="middle">${formatAxisDate(p, chartPeriod)}</text>`;
    })
    .join('');

  const xTicks = labelIdx
    .map((i) => {
      const p = coords[i];
      return `<line class="chart-x-tick" x1="${p.x.toFixed(2)}" y1="${baseY}" x2="${p.x.toFixed(2)}" y2="${baseY + 5}" />`;
    })
    .join('');

  const lineD = smoothLinePath(coords, baseY);
  const areaD = lineD
    ? `${lineD} L ${coords[coords.length - 1].x.toFixed(2)} ${baseY} L ${coords[0].x.toFixed(2)} ${baseY} Z`
    : '';

  const dots = coords
    .map(
      (p) =>
        `<circle class="chart-dot-hit" data-idx="${p.idx}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="14" fill="transparent" />
        <circle class="chart-dot" data-idx="${p.idx}" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="4.5" tabindex="-1" />`
    )
    .join('');

  container.innerHTML = `
    <div class="chart-tooltip" id="chart-tooltip" aria-hidden="true">
      <span class="chart-tooltip-label">Просмотры</span>
      <span class="chart-tooltip-value"></span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="График просмотров">
      <defs>
        <linearGradient id="chart-area-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3b5eff" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#3b5eff" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${yGrid}
      <line class="chart-base-line" x1="${pad.left}" y1="${baseY}" x2="${W - pad.right}" y2="${baseY}" />
      ${xTicks}
      ${areaD ? `<path class="chart-area" d="${areaD}" />` : ''}
      ${lineD ? `<path class="chart-line" d="${lineD}" />` : ''}
      ${dots}
      ${xLabels}
    </svg>`;

  const tooltip = container.querySelector('#chart-tooltip');
  const tooltipValue = tooltip.querySelector('.chart-tooltip-value');
  const dotEls = container.querySelectorAll('.chart-dot');
  const hitEls = container.querySelectorAll('.chart-dot-hit');
  const svg = container.querySelector('svg');

  function showTip(idx) {
    const p = coords[idx];
    if (!p) return;
    dotEls.forEach((d) => d.classList.toggle('is-active', Number(d.dataset.idx) === idx));
    tooltipValue.textContent = `${formatViews(p.views)} · ${p.weekday}, ${p.dayNum} ${p.month}`;
    tooltip.classList.add('is-on');
    tooltip.setAttribute('aria-hidden', 'false');
    const rect = container.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const scaleX = svgRect.width / W;
    const scaleY = svgRect.height / H;
    tooltip.style.left = `${svgRect.left - rect.left + p.x * scaleX}px`;
    tooltip.style.top = `${svgRect.top - rect.top + p.y * scaleY - 12}px`;
  }

  function hideTip() {
    dotEls.forEach((d) => d.classList.remove('is-active'));
    tooltip.classList.remove('is-on');
    tooltip.setAttribute('aria-hidden', 'true');
  }

  hitEls.forEach((hit) => {
    hit.addEventListener('mouseenter', () => showTip(Number(hit.dataset.idx)));
  });

  svg.addEventListener('mousemove', (e) => {
    const svgRect = svg.getBoundingClientRect();
    const relX = ((e.clientX - svgRect.left) / svgRect.width) * W;
    let nearest = 0;
    let minDist = Infinity;
    coords.forEach((p, i) => {
      const dist = Math.abs(p.x - relX);
      if (dist < minDist) {
        minDist = dist;
        nearest = i;
      }
    });
    showTip(nearest);
  });

  svg.addEventListener('mouseleave', hideTip);
}

document.querySelectorAll('.period-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    chartPeriod = btn.dataset.period;
    document.querySelectorAll('.period-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.period === chartPeriod);
    });
    renderChart();
    renderAnalyticsDetails();
  });
});

async function loadVideos({ skeleton = false } = {}) {
  if (skeleton) renderSkeleton();
  try {
    const data = await api('/api/videos');
    videos = data.videos || [];
    renderFeed();
    if (videos.some((v) => v.status === 'processing')) startPolling();
    else stopPolling();
    checkPendingAdd();
  } catch (ex) {
    showToast(ex.message, true);
    renderEmpty();
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const prev = videos;
      const data = await api('/api/videos');
      videos = data.videos || [];

      const finished = videos.some((v) => {
        const old = prev.find((p) => p.id === v.id);
        return old?.status === 'processing' && v.status !== 'processing';
      });

      renderFeed();
      checkPendingAdd();

      if (finished) {
        loadStats();
      }

      if (!videos.some((v) => v.status === 'processing')) stopPolling();
    } catch {
      /* keep quiet while polling */
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function enterDashboard() {
  showDash();
  setDashSection(dashSection);
  const handle = currentUser.instagram_handle
    ? `@${currentUser.instagram_handle.replace(/^@/, '')}`
    : `@${currentUser.username}`;
  document.getElementById('greeting').textContent = `Привет, ${handle}!`;
  setAddStatus(null);
  await Promise.all([loadVideos({ skeleton: true }), loadStats()]);
}

async function boot() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user;
    await enterDashboard();
  } catch {
    showAuth();
  }
}

boot();
