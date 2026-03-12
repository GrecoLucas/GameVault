// ═══════════════════════════════════════════════════════════
//  GAMEVAULT — app.js
//  Main application logic
// ═══════════════════════════════════════════════════════════

// ─── CONFIG ───────────────────────────────────────────────
// Replace these with your actual Supabase credentials
const SUPABASE_URL = 'https://yxvezgpofwvpbdvsgrrx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4dmV6Z3BvZnd2cGJkdnNncnJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDY4MzEsImV4cCI6MjA4ODg4MjgzMX0.qGyfpYqYkTt3s2pMHTbA5BLmF_mE_ESPnIehJZh4YYs';

// Maps typed input to canonical username stored in DB
const USERNAME_MAP = {
  lucas:  'Lucas',
  rafael: 'Rafael',
  rafa:   'Rafael'
};

// ─── INIT SUPABASE ────────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─── APP STATE ────────────────────────────────────────────
let currentUser = null;
let currentUsername = null; // 'Lucas' or 'Rafael'
let allGames = [];
let filteredGames = [];
let allRankings = {}; // { game_key: { lucas: {...}, rafael: {...} } }
let activeCategory = 'all';
let currentView = 'grid';
let activeModal = null;
let rankingsFilter = 'all';
let loginInFlight = false;

// ─── BOOT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await checkSession();
});

async function checkSession() {
  const savedUsername = sessionStorage.getItem('gv_username');
  if (savedUsername) {
    await initApp(savedUsername);
  }
}

// ─── AUTH ─────────────────────────────────────────────────
async function handleLogin() {
  if (loginInFlight) return;

  const userInput = document.getElementById('login-user').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');

  if (!userInput || !password) {
    showLoginError('Please fill in both fields.');
    return;
  }

  const username = USERNAME_MAP[userInput];
  if (!username) {
    showLoginError('Invalid user. Use Lucas or Rafael.');
    return;
  }

  loginInFlight = true;
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'AUTHENTICATING...';
  errEl.classList.add('hidden');

  try {
    const { data, error } = await withTimeout(
      db.rpc('verify_login', { p_username: username, p_password: password }),
      15000,
      'Connection timeout. Check internet or Supabase URL/key.'
    );
    if (error) throw error;
    if (!data) throw new Error('Invalid credentials.');

    await initApp(data);
  } catch (err) {
    showLoginError(err.message || 'Authentication failed.');
  } finally {
    loginInFlight = false;
    if (!currentUsername) {
      btn.disabled = false;
      btn.querySelector('.btn-text').textContent = 'INITIATE SESSION';
    }
  }
}

// Allow Enter key on login
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.getElementById('login-page').classList.contains('active')) {
    handleLogin();
  }
});

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function handleLogout() {
  sessionStorage.removeItem('gv_username');
  currentUser = null;
  currentUsername = null;
  document.getElementById('app-page').classList.remove('active');
  document.getElementById('login-page').classList.add('active');
  
  const btn = document.getElementById('login-btn');
  if (btn) {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'INITIATE SESSION';
  }
  const pwd = document.getElementById('login-password');
  if (pwd) pwd.value = '';

  showToast('Signed out.', 'success');
}

// ─── INIT APP ─────────────────────────────────────────────
async function initApp(username) {
  currentUsername = username;
  currentUser = username; // kept for compatibility
  sessionStorage.setItem('gv_username', username);

  document.getElementById('current-user-name').textContent = currentUsername.toUpperCase();
  document.getElementById('login-page').classList.remove('active');
  document.getElementById('app-page').classList.add('active');

  // Load data
  loadGamesFromJSON();
  await loadAllRankings();
  renderDashboard();
  renderStats();
  renderRankingsTable();
}

// ─── DATA LOADING ─────────────────────────────────────────
function loadGamesFromJSON() {
  const rawGames = Array.isArray(GAMES_DATA)
    ? GAMES_DATA
    : (GAMES_DATA?.jogos || GAMES_DATA?.games || []);

  allGames = consolidateGames(rawGames.map((game, idx) => normalizeGame(game, idx)));
  filteredGames = [...allGames];
  buildCategoryFilters();
  document.getElementById('stat-total').textContent = allGames.length;
}

