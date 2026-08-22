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

function setButtonLoading(btn, loading, idleText) {
  btn.disabled = loading;
  btn.dataset.idle = btn.dataset.idle || idleText || btn.textContent;
  btn.textContent = loading ? 'Секунду…' : btn.dataset.idle;
}

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
  setButtonLoading(btn, true, 'Добавить');
  try {
    const data = await api('/api/videos', {
      method: 'POST',
      body: JSON.stringify({ instagram_url: input.value.trim() }),
    });
    videos = [data.video, ...videos.filter((v) => v.id !== data.video.id)];
    input.value = '';
    renderFeed();
    loadStats();
    startPolling();
    showToast('Рил в обработке — данные подтянутся сами');
  } catch (ex) {
    setError(err, ex.message);
  } finally {
    setButtonLoading(btn, false);
  }
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
      <div class="empty-icon">◎</div>
      <h3>Пока тихо</h3>
      <p>Вставь ссылку на Instagram Reel сверху — обложка и просмотры появятся здесь.</p>
    </div>`;
}

function statusLabel(status) {
  if (status === 'processing') return 'собираем…';
  if (status === 'failed') return 'ошибка';
  return 'готово';
}

function cardHtml(video) {
  const cover = video.cover_url
    ? `<img src="${escapeAttr(video.cover_url)}" alt="Обложка рила" loading="lazy" />`
    : '';
  return `
    <article class="card" data-id="${video.id}">
      <div class="card-cover">
        ${cover}
        <span class="status-pill ${video.status}">${statusLabel(video.status)}</span>
      </div>
      <div class="card-body">
        <div class="views">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" stroke-width="1.8"/>
            <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
          </svg>
          ${video.status === 'ready' ? formatViews(video.views_count) : '—'}
        </div>
        <div class="meta">${formatDate(video.publish_date || video.created_at)}</div>
        ${
          video.status === 'failed' && video.error_message
            ? `<div class="meta" style="color:var(--danger)">${escapeHtml(video.error_message)}</div>`
            : ''
        }
        <div class="card-actions">
          <a class="btn-tiny" href="${escapeAttr(video.instagram_url)}" target="_blank" rel="noopener">Открыть</a>
          <button type="button" class="btn-tiny" data-action="refresh">Обновить</button>
          <button type="button" class="btn-tiny danger" data-action="delete">Удалить</button>
        </div>
      </div>
    </article>`;
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

function renderFeed() {
  feedEl.className = `feed feed-${viewMode}`;
  if (!videos.length) {
    renderEmpty();
    return;
  }
  feedEl.innerHTML = videos.map(cardHtml).join('');
}

feedEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const card = btn.closest('.card');
  const id = card?.dataset.id;
  if (!id) return;

  if (btn.dataset.action === 'delete') {
    btn.disabled = true;
    try {
      await api(`/api/videos/${id}`, { method: 'DELETE' });
      videos = videos.filter((v) => v.id !== id);
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
    btn.disabled = true;
    btn.textContent = '…';
    try {
      const data = await api(`/api/videos/${id}/refresh`, {
        method: 'POST',
        body: '{}',
      });
      videos = videos.map((v) => (v.id === id ? data.video : v));
      renderFeed();
      startPolling();
      showToast('Обновляем метрики');
    } catch (ex) {
      showToast(ex.message, true);
      btn.disabled = false;
      btn.textContent = 'Обновить';
    }
  }
});

async function loadStats() {
  try {
    const stats = await api('/api/videos/stats');
    document.getElementById('total-views').textContent = formatViews(stats.total_views);
    document.getElementById('stat-meta').textContent =
      stats.total_videos === 0
        ? 'пока без рилсов'
        : `${stats.ready_count} из ${stats.total_videos} готовы`;
  } catch {
    document.getElementById('total-views').textContent = '—';
  }
}

async function loadVideos({ skeleton = false } = {}) {
  if (skeleton) renderSkeleton();
  try {
    const data = await api('/api/videos');
    videos = data.videos || [];
    renderFeed();
    if (videos.some((v) => v.status === 'processing')) startPolling();
    else stopPolling();
  } catch (ex) {
    showToast(ex.message, true);
    renderEmpty();
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const data = await api('/api/videos');
      videos = data.videos || [];
      renderFeed();
      loadStats();
      if (!videos.some((v) => v.status === 'processing')) stopPolling();
    } catch {
      /* keep quiet while polling */
    }
  }, 2500);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function enterDashboard() {
  showDash();
  const handle = currentUser.instagram_handle
    ? `@${currentUser.instagram_handle.replace(/^@/, '')}`
    : `@${currentUser.username}`;
  document.getElementById('greeting').textContent = `Привет, ${handle}!`;
  document.getElementById('handle-line').textContent =
    'Добавляй рилсы — просмотры и обложки подтянутся из Instagram.';
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