function normalizeGame(game, idx) {
  const mergedName = game?.nome_merge || game?.nome || game?.title || `Game ${idx + 1}`;
  const gameKey = game?.chave_nome || game?.game_key || slugify(mergedName);
  const myData = game?.meus_dados || game?.lucas_dados || game?.lucas || {};
  const rafaData = game?.rafa_dados || game?.rafael_dados || game?.rafael || {};
  const myMinutes = getMinutes(myData);
  const rafaMinutes = getMinutes(rafaData);

  return {
    nome_merge: mergedName,
    chave_nome: gameKey,
    categoria: game?.categoria || game?.categorias || game?.genres || [],
    capa_url: game?.capa_url || game?.cover_url || game?.cover || '',
    meus_dados: {
      ...myData,
      tempo_jogado: {
        minutos_totais: myMinutes,
        formatado: myData?.tempo_jogado?.formatado || formatMinutes(myMinutes)
      }
    },
    rafa_dados: {
      ...rafaData,
      tempo_jogado: {
        minutos_totais: rafaMinutes,
        formatado: rafaData?.tempo_jogado?.formatado || formatMinutes(rafaMinutes)
      }
    }
  };
}

function consolidateGames(games) {
  const byKey = new Map();

  games.forEach((g) => {
    const key = g.chave_nome;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...g,
        categoria: [...(g.categoria || [])],
        _lucasTitleIds: new Set(),
        _rafaTitleIds: new Set()
      });
    }

    const acc = byKey.get(key);
    acc.categoria = Array.from(new Set([...(acc.categoria || []), ...(g.categoria || [])]));
    if (!acc.capa_url && g.capa_url) acc.capa_url = g.capa_url;

    mergePlayerData(acc.meus_dados, g.meus_dados, acc._lucasTitleIds);
    mergePlayerData(acc.rafa_dados, g.rafa_dados, acc._rafaTitleIds);
  });

  return [...byKey.values()].map((g) => {
    delete g._lucasTitleIds;
    delete g._rafaTitleIds;
    g.meus_dados.tempo_jogado.formatado = formatMinutes(g.meus_dados.tempo_jogado.minutos_totais || 0);
    g.rafa_dados.tempo_jogado.formatado = formatMinutes(g.rafa_dados.tempo_jogado.minutos_totais || 0);
    return g;
  });
}

function mergePlayerData(target, source, titleIdsSeen) {
  if (!source) return;

  const titleId = source.title_id || source.titleId || '';
  const minutes = getMinutes(source);

  if (!target.nome && source.nome) target.nome = source.nome;
  if (!target.imagem_url && source.imagem_url) target.imagem_url = source.imagem_url;
  if (!target.plataforma && source.plataforma) target.plataforma = source.plataforma;

  if (!target.tempo_jogado) {
    target.tempo_jogado = { minutos_totais: 0, formatado: '0m' };
  }

  if (titleId) {
    if (!titleIdsSeen.has(titleId)) {
      target.tempo_jogado.minutos_totais = (target.tempo_jogado.minutos_totais || 0) + minutes;
      titleIdsSeen.add(titleId);
    }
  } else {
    target.tempo_jogado.minutos_totais = Math.max(target.tempo_jogado.minutos_totais || 0, minutes);
  }
}

function getMinutes(playerData) {
  return playerData?.tempo_jogado?.minutos_totais
    || playerData?.tempo_jogado?.minutes
    || playerData?.minutos_totais
    || playerData?.minutes
    || 0;
}

function formatMinutes(totalMinutes) {
  const mins = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return `${h}h ${m}m`;
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timeoutId)),
    timeoutPromise
  ]);
}

async function loadAllRankings() {
  try {
    const { data, error } = await db
      .from('rankings')
      .select('*');
    if (error) throw error;

    // Restructure: allRankings[game_key][username] = ranking
    allRankings = {};
    (data || []).forEach(r => {
      if (!allRankings[r.game_key]) allRankings[r.game_key] = {};
      allRankings[r.game_key][r.username] = r;
    });
  } catch (err) {
    console.warn('Could not load rankings (check Supabase config):', err.message);
    allRankings = {};
  }
}

// ─── CATEGORY FILTERS ─────────────────────────────────────
function buildCategoryFilters() {
  const cats = new Map();
  allGames.forEach(g => {
    (g.categoria || []).forEach(c => {
      cats.set(c, (cats.get(c) || 0) + 1);
    });
  });

  const sorted = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  const container = document.getElementById('category-filters');
  container.innerHTML = `<button class="cat-pill active" data-cat="all" onclick="filterCategory('all')">All Games <span style="opacity:.5;font-size:.7em;">(${allGames.length})</span></button>`;

  sorted.forEach(([cat, count]) => {
    const btn = document.createElement('button');
    btn.className = 'cat-pill';
    btn.dataset.cat = cat;
    btn.onclick = () => filterCategory(cat);
    btn.innerHTML = `${cat} <span style="opacity:.5;font-size:.7em;">(${count})</span>`;
    container.appendChild(btn);
  });
}

function filterCategory(cat) {
  activeCategory = cat;
  document.querySelectorAll('#category-filters .cat-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === cat);
  });
  applyFilters();
}

// ─── SEARCH & SORT ────────────────────────────────────────
function handleSearch() {
  applyFilters();
}

function handleSort(val) {
  applyFilters(val);
}

let currentSort = 'name';

function applyFilters(sort) {
  if (sort) currentSort = sort;
  const query = document.getElementById('search-input').value.toLowerCase().trim();

  filteredGames = allGames.filter(g => {
    const matchesCat = activeCategory === 'all' || (g.categoria || []).includes(activeCategory);
    const matchesSearch = !query || g.nome_merge.toLowerCase().includes(query);
    return matchesCat && matchesSearch;
  });

  // Sort
  filteredGames.sort((a, b) => {
    if (currentSort === 'name') return a.nome_merge.localeCompare(b.nome_merge);
    if (currentSort === 'my_time') return (b.meus_dados?.tempo_jogado?.minutos_totais || 0) - (a.meus_dados?.tempo_jogado?.minutos_totais || 0);
    if (currentSort === 'rafa_time') return (b.rafa_dados?.tempo_jogado?.minutos_totais || 0) - (a.rafa_dados?.tempo_jogado?.minutos_totais || 0);
    if (currentSort === 'total_time') {
      const bTotal = (b.meus_dados?.tempo_jogado?.minutos_totais || 0) + (b.rafa_dados?.tempo_jogado?.minutos_totais || 0);
      const aTotal = (a.meus_dados?.tempo_jogado?.minutos_totais || 0) + (a.rafa_dados?.tempo_jogado?.minutos_totais || 0);
      return bTotal - aTotal;
    }
    if (currentSort === 'rating') {
      return getCommunityScore(b) - getCommunityScore(a);
    }
    return 0;
  });

  document.getElementById('stat-showing').textContent = filteredGames.length;
  renderGameGrid();
}

// ─── COMMUNITY SCORE ──────────────────────────────────────
function getCommunityScore(game) {
  const key = game.chave_nome;
  const ratings = allRankings[key] ? Object.values(allRankings[key]) : [];
  if (!ratings.length) return -1;
  const avg = ratings.reduce((sum, r) => sum + (r.overall_rating || 0), 0) / ratings.length;
  return Math.round(avg * 10) / 10;
}

function getScoreByCategory(game, cat) {
  const key = game.chave_nome;
  const ratings = allRankings[key] ? Object.values(allRankings[key]) : [];
  if (!ratings.length) return null;
  const scores = ratings.map(r => r[`${cat}_score`]).filter(s => s != null);
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

function getUserRating(gameKey) {
  if (!currentUsername || !allRankings[gameKey]) return null;
  return allRankings[gameKey][currentUsername] || null;
}

// ─── RENDER GAME GRID ─────────────────────────────────────
function renderDashboard() {
  document.getElementById('stat-total').textContent = allGames.length;
  applyFilters();
}

function setView(v) {
  currentView = v;
  document.querySelectorAll('.view-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && v === 'grid') || (i === 1 && v === 'list'));
  });
  const grid = document.getElementById('game-grid');
  grid.classList.toggle('list-view', v === 'list');
}

function renderGameGrid() {
  const grid = document.getElementById('game-grid');
  document.getElementById('stat-showing').textContent = filteredGames.length;

  if (!filteredGames.length) {
    grid.innerHTML = `<div class="loading-state"><p style="font-size:2rem;">🎮</p><p>No games found</p></div>`;
    return;
  }

  grid.innerHTML = filteredGames.map((game, idx) => renderGameCard(game, idx)).join('');
}

function renderGameCard(game, idx) {
  const communityScore = getCommunityScore(game);
  const userRating = getUserRating(game.chave_nome);
  const myTime = game.meus_dados?.tempo_jogado?.formatado || '—';
  const rafaTime = game.rafa_dados?.tempo_jogado?.formatado || '—';
  const coverUrl = game.capa_url || game.meus_dados?.imagem_url || '';
  const cats = (game.categoria || []).slice(0, 3);
  const delay = Math.min(idx * 0.03, 0.5);

  const scoreTag = communityScore >= 0
    ? `<div class="card-community-score">⭐ ${communityScore}</div>`
    : '';

  const catTags = cats.map(c => `<span class="card-cat-tag">${c}</span>`).join('');
  const ratedClass = userRating ? 'rated' : '';
  const ratedText = userRating ? `✓ RATED (${userRating.overall_rating})` : '◈ RATE THIS GAME';

  return `
    <div class="game-card" style="animation-delay:${delay}s" onclick="openModal('${escapeStr(game.chave_nome)}')">
      <div class="card-cover-wrap">
        ${coverUrl
          ? `<img class="card-cover" src="${coverUrl}" alt="${escapeHtml(game.nome_merge)}" onerror="this.parentElement.innerHTML='<div class=\\'card-cover-fallback\\'>🎮</div>'" loading="lazy" />`
          : `<div class="card-cover-fallback">🎮</div>`
        }
        ${scoreTag}
      </div>
      <div class="card-body">
        <div class="card-title" title="${escapeHtml(game.nome_merge)}">${escapeHtml(game.nome_merge)}</div>
        <div class="card-times">
          <div class="card-time-item">
            <span class="card-time-label">👾 LUCAS</span>
            <span class="card-time-val">${myTime}</span>
          </div>
          <div class="card-time-item" style="text-align:right">
            <span class="card-time-label">🎯 RAFA</span>
            <span class="card-time-val">${rafaTime}</span>
          </div>
        </div>
        <div class="card-cats">${catTags}</div>
        <button class="card-rank-btn ${ratedClass}" onclick="event.stopPropagation(); openModal('${escapeStr(game.chave_nome)}')">
          ${ratedText}
        </button>
      </div>
    </div>
  `;
}

// ─── MODAL ────────────────────────────────────────────────
function openModal(gameKey) {
  const game = allGames.find(g => g.chave_nome === gameKey);
  if (!game) return;

  activeModal = game;

  document.getElementById('modal-title').textContent = game.nome_merge;
  document.getElementById('modal-cover').src = game.capa_url || game.meus_dados?.imagem_url || '';
  document.getElementById('modal-my-time').textContent = game.meus_dados?.tempo_jogado?.formatado || '—';
  document.getElementById('modal-rafa-time').textContent = game.rafa_dados?.tempo_jogado?.formatado || '—';

  // Categories
  document.getElementById('modal-cats').innerHTML = (game.categoria || [])
    .map(c => `<span class="card-cat-tag">${c}</span>`).join('');

  // Community scores
  renderCommunityScores(game);

  // Individual Reviews
  renderIndividualReviews(gameKey);

  // User's existing rating
  const existing = getUserRating(gameKey);
  ['graphics', 'gameplay', 'story', 'fun'].forEach(cat => {
    const val = existing ? (existing[`${cat}_score`] || 0) : 0;
    document.getElementById(`r-${cat}`).value = val;
    document.getElementById(`rv-${cat}`).textContent = val;
  });
  document.getElementById('r-comment').value = existing?.comment || '';
  updateOverall();

  document.getElementById('modal-save-error').classList.add('hidden');
  document.getElementById('rank-modal').classList.remove('hidden');
}

function renderCommunityScores(game) {
  const cats = ['graphics', 'gameplay', 'story', 'fun'];
  cats.forEach(cat => {
    const score = getScoreByCategory(game, cat);
    const el = document.getElementById(`cs-${cat}`);
    if (score !== null) {
      el.className = 'comm-score-bars';
      el.textContent = score;
    } else {
      el.className = 'comm-score-bars no-data';
      el.textContent = '—';
    }
  });
}

function renderIndividualReviews(gameKey) {
  const container = document.getElementById('modal-reviews-list');
  const ratings = allRankings[gameKey] ? Object.values(allRankings[gameKey]) : [];
  
  if (!ratings.length) {
    container.innerHTML = `<p style="font-size:0.85rem;color:var(--text-muted);font-style:italic;">No reviews yet.</p>`;
    return;
  }

  container.innerHTML = ratings.map(r => {
    const commentHtml = r.comment ? `<p class="review-comment">"${escapeHtml(r.comment)}"</p>` : '';
    return `
      <div class="review-card">
        <div class="review-header">
          <span class="review-user">${escapeHtml(r.username.toUpperCase())}</span>
          <span class="review-overall">${r.overall_rating}/10</span>
        </div>
        <div class="review-breakdown">
          <span class="review-pill">🎨 Graphics <span class="review-pill-val">${r.graphics_score || 0}</span></span>
          <span class="review-pill">🕹️ Gameplay <span class="review-pill-val">${r.gameplay_score || 0}</span></span>
          <span class="review-pill">📖 Story <span class="review-pill-val">${r.story_score || 0}</span></span>
          <span class="review-pill">😄 Fun <span class="review-pill-val">${r.fun_score || 0}</span></span>
        </div>
        ${commentHtml}
      </div>
    `;
  }).join('');
}

function closeModal() {
  document.getElementById('rank-modal').classList.add('hidden');
  activeModal = null;
}

function closeModalOutside(e) {
  if (e.target === document.getElementById('rank-modal')) closeModal();
}

function updateSliderVal(cat, val) {
  document.getElementById(`rv-${cat}`).textContent = parseFloat(val);
  updateOverall();
}

function updateOverall() {
  const cats = ['graphics', 'gameplay', 'story', 'fun'];
  const vals = cats.map(c => parseFloat(document.getElementById(`r-${c}`).value) || 0);
  const avg = vals.reduce((a, b) => a + b, 0) / cats.length;
  const rounded = Math.round(avg * 10) / 10;
  document.getElementById('modal-overall-val').textContent = rounded.toFixed(1);
}

// ─── SAVE RATING ──────────────────────────────────────────
async function saveRating() {
  if (!activeModal || !currentUsername) return;

  const btn = document.getElementById('modal-save-btn');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'SAVING...';

  const cats = ['graphics', 'gameplay', 'story', 'fun'];
  const scores = {};
  cats.forEach(c => {
    scores[`${c}_score`] = parseFloat(document.getElementById(`r-${c}`).value) || 0;
  });

  const overallVals = cats.map(c => scores[`${c}_score`]);
  const overall = Math.round((overallVals.reduce((a, b) => a + b, 0) / cats.length) * 10) / 10;

  const payload = {
    username: currentUsername,
    game_key: activeModal.chave_nome,
    ...scores,
    overall_rating: overall,
    comment: document.getElementById('r-comment').value.trim() || null,
  };

  try {
    // Upsert: insert or update
    const { error } = await db.from('rankings').upsert(payload, {
      onConflict: 'username,game_key'
    });
    if (error) throw error;

    // Update local cache
    if (!allRankings[payload.game_key]) allRankings[payload.game_key] = {};
    allRankings[payload.game_key][currentUsername] = payload;

    closeModal();
    renderGameGrid();
    renderStats();
    renderRankingsTable();
    showToast(`"${activeModal?.nome_merge || 'Game'}" rated ${overall}/10 ✓`, 'success');
  } catch (err) {
    document.getElementById('modal-save-error').textContent = err.message;
    document.getElementById('modal-save-error').classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = 'SAVE RATING';
  }
}

// ─── STATS PAGE ───────────────────────────────────────────
function renderStats() {
  let lucasMinutes = 0, rafaMinutes = 0;
  const catMap = new Map();

  allGames.forEach(g => {
    lucasMinutes += g.meus_dados?.tempo_jogado?.minutos_totais || 0;
    rafaMinutes += g.rafa_dados?.tempo_jogado?.minutos_totais || 0;
    (g.categoria || []).forEach(c => catMap.set(c, (catMap.get(c) || 0) + 1));
  });

  const totalHours = Math.round((lucasMinutes + rafaMinutes) / 60);
  const lucasHours = Math.round(lucasMinutes / 60);
  const rafaHours = Math.round(rafaMinutes / 60);

  document.getElementById('s-total-hours').textContent = totalHours.toLocaleString() + 'h';
  document.getElementById('s-lucas-hours').textContent = lucasHours.toLocaleString() + 'h';
  document.getElementById('s-rafa-hours').textContent = rafaHours.toLocaleString() + 'h';

  const ratedGames = Object.keys(allRankings).length;
  document.getElementById('s-rated-count').textContent = `${ratedGames} / ${allGames.length}`;

  // Top rated
  const gamesWithScores = allGames
    .map(g => ({ game: g, score: getCommunityScore(g) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  document.getElementById('top-rated-list').innerHTML = gamesWithScores.length
    ? gamesWithScores.map((x, i) => `
        <div class="rank-item">
          <span class="rank-num ${i < 3 ? 'top' : ''}">#${i + 1}</span>
          <span class="rank-name">${escapeHtml(x.game.nome_merge)}</span>
          <span class="rank-val">⭐ ${x.score}</span>
        </div>`).join('')
    : `<p style="color:var(--text-muted);font-size:.85rem;">No ratings yet</p>`;

  // Most played Lucas
  const topLucas = [...allGames]
    .sort((a, b) => (b.meus_dados?.tempo_jogado?.minutos_totais || 0) - (a.meus_dados?.tempo_jogado?.minutos_totais || 0))
    .slice(0, 8);

  document.getElementById('most-played-lucas').innerHTML = topLucas.map((g, i) => `
    <div class="rank-item">
      <span class="rank-num ${i < 3 ? 'top' : ''}">#${i + 1}</span>
      <span class="rank-name">${escapeHtml(g.nome_merge)}</span>
      <span class="rank-val">${g.meus_dados?.tempo_jogado?.formatado || '—'}</span>
    </div>`).join('');

  // Most played Rafa
  const topRafa = [...allGames]
    .sort((a, b) => (b.rafa_dados?.tempo_jogado?.minutos_totais || 0) - (a.rafa_dados?.tempo_jogado?.minutos_totais || 0))
    .slice(0, 8);

  document.getElementById('most-played-rafa').innerHTML = topRafa.map((g, i) => `
    <div class="rank-item">
      <span class="rank-num ${i < 3 ? 'top' : ''}">#${i + 1}</span>
      <span class="rank-name">${escapeHtml(g.nome_merge)}</span>
      <span class="rank-val">${g.rafa_dados?.tempo_jogado?.formatado || '—'}</span>
    </div>`).join('');

  // Categories chart
  const sortedCats = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxCount = sortedCats[0]?.[1] || 1;
  document.getElementById('top-categories').innerHTML = sortedCats.map(([cat, count]) => `
    <div class="cat-bar-item">
      <div class="cat-bar-header">
        <span class="cat-bar-name">${cat}</span>
        <span class="cat-bar-count">${count} games</span>
      </div>
      <div class="cat-bar-track">
        <div class="cat-bar-fill" style="width:${Math.round(count / maxCount * 100)}%"></div>
      </div>
    </div>`).join('');
}

// ─── RANKINGS TABLE ───────────────────────────────────────
function filterRankings(filter, btn) {
  rankingsFilter = filter;
  document.querySelectorAll('.rankings-filters .cat-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRankingsTable();
}

function renderRankingsTable() {
  let games = [...allGames];

  if (rankingsFilter === 'rated') {
    games = games.filter(g => getCommunityScore(g) >= 0);
  } else if (rankingsFilter === 'unrated') {
    games = games.filter(g => getCommunityScore(g) < 0);
  }

  // Sort: rated first by score, then unrated alphabetically
  games.sort((a, b) => {
    const sa = getCommunityScore(a);
    const sb = getCommunityScore(b);
    if (sa >= 0 && sb >= 0) return sb - sa;
    if (sa >= 0) return -1;
    if (sb >= 0) return 1;
    return a.nome_merge.localeCompare(b.nome_merge);
  });

  const container = document.getElementById('rankings-table');

  const header = `
    <div class="rankings-row header">
      <span>#</span>
      <span>IMG</span>
      <span>GAME</span>
      <span>GRAPHICS</span>
      <span>GAMEPLAY</span>
      <span>STORY</span>
      <span>FUN</span>
      <span>⭐ SCORE</span>
      <span></span>
    </div>`;

  const rows = games.map((game, idx) => {
    const score = getCommunityScore(game);
    const hasScore = score >= 0;
    const gr = getScoreByCategory(game, 'graphics');
    const gp = getScoreByCategory(game, 'gameplay');
    const st = getScoreByCategory(game, 'story');
    const fn = getScoreByCategory(game, 'fun');
    const coverUrl = game.capa_url || game.meus_dados?.imagem_url || '';

    return `
      <div class="rankings-row">
        <span class="rankings-rank">${hasScore ? idx + 1 : '—'}</span>
        <img class="rankings-img" src="${coverUrl}" alt="" onerror="this.style.display='none'" loading="lazy"/>
        <span class="rankings-name" title="${escapeHtml(game.nome_merge)}">${escapeHtml(game.nome_merge)}</span>
        <span class="rankings-score">${gr !== null ? gr : '<span style="color:var(--text-muted)">—</span>'}</span>
        <span class="rankings-score">${gp !== null ? gp : '<span style="color:var(--text-muted)">—</span>'}</span>
        <span class="rankings-score">${st !== null ? st : '<span style="color:var(--text-muted)">—</span>'}</span>
        <span class="rankings-score">${fn !== null ? fn : '<span style="color:var(--text-muted)">—</span>'}</span>
        <span class="rankings-score ${hasScore ? 'community' : 'unrated'}">${hasScore ? score : 'NOT RATED'}</span>
        <button class="card-rank-btn ${getUserRating(game.chave_nome) ? 'rated' : ''}" style="width:auto;padding:.4rem .9rem;font-size:.6rem;" onclick="openModal('${escapeStr(game.chave_nome)}')">
          ${getUserRating(game.chave_nome) ? 'See rattings' : '+ RATE'}
        </button>
      </div>`;
  });

  container.innerHTML = header + rows.join('');
}

// ─── TAB SWITCHING ────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
}

// ─── TOAST ────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ─── UTILS ────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escapeStr(str) {
  return String(str).replace(/'/g, "\\'");
}
