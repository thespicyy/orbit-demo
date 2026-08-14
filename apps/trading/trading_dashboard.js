// ─── XLSX (chargé à la demande — ~900 Ko, utilisé seulement par l'import/export
// Big Breaker et le CSV Binance non-CSV) ────────────────────────────────────
let _xlsxReady = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (_xlsxReady) return _xlsxReady;
  _xlsxReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = window._XLSX_SRC;
    s.onload = resolve;
    s.onerror = () => { _xlsxReady = null; reject(new Error('xlsx introuvable')); };
    document.head.appendChild(s);
  });
  return _xlsxReady;
}

// ─── DATA ──────────────────────────────────────────────────────────────────
let trades         = JSON.parse(localStorage.getItem('tjournal_trades')    || '[]');
// Migration one-shot : recalcule rrReal en distinguant trades HL (amtIn = notionnel)
// et trades manuels (amtIn = marge → risque$ = amtIn × levier × riskPct%)
(function migrateRR_v1() {
  if (localStorage.getItem('tjournal_migr_rr_v1')) return;
  let changed = false;
  trades.forEach(t => {
    const riskPct = (t.buy && t.sl) ? Math.abs((t.buy - t.sl) / t.buy) * 100 : 0;
    if (riskPct <= 0) return;
    let newRR = null;
    if (t.amtIn != null && t.pnlDollar != null) {
      // HL import : amtIn = notionnel → levier inutile dans le dénominateur
      // Manuel    : amtIn = marge     → multiplier par le levier pour obtenir le risque$
      const lev = (!t.hl_id && t.leverage > 1) ? t.leverage : 1;
      newRR = t.pnlDollar / (t.amtIn * lev * riskPct / 100);
    } else if (t.pnlPct != null) {
      newRR = t.pnlPct / riskPct;
    }
    if (newRR !== null) { t.rrReal = +newRR.toFixed(2); changed = true; }
  });
  if (changed) localStorage.setItem('tjournal_trades', JSON.stringify(trades));
  localStorage.setItem('tjournal_migr_rr_v1', '1');
})();
// Migration : marque comme idées les trades sans amtIn/amtOut (jamais réellement pris)
(function migrateIdeas() {
  if (localStorage.getItem('tjournal_migr_ideas_v1')) return; // déjà fait
  let changed = false;
  trades.forEach(t => {
    if (t.amtIn == null && t.amtOut == null && !t.isIdea) {
      t.isIdea = true; changed = true;
    }
  });
  if (changed) localStorage.setItem('tjournal_trades', JSON.stringify(trades));
  localStorage.setItem('tjournal_migr_ideas_v1', '1');
})();
let portfolioPoints= JSON.parse(localStorage.getItem('tjournal_portfolio') || '[]');
// Trades avec un P&L renseigné (seuls ceux-là comptent dans les KPIs)
const activeTrades = () => trades.filter(t => !t._isComment && !t.isIdea && !t.isPaper && (t.pnlDollar !== null || t.pnlPct !== null));

// ─── DASHBOARD PERIOD FILTER ───────────────────────────────────────────────
let _dashPeriod   = 'all';
let _typeFilter   = localStorage.getItem('tjournal_type_filter') || 'all';
let _reviewFilter = localStorage.getItem('tjournal_review_filter') || 'all';

function dashFilteredTrades() {
  const all = activeTrades();
  if (_dashPeriod === 'all') return all;
  const days   = { '1w': 7, '1m': 30, '3m': 90 }[_dashPeriod];
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return all.filter(t => t.date >= cutoffStr);
}

function _dashPeriodLabel() {
  return { '1w': '7 derniers jours', '1m': '30 derniers jours', '3m': '3 derniers mois', 'all': 'tous les trades' }[_dashPeriod];
}

function setDashPeriod(period) {
  _dashPeriod = period;
  document.querySelectorAll('.dash-period-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.period === period)
  );
  renderDashKPIs();
  renderHomeEquity();
  renderRecentTrades();
  animateKPIs(['home_pnl','home_wr','home_nb','home_rr','home_pf']);
}
// ─── SETUP GRADE ───────────────────────────────────────────────────────────
const _GRADE_CFG = {
  '':   { idle:'rgba(255,255,255,0.04)', act:'rgba(255,255,255,0.14)', bc_idle:'var(--border2)',          bc_act:'rgba(255,255,255,0.5)',   clr_idle:'var(--text2)', clr_act:'#fff'    },
  'D':  { idle:'rgba(239,68,68,0.07)',   act:'rgba(239,68,68,0.28)',   bc_idle:'rgba(239,68,68,0.25)',     bc_act:'#ef4444',                 clr_idle:'#f87171',      clr_act:'#fca5a5' },
  'C':  { idle:'rgba(249,115,22,0.07)',  act:'rgba(249,115,22,0.28)',  bc_idle:'rgba(249,115,22,0.25)',    bc_act:'#f97316',                 clr_idle:'#fb923c',      clr_act:'#fdba74' },
  'B':  { idle:'rgba(234,179,8,0.07)',   act:'rgba(234,179,8,0.28)',   bc_idle:'rgba(234,179,8,0.25)',     bc_act:'#eab308',                 clr_idle:'#facc15',      clr_act:'#fde047' },
  'A':  { idle:'rgba(34,197,94,0.07)',   act:'rgba(34,197,94,0.28)',   bc_idle:'rgba(34,197,94,0.25)',     bc_act:'#22c55e',                 clr_idle:'#4ade80',      clr_act:'#86efac' },
  'A+': { idle:'rgba(167,139,250,0.1)',  act:'rgba(167,139,250,0.3)', bc_idle:'rgba(167,139,250,0.3)',    bc_act:'#a78bfa',                 clr_idle:'#a78bfa',      clr_act:'#c4b5fd' },
};
function setGrade(g) {
  document.getElementById('f_grade').value = g;
  [['','none'],['D','D'],['C','C'],['B','B'],['A','A'],['A+','Aplus']].forEach(([grade, suffix]) => {
    ['gbtn_'+suffix, 'gbtn_'+suffix+'_s'].forEach(id => {
      const btn = document.getElementById(id); if (!btn) return;
      const cfg = _GRADE_CFG[grade]; const active = grade === g;
      btn.style.background  = active ? cfg.act      : cfg.idle;
      btn.style.borderColor = active ? cfg.bc_act   : cfg.bc_idle;
      btn.style.color       = active ? cfg.clr_act  : cfg.clr_idle;
      btn.style.boxShadow   = active ? `0 0 0 2px ${cfg.bc_act}55` : 'none';
      btn.style.transform   = active ? 'scale(1.07)' : 'scale(1)';
    });
  });
  const riskMap = {'A+': '2', 'A': '1', 'B': '0.5'};
  if (riskMap[g]) {
    const el = document.getElementById('calc_risk_target');
    if (el) { el.value = riskMap[g]; localStorage.setItem('tjournal_risk_target', riskMap[g]); calcPosition(); }
  }
}

function gradeTag(g, size='sm') {
  if (!g) return '';
  const map = {
    'D':  ['#f87171','rgba(239,68,68,0.18)','rgba(239,68,68,0.4)'],
    'C':  ['#fb923c','rgba(249,115,22,0.18)','rgba(249,115,22,0.4)'],
    'B':  ['#facc15','rgba(234,179,8,0.18)','rgba(234,179,8,0.4)'],
    'A':  ['#4ade80','rgba(34,197,94,0.18)','rgba(34,197,94,0.4)'],
    'A+': ['#c4b5fd','rgba(167,139,250,0.18)','rgba(167,139,250,0.45)'],
  };
  const [clr,bg,bc] = map[g] || ['var(--text2)','transparent','var(--border2)'];
  if (size === 'col') {
    return `<div style="display:flex;justify-content:center"><span style="min-width:34px;padding:5px 8px;border-radius:9px;font-size:14px;font-weight:800;background:${bg};border:1.5px solid ${bc};color:${clr};text-align:center;letter-spacing:.5px;display:inline-block">${g}</span></div>`;
  }
  if (size === 'lg') {
    return `<span style="display:inline-block;padding:5px 14px;border-radius:10px;font-size:17px;font-weight:800;background:${bg};border:1.5px solid ${bc};color:${clr};letter-spacing:.5px;vertical-align:middle">${g}</span>`;
  }
  return `<span style="display:inline-block;padding:1px 6px;border-radius:5px;font-size:10px;font-weight:800;background:${bg};border:1px solid ${bc};color:${clr};letter-spacing:.3px;vertical-align:middle">${g}</span>`;
}

// ─── IDEA TOGGLE ───────────────────────────────────────────────────────────
function toggleIdeaStyle() {
  const cb  = document.getElementById('f_is_idea');
  const lbl = document.getElementById('f_idea_label');
  if (!cb || !lbl) return;
  if (cb.checked) {
    lbl.style.background     = 'rgba(245,158,11,0.1)';
    lbl.style.borderColor    = 'rgba(245,158,11,0.4)';
    lbl.style.color          = 'var(--yellow)';
  } else {
    lbl.style.background  = 'transparent';
    lbl.style.borderColor = 'rgba(255,255,255,0.08)';
    lbl.style.color       = 'var(--text2)';
  }
}

// ─── TYPE FILTER ───────────────────────────────────────────────────────────
// 'all'   = tous les trades
// 'taken' = trades avec P&L (réellement pris)
// 'ideas' = trades sans P&L (idées notées)
const _applyTypeFilter = arr =>
  _typeFilter === 'taken' ? arr.filter(t => t._isComment || !t.isIdea)
  : _typeFilter === 'ideas' ? arr.filter(t => t._isComment || !!t.isIdea)
  : arr;

// 'all' | 'unreviewed' | 'reviewed' | 'again'
// Contrairement au filtre pris/idées, les commentaires ne passent PAS en
// permanence ici : ils ont leur propre statut reviewé bien réel
// (toggleCommentReviewedInRow), donc ils sont filtrés exactement comme
// les trades.
const _applyReviewFilter = arr =>
  _reviewFilter === 'unreviewed' ? arr.filter(t => !t.reviewed)
  : _reviewFilter === 'reviewed' ? arr.filter(t => !!t.reviewed)
  : _reviewFilter === 'again'    ? arr.filter(t => !!t.reviewAgain)
  : arr;

// 'real' | 'paper'
let journalMode = localStorage.getItem('tjournal_mode') || 'real';
const _applyModeFilter = arr =>
  journalMode === 'paper'
    ? arr.filter(t => !!t.isPaper)
    : arr.filter(t => !t.isPaper);

function setJournalMode(mode) {
  journalMode = mode;
  localStorage.setItem('tjournal_mode', mode);
  updateJournalModeUI();
  const paperCb = document.getElementById('f_is_paper');
  if (paperCb) { paperCb.checked = mode === 'paper'; togglePaperStyle(); }
  renderTable();
}
function updateJournalModeUI() {
  const rBtn = document.getElementById('jmode-real');
  const pBtn = document.getElementById('jmode-paper');
  if (!rBtn || !pBtn) return;
  rBtn.className = 'jmode-btn' + (journalMode === 'real'  ? ' active-real'  : '');
  pBtn.className = 'jmode-btn' + (journalMode === 'paper' ? ' active-paper' : '');
}
function togglePaperStyle() {
  const cb  = document.getElementById('f_is_paper');
  const lbl = document.getElementById('f_paper_label');
  if (!cb || !lbl) return;
  lbl.style.borderColor = cb.checked ? 'rgba(99,102,241,0.5)'  : 'rgba(99,102,241,0.25)';
  lbl.style.background  = cb.checked ? 'rgba(99,102,241,0.12)' : 'transparent';
  lbl.style.color       = cb.checked ? '#818cf8' : 'var(--text2)';
}

function setTypeFilter(type) {
  _typeFilter = type;
  localStorage.setItem('tjournal_type_filter', type);
  document.querySelectorAll('.type-filter-btn').forEach(b =>
    b.classList.toggle('tfb-active', b.dataset.type === type)
  );
  renderTable();
  updateHeader();
}

function setReviewFilter(type) {
  _reviewFilter = type;
  localStorage.setItem('tjournal_review_filter', type);
  document.querySelectorAll('.review-filter-btn').forEach(b =>
    b.classList.toggle('tfb-active', b.dataset.review === type)
  );
  renderTable();
}

let charts         = {};
let editingId         = null;
let calYear, calMonth, calViewMode = 'days';

function save()           { localStorage.setItem('tjournal_trades',    JSON.stringify(trades));          updateHeader(); }
function savePortfolio()  { localStorage.setItem('tjournal_portfolio',  JSON.stringify(portfolioPoints)); updatePortfolioPill(); }
function saveProjection() {
  const keys = ['proj_capital','proj_wr','proj_tpm','proj_rr','proj_risk','proj_monthly','proj_years','proj_leverage','proj_p2_year','proj_p2_withdrawal','proj_p2_tpm'];
  const obj  = {};
  keys.forEach(k => { const el = document.getElementById(k); if (el) obj[k] = el.value; });
  const el2 = document.getElementById('proj_phase2_enabled');
  if (el2) obj['proj_phase2_enabled'] = el2.checked ? '1' : '0';
  localStorage.setItem('tjournal_projection', JSON.stringify(obj));
}
function loadProjection() {
  const raw = localStorage.getItem('tjournal_projection');
  if (!raw) return;
  try {
    const obj = JSON.parse(raw);
    // Migration : supprime l'ancienne clé commission
    if (obj.proj_commission !== undefined) { delete obj.proj_commission; }
    // Migration : ancien format wins/losses → nouveau format wr%/tpm
    if (obj.proj_wins !== undefined || obj.proj_losses !== undefined) {
      const w = parseFloat(obj.proj_wins) || 2;
      const l = parseFloat(obj.proj_losses) || 1;
      const tpm = w + l;
      obj.proj_wr  = ((w / tpm) * 100).toFixed(1);
      obj.proj_tpm = String(tpm);
      delete obj.proj_wins;
      delete obj.proj_losses;
    }
    Object.entries(obj).forEach(([k, v]) => {
      if (k === 'proj_phase2_enabled') {
        const cb = document.getElementById(k); if (cb) cb.checked = v === '1';
      } else {
        const el = document.getElementById(k); if (el) el.value = v;
      }
    });
    updateProjExpected();
  } catch(e) {}
}

function updateProjExpected() {
  const wr       = parseFloat(document.getElementById('proj_wr')?.value);
  const tpm      = parseFloat(document.getElementById('proj_tpm')?.value);
  const rr       = parseFloat(document.getElementById('proj_rr')?.value);
  const risk     = parseFloat(document.getElementById('proj_risk')?.value) || 1;
  const leverage = parseFloat(document.getElementById('proj_leverage')?.value) || 1;
  const el       = document.getElementById('proj_expected');
  if (!el) return;
  if (isNaN(wr) || isNaN(tpm) || tpm <= 0 || isNaN(rr)) { el.innerHTML = '–'; el.style.color = 'var(--text2)'; return; }
  const w = wr / 100;
  const r = risk / 100;
  // Espérance en R (où 1R = risque de base = risk% du capital, sans levier)
  // Avec levier L : win = RR×L en R, loss = L en R → on multiplie par L
  // fee_R_base = frais A/R sans levier, en R = 0.06% / risk%
  const FEE_RT    = 0.0006;
  const fee_R_base = r > 0 ? FEE_RT / r : 0;
  const exp_R     = leverage * (w * (rr - fee_R_base) - (1 - w) * (1 + fee_R_base));
  const expColor = exp_R >= 0 ? 'var(--green)' : 'var(--red)';
  el.innerHTML =
    `<div style="display:flex;justify-content:space-between;align-items:center;width:100%">` +
      `<span>` +
        `<span style="color:var(--text2)">WR :&nbsp;</span><span style="color:var(--accent2);font-weight:700">${wr.toFixed(1)}%</span>` +
        `<span style="color:var(--text2)">&nbsp;&nbsp;Esp :&nbsp;</span><span style="color:${expColor};font-weight:700">${exp_R >= 0 ? '+' : ''}${exp_R.toFixed(3)}R/tr</span>` +
      `</span>` +
      `<span style="color:var(--text2);font-size:10px">(${tpm} tr/mois)</span>` +
    `</div>`;
  el.style.color = '';
}

// ─── EXPORT / IMPORT JSON ──────────────────────────────────────────────────
function renderExportStats() {
  document.getElementById('export_stat_trades').textContent    = trades.length;
  document.getElementById('export_stat_portfolio').textContent = portfolioPoints.length;
}
let _backupFileHandle = null;

async function getBudgetFromHub() {
  if (!window.parent || window.parent === window) return {};
  return new Promise(resolve => {
    const tid = setTimeout(() => { window.removeEventListener('message', handler); resolve({}); }, 1200);
    function handler(e) {
      if (!e.data || e.data.type !== 'budget_data_response') return;
      clearTimeout(tid);
      window.removeEventListener('message', handler);
      resolve(e.data.budget || {});
    }
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: 'budget_data_request' }, '*');
  });
}

async function exportData() {
  const [images, hubBudget] = await Promise.all([getAllIdbImages(), getBudgetFromHub()]);
  const projRaw = localStorage.getItem('tjournal_projection');
  const budgetKeys = [
    'nx_budget','nx_cats','nx_comptes','nx_tombstone','nx_last_cat',
    'nexus_ops','nexus_prices','nexus_snaps',
    'nx_proj_v1','nx_rebal',
    'nx_inv_pea','nx_inv_crypto','nx_inv_step','nx_theme',
  ];
  const budget = {};
  budgetKeys.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) { try { budget[k] = JSON.parse(v); } catch { budget[k] = v; } }
  });
  Object.keys(hubBudget).forEach(k => { if (!(k in budget)) budget[k] = hubBudget[k]; });
  const settingsKeys = [
    'tjournal_rr', 'tjournal_risk_target', 'tjournal_calc_capital',
  ];
  const settings = {};
  settingsKeys.forEach(k => { const v = localStorage.getItem(k); if (v !== null) settings[k] = v; });

  const payload = {
    version: 1,
    exportDate: new Date().toISOString(),
    trades,
    portfolio: portfolioPoints,
    projection: projRaw ? JSON.parse(projRaw) : {},
    settings,
    images,
    budget,
  };
  const json = JSON.stringify(payload, null, 2);
  try {
    const r = await fetch('http://127.0.0.1:8000/backup/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      signal: AbortSignal.timeout(8000),
    });
    const res = await r.json();
    if (res.ok) {
      const btn = document.querySelector('[onclick="exportData()"]');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Sauvegardé';
        btn.style.opacity = '0.7';
        setTimeout(() => { btn.innerHTML = orig; btn.style.opacity = ''; }, 2500);
      }
      return;
    }
  } catch(e) {}
  // Fallback : bot hors ligne → téléchargement navigateur
  const blob = new Blob([json], { type: 'application/json' });
  let saved = false;
  if (window.showSaveFilePicker) {
    try {
      if (!_backupFileHandle) {
        _backupFileHandle = await window.showSaveFilePicker({
          suggestedName: 'prisme_backup.json',
          types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        });
      }
      const writable = await _backupFileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      saved = true;
    } catch(err) { _backupFileHandle = null; }
  }
  if (!saved) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prisme_backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const btn2 = document.querySelector('[onclick="exportData()"]');
  if (btn2) {
    const orig2 = btn2.innerHTML;
    if (saved) {
      btn2.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Sauvegardé';
      btn2.style.opacity = '0.7';
      setTimeout(() => { btn2.innerHTML = orig2; btn2.style.opacity = ''; }, 2500);
    } else {
      btn2.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Bot hors ligne — Downloads';
      btn2.style.color = '#f59e0b';
      setTimeout(() => { btn2.innerHTML = orig2; btn2.style.color = ''; }, 3500);
    }
  }
}
function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const d = JSON.parse(e.target.result);
      const nTrades = (d.trades    || []).length;
      const nPorts  = (d.portfolio || []).length;
      if (!confirm(`Importer ${nTrades} trade(s), ${nPorts} point(s) portfolio ?\nLes données actuelles seront remplacées.`)) return;
      if (d.trades)     { trades          = d.trades;    save(); renderTable(); }
      if (d.portfolio)  { portfolioPoints = d.portfolio; savePortfolio(); updatePortfolioPill(); }
      if (d.projection) { localStorage.setItem('tjournal_projection', JSON.stringify(d.projection)); loadProjection(); proj_prefilled = true; }
      if (d.settings) {
        Object.entries(d.settings).forEach(([k, v]) => { if (v != null) localStorage.setItem(k, v); });
        const rr = d.settings.tjournal_rr;
        if (rr) document.getElementById('f_rr').value = rr;
        const rt = d.settings.tjournal_risk_target;
        if (rt) document.getElementById('calc_risk_target').value = rt;
      }
      if (d.budget) {
        Object.entries(d.budget).forEach(([k, v]) => {
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        });
      }
      if (d.images) { Object.entries(d.images).forEach(([key, val]) => saveIdbImage(key, val)); }
      alert('Import réussi !');
    } catch(err) { alert('Fichier JSON invalide : ' + err.message); }
    input.value = '';
  };
  reader.readAsText(file);
}

function updatePortfolioPill() {
  const el = document.getElementById('hdrPortfolio');
  if (!el) return;
  if (!portfolioPoints.length) { el.textContent = '–'; return; }
  const last = portfolioPoints[portfolioPoints.length - 1].value;
  const n = parseFloat(last);
  if (isNaN(n)) { el.textContent = '–'; return; }
  el.textContent = '$' + Math.round(n).toLocaleString('en-US');
  _notifyParentStats();
}

// ─── INIT ──────────────────────────────────────────────────────────────────
// ── Theme toggle ────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  if (theme === 'light') {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
}
function toggleTheme() {
  const scrollY = window.scrollY;
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  localStorage.setItem('tjournal_theme', next);
  if (window.parent !== window) window.parent.postMessage({ type: 'theme_change', theme: next }, '*');
  // Re-render uniquement l'onglet actif pour éviter que destroyCharts() d'analytics
  // n'efface les graphes du dashboard
  const activeContent = document.querySelector('.content.active');
  if (!activeContent) return;
  const tab = activeContent.id.replace('tab-', '');
  try {
    if (tab === 'dashboard') { renderDashboard(); }
    else if (tab === 'analytics') {
      const activeAtab = document.querySelector('.atab.active')?.id;
      if (activeAtab === 'atab-projection') renderProjection();
      else renderAnalytics();
    }
  } catch(e) {}
  // Restaurer la position de scroll après le re-render
  requestAnimationFrame(() => window.scrollTo({ top: scrollY, behavior: 'instant' }));
}

// ─── P&L Pixel Masker ───────────────────────────────────────────────────────
const _PNLPX = {
  size: 5,
  bmp: {
    '0':[[0,0],[0,1],[0,2],[1,0],[1,2],[2,0],[2,1],[2,2]],
    '1':[[0,1],[1,1],[2,1]],
    '2':[[0,0],[0,1],[0,2],[1,1],[1,2],[2,0],[2,1]],
    '3':[[0,0],[0,1],[0,2],[1,1],[1,2],[2,0],[2,1],[2,2]],
    '4':[[0,0],[0,2],[1,0],[1,1],[1,2],[2,2]],
    '5':[[0,0],[0,1],[0,2],[1,0],[1,1],[2,1],[2,2]],
    '6':[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,2]],
    '7':[[0,0],[0,1],[0,2],[1,2],[2,2]],
    '8':[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]],
    '9':[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,2]],
  },
  seed: 0, interval: null
};
function _ppH(n){ const x=Math.sin(n*12.9898)*43758.5453; return x-Math.floor(x); }
function _ppShuf(s){
  const a=[]; for(let r=0;r<3;r++) for(let c=0;c<3;c++) a.push([r,c]);
  return a.map((cell,i)=>({cell,k:_ppH(s*31.7+i*17.13)})).sort((a,b)=>a.k-b.k).map(o=>o.cell);
}
function _ppHtml(text, isPos){
  const p=_PNLPX.size, gs=3*p, col='#94a3b8';
  let h=`<span style="display:inline-flex;align-items:center;gap:1px;vertical-align:middle;line-height:1">`;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(/[0-9]/.test(ch)){
      const cells=_ppShuf(_PNLPX.seed*13+i*41).slice(0,(_PNLPX.bmp[ch]||[]).length);
      h+=`<span style="position:relative;display:inline-block;width:${gs}px;height:${gs}px">`;
      cells.forEach(([r,c])=>{
        const op=(0.55+_ppH(r*3.7+c*11.3+i*5.1)*0.45).toFixed(2);
        h+=`<span style="position:absolute;width:${p}px;height:${p}px;background:${col};opacity:${op};left:${c*p}px;top:${r*p}px"></span>`;
      });
      h+=`</span>`;
    } // non-digit characters not rendered in hidden mode
  }
  return h+`</span>`;
}
function _ppApply(el){ el.innerHTML=_ppHtml(el.dataset.v||'', el.dataset.p==='1'); }
function _ppRestore(el){ el.textContent=el.dataset.v||''; }
// try/catch par élément : une seule valeur malformée ne doit jamais
// désactiver le masquage de toutes les autres
function _ppApplyAll(){ document.querySelectorAll('[data-pnl-px]').forEach(el=>{ try{_ppApply(el);}catch(e){} }); }
function _ppRestoreAll(){ document.querySelectorAll('[data-pnl-px]').forEach(el=>{ try{_ppRestore(el);}catch(e){} }); }
// Helper : enveloppe une valeur sensible dans un span pixel-masquable
function _pxSpan(val, pos){ return `<span data-pnl-px data-v="${val}" data-p="${pos?1:0}">${val}</span>`; }

let _pnlHidden = localStorage.getItem('tjournal_pnl_hidden') === '1';
function togglePnlVisibility() {
  _pnlHidden = !_pnlHidden;
  localStorage.setItem('tjournal_pnl_hidden', _pnlHidden ? '1' : '0');
  document.body.classList.toggle('pnl-hidden', _pnlHidden);
  if (_pnlHidden) {
    _ppApplyAll();
    if (!_PNLPX.interval) _PNLPX.interval = setInterval(()=>{ _PNLPX.seed++; _ppApplyAll(); }, 700);
  } else {
    clearInterval(_PNLPX.interval); _PNLPX.interval = null;
    _ppRestoreAll();
  }
  // Graphiques déjà affichés (tooltip natif Chart.js) : leur config tooltip.enabled
  // est figée à la création, on la met à jour en direct sans attendre un changement d'onglet.
  Object.values(charts).forEach(c => {
    if (c && c.options && c.options.plugins && c.options.plugins.tooltip) {
      c.options.plugins.tooltip.enabled = !_pnlHidden;
      c.update('none');
    }
  });
  if (window.parent !== window) window.parent.postMessage({ type: 'pnl_visibility', hidden: _pnlHidden }, '*');
  const btn = document.getElementById('hideValuesBtn');
  if (!btn) return;
  btn.title = _pnlHidden ? 'Afficher les valeurs' : 'Masquer les valeurs';
  btn.innerHTML = _pnlHidden
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

window.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('tjournal_theme') || 'dark');
  // MutationObserver — auto-apply pixel masks when new [data-pnl-px] elements appear
  (new MutationObserver(muts => {
    if(!_pnlHidden) return;
    muts.forEach(m => m.addedNodes.forEach(n => {
      if(n.nodeType!==1) return;
      if(n.hasAttribute&&n.hasAttribute('data-pnl-px')) _ppApply(n);
      else if(n.querySelectorAll) n.querySelectorAll('[data-pnl-px]').forEach(_ppApply);
    }));
  })).observe(document.body, { childList:true, subtree:true });

  if (_pnlHidden) {
    document.body.classList.add('pnl-hidden');
    _ppApplyAll();
    if (!_PNLPX.interval) _PNLPX.interval = setInterval(()=>{ _PNLPX.seed++; _ppApplyAll(); }, 700);
    // Prévenir le hub dès le chargement (pas seulement au toggle), sinon
    // après un F5 la barre du hub affiche le P&L en clair
    if (window.parent !== window) window.parent.postMessage({ type: 'pnl_visibility', hidden: true }, '*');
    const btn = document.getElementById('hideValuesBtn');
    if (btn) {
      btn.title = 'Afficher les valeurs';
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    }
  }
  const savedRisk = localStorage.getItem('tjournal_risk_target');
  if (savedRisk) document.getElementById('calc_risk_target').value = savedRisk;
  const savedRR = localStorage.getItem('tjournal_rr');
  if (savedRR) document.getElementById('f_rr').value = savedRR;
  updateJournalModeUI();
  const paperCb = document.getElementById('f_is_paper'); if (paperCb) paperCb.checked = journalMode === 'paper';
  togglePaperStyle();
  setGrade('');
  const now = new Date();
  document.getElementById('f_date').value  = now.toISOString().slice(0,10);
  document.getElementById('f_time').value  = now.toTimeString().slice(0,5);
  document.getElementById('p_date').value  = now.toISOString().slice(0,10);
  calYear  = now.getFullYear();
  calMonth = now.getMonth();
  renderTable();
  updateHeader();
  // Restore type filter pill state
  document.querySelectorAll('.type-filter-btn').forEach(b =>
    b.classList.toggle('tfb-active', b.dataset.type === _typeFilter)
  );
  updatePortfolioPill();
  loadProjection();
  const savedTab = localStorage.getItem('tjournal_tab') || 'dashboard';
  if (window.parent !== window) window.parent.postMessage({ type: 'tab_changed', tab: savedTab }, '*');
  if (savedTab === 'dashboard') {
    renderDashboard();
  } else {
    // Restaurer l'onglet sans animation ni flash du dashboard
    switchTab(savedTab);
    if (savedTab === 'analytics') {
      const savedAtab = localStorage.getItem('tjournal_atab');
      if (savedAtab && savedAtab !== 'stats') switchAnalyticsTab(savedAtab);
    }
  }
});

// ─── TABS ──────────────────────────────────────────────────────────────────
function switchTab(tab) {
  const next    = document.getElementById('tab-' + tab);
  const current = document.querySelector('.content.active');
  if (current === next) return;
  localStorage.setItem('tjournal_tab', tab);
  if (window.parent !== window) window.parent.postMessage({ type: 'tab_changed', tab: tab }, '*');

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[onclick="switchTab('${tab}')"]`)?.classList.add('active');

  current.classList.remove('active');
  next.classList.add('active');
  document.getElementById('tab-init-hide')?.remove();
  const hasData = trades.length > 0;
  if (hasData) next.querySelectorAll('.kpi-value').forEach(el => { el.textContent = ''; });
  if (tab === 'analytics') {
    const activeAtab = document.querySelector('.atab.active')?.id;
    requestAnimationFrame(() => {
      if (activeAtab === 'atab-projection') { renderProjection(); }
      else { (window.renderAnalytics || renderAnalytics)(); animateKPIs(['kpi_wr','kpi_pnl','kpi_rr','kpi_pf','ana_maxdd','ana_curdd','sess_asian_pnl','sess_london_pnl','sess_ny_pnl']); }
    });
  }
  if (tab === 'dashboard') { renderDashboard(); }
  if (tab === 'export')    { renderExportStats(); }
}

function switchDash(panel) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.dash-tab[onclick="switchDash('${panel}')"]`).classList.add('active');
  document.getElementById('dash-'+panel).classList.add('active');
  if (panel === 'portfolio') renderPortfolioChart();
  if (panel === 'calendar')  (window.renderCalendar || renderCalendar)();
}

// ── IndexedDB image storage ─────────────────────────────────────────────────
let _idb = null;
let _pendingImg5 = null, _pendingImg15 = null;
let _pendingImg5File = null, _pendingImg15File = null;

function openIDB() {
  return new Promise((resolve, reject) => {
    if (_idb) return resolve(_idb);
    const req = indexedDB.open('tjournal_images', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('images');
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror = () => reject(req.error);
  });
}
function saveIdbImage(key, dataUrl) {
  return openIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').put(dataUrl, key);
    tx.oncomplete = res; tx.onerror = rej;
  }));
}
function loadIdbImage(key) {
  return openIDB().then(db => new Promise((res, rej) => {
    const req = db.transaction('images').objectStore('images').get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = rej;
  }));
}
function deleteIdbImage(key) {
  return openIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').delete(key);
    tx.oncomplete = res; tx.onerror = rej;
  }));
}
function getAllIdbImages() {
  return openIDB().then(db => new Promise((res, rej) => {
    const result = {}, req = db.transaction('images').objectStore('images').openCursor();
    req.onsuccess = e => {
      const c = e.target.result;
      if (c) { result[c.key] = c.value; c.continue(); } else res(result);
    };
    req.onerror = rej;
  }));
}
function clearAllIdbImages() {
  return openIDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction('images', 'readwrite');
    tx.objectStore('images').clear();
    tx.oncomplete = res; tx.onerror = rej;
  }));
}

// ── Aide à l'entrée depuis une bougie réelle (Hyperliquid) ──────────────────
let _candleHelperData = null;
const _CANDLE_DIR_CFG = {
  SHORT: { idleBg:'rgba(239,68,68,0.08)',  idleBorder:'rgba(239,68,68,0.3)',  activeBg:'rgba(239,68,68,0.4)',  activeBorder:'#ef4444' },
  LONG:  { idleBg:'rgba(16,185,129,0.08)', idleBorder:'rgba(16,185,129,0.3)', activeBg:'rgba(16,185,129,0.4)', activeBorder:'#10b981' },
};
async function loadCandleHelper(tf) {
  const ticker = (document.getElementById('f_ticker')?.value || '').trim().toUpperCase();
  if (!ticker) { alert('Choisis un ticker d’abord.'); return; }
  document.querySelectorAll('[data-tf]').forEach(b => b.classList.toggle('active', b.dataset.tf === tf));
  const list = document.getElementById('candleHelperList');
  list.textContent = 'Chargement…';
  try {
    const r = await fetch(`http://127.0.0.1:8000/hl/candles?coin=${ticker}&interval=${tf}`, { signal: AbortSignal.timeout(6000) });
    const json = await r.json();
    if (!json.ok) { list.textContent = json.error || 'Erreur'; return; }
    _candleHelperData = { tf, candles: json.candles };
    list.innerHTML = `<div style="display:grid;grid-template-columns:repeat(${json.candles.length},1fr);gap:4px;text-align:center">` + json.candles.map((c, i) => {
      const isLast = i === json.candles.length - 1;
      const timeLabel = new Date(c.t).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
      return `<div>
        <div style="${isLast?'color:var(--yellow)':'color:var(--text2)'}">${timeLabel}${isLast?'●':''}</div>
        <div style="display:flex;gap:2px;justify-content:center;margin-top:3px">
          <button type="button" data-dir="SHORT" onclick="applyCandleHelper(${i},'SHORT',this)" style="font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid ${_CANDLE_DIR_CFG.SHORT.idleBorder};background:${_CANDLE_DIR_CFG.SHORT.idleBg};color:var(--red);cursor:pointer;font-weight:700;transition:all .15s">S</button>
          <button type="button" data-dir="LONG" onclick="applyCandleHelper(${i},'LONG',this)" style="font-size:10px;padding:2px 6px;border-radius:5px;border:1px solid ${_CANDLE_DIR_CFG.LONG.idleBorder};background:${_CANDLE_DIR_CFG.LONG.idleBg};color:var(--green);cursor:pointer;font-weight:700;transition:all .15s">L</button>
        </div>
      </div>`;
    }).join('') + `</div>`;
  } catch(e) {
    list.textContent = 'Bot non connecté.';
  }
}
function resetCandleHelper() {
  _candleHelperData = null;
  document.querySelectorAll('[data-tf]').forEach(b => b.classList.remove('active'));
  const list = document.getElementById('candleHelperList');
  if (list) list.textContent = 'Choisis un timeframe.';
}
function applyCandleHelper(idx, dir, btn) {
  if (!_candleHelperData) return;
  const c = _candleHelperData.candles[idx]; if (!c) return;
  const bodyTop = Math.max(c.o, c.c), bodyBottom = Math.min(c.o, c.c);
  document.getElementById('f_buy').value = dir === 'SHORT' ? bodyBottom : bodyTop;
  document.getElementById('f_sl').value  = dir === 'SHORT' ? c.h : c.l;
  calcRisk(); calcPnl();
  const list = document.getElementById('candleHelperList');
  if (list) {
    list.querySelectorAll('button[data-dir]').forEach(b => {
      const cfg = _CANDLE_DIR_CFG[b.dataset.dir];
      b.style.background = cfg.idleBg;
      b.style.borderColor = cfg.idleBorder;
    });
  }
  if (btn) {
    const cfg = _CANDLE_DIR_CFG[dir];
    btn.style.background = cfg.activeBg;
    btn.style.borderColor = cfg.activeBorder;
  }
}

// ── Image upload UI ──────────────────────────────────────────────────────────
function handleImgDrop(event, which) {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = e => { setPendingImg(which, e.target.result); showImgPreview(which, e.target.result); };
  reader.readAsDataURL(file);
}
function setPendingImg(which, dataUrl) {
  if (which === '5') _pendingImg5 = dataUrl; else _pendingImg15 = dataUrl;
}
async function pickLastScreenshot(which) {
  try {
    const r = await fetch('http://127.0.0.1:8000/screenshots/latest', { signal: AbortSignal.timeout(4000) });
    const json = await r.json();
    if (!json.ok) { alert('Erreur : ' + (json.error || json.detail || 'réponse inattendue du bot')); return; }
    setPendingImg(which, json.data);
    showImgPreview(which, json.data);
    if (which === '5') _pendingImg5File = json.filename;
    else _pendingImg15File = json.filename;
  } catch(e) {
    alert('Bot non connecté ou dossier inaccessible.');
  }
}
function showImgPreview(which, dataUrl) {
  const zone = document.getElementById('zone_img' + which);
  if (!zone) return;
  zone.innerHTML = `
    <img class="img-upload-preview" src="${dataUrl}" alt="preview"/>
    <button class="img-remove-btn" onclick="event.stopPropagation();removeImg('${which}')">✕</button>`;
}
function removeImg(which) {
  if (which === '5') { _pendingImg5 = ''; _pendingImg5File = null; }
  else               { _pendingImg15 = ''; _pendingImg15File = null; }
  const zone = document.getElementById('zone_img' + which);
  if (!zone) return;
  zone.innerHTML = `
    <div class="img-upload-placeholder">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.35"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      <span>Cliquer pour charger le dernier screenshot</span>
    </div>`;
  zone.onclick = () => pickLastScreenshot(which);
}
function resetImgZones() {
  _pendingImg5 = null; _pendingImg15 = null;
  _pendingImg5File = null; _pendingImg15File = null;
  removeImg('5'); removeImg('15');
}

// ─── UTILS ─────────────────────────────────────────────────────────────────
function cleanPath(p) {
  if (!p) return '';
  return p.trim().replace(/^["'«»\u201C\u201D\u2018\u2019]+|["'«»\u201C\u201D\u2018\u2019]+$/g, '').trim();
}
// Accepte "." et "," comme séparateur décimal
function parseNum(v) {
  if (v === undefined || v === null || v === '') return NaN;
  return parseFloat(String(v).replace(',', '.'));
}
function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Agrège commentaire général + commentaire niveaux (TP/SL/Entrée) en un seul bloc HTML.
// Si les deux sont renseignés : deux sous-sections titrées. Si un seul : affiché sans titre.
function _noteSectionsHtml(note, noteLevels) {
  const n = (note||'').trim(), nl = (noteLevels||'').trim();
  if (!n && !nl) return '';
  if (n && nl) {
    return `<div class="note-section"><div class="note-section-lbl">Général</div><div class="note-section-txt">${escHtml(n)}</div></div>`
         + `<div class="note-section"><div class="note-section-lbl">Niveaux (TP / SL / Entrée)</div><div class="note-section-txt">${escHtml(nl)}</div></div>`;
  }
  return `<div class="note-section-txt">${escHtml(n || nl)}</div>`;
}
// Encode un chemin Windows pour l'injecter sans risque dans un onclick="viewImg('...')"
// \r, \t, \n etc. corrompent le path → on double tous les backslashes
function jsPath(p) {
  return "'" + cleanPath(p).replace(/\\/g, '\\\\') + "'";
}
// Formatage des prix — conserve les 2 décimales (553.70 → "553.70")
function smartDecimals(price) {
  const abs = Math.abs(+price);
  if (abs === 0)      return 2;
  if (abs >= 10000)   return 0;  // BTC ~94k → 0 décimale
  if (abs >= 1000)    return 2;  // ETH ~3500 → 2 décimales
  if (abs >= 100)     return 2;  // SOL ~150 → 2 décimales
  if (abs >= 10)      return 3;  // LINK ~14 → 3 décimales
  if (abs >= 1)       return 4;  // ADA ~0.45 → 4 décimales
  if (abs >= 0.1)     return 5;
  if (abs >= 0.01)    return 6;
  return 8;                      // très petits prix (SHIB, etc.)
}
function fmtPrice(n) {
  if (n === null || n === undefined || isNaN(+n)) return '–';
  n = +n;
  if (n === 0) return '0.00';
  return n.toFixed(smartDecimals(n));
}
function brTag(v) {
  if (v === 'Y') return '<span class="tag tag-win">OUI</span>';
  if (v === 'E') return '<span class="tag tag-eq">EQ</span>';
  return '<span class="tag" style="background:rgba(255,255,255,0.05);color:var(--text2);border:1px solid rgba(255,255,255,0.08)">NON</span>';
}
// brTagDir : colore en vert si le breakout est favorable pour la direction, rouge sinon
// LONG : High=Y → vert, Low=Y → rouge  |  SHORT : Low=Y → vert, High=Y → rouge
function brTagDir(v, field, dir) {
  const goodWhenY = (dir === 'LONG') ? (field === 'high') : (field === 'low');
  const isGood    = (v === 'Y') ? goodWhenY : !goodWhenY;
  const color     = isGood ? 'var(--green)' : 'var(--red)';
  const bg        = isGood ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
  const border    = isGood ? 'rgba(16,185,129,0.3)'  : 'rgba(239,68,68,0.3)';
  const label     = v === 'Y' ? 'OUI' : v === 'E' ? 'EQ' : 'NON';
  return `<span class="tag" style="color:${color};background:${bg};border:1px solid ${border}">${label}</span>`;
}
function brColor(v) {
  if (v === 'Y') return 'var(--green)';
  if (v === 'E') return 'var(--yellow)';
  return 'var(--text3)';
}
function brLabel(v) {
  if (v === 'Y') return 'Oui ✓';
  if (v === 'E') return 'Equal =';
  return 'Non ✗';
}
function cryptoIconUrl(ticker) {
  const t = (ticker || '').toLowerCase().replace(/usdt|busd|usd$/,'').replace(/\/.*$/,'');
  return `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/32/color/${t}.png`;
}

// ─── DURATION ──────────────────────────────────────────────────────────────
function calcDuration() {
  const s = document.getElementById('f_time').value;
  const e = document.getElementById('f_time_end').value;
  const el = document.getElementById('prev_dur');
  if (s && e) {
    const [sh,sm] = s.split(':').map(Number);
    const [eh,em] = e.split(':').map(Number);
    let mins = (eh*60+em) - (sh*60+sm);
    if (mins < 0) mins += 1440;
    el.textContent = mins < 60 ? mins+'min' : Math.floor(mins/60)+'h'+(mins%60>0?String(mins%60).padStart(2,'0'):'');
    el.style.color = 'var(--text)';
  } else { el.textContent = '–'; el.style.color = 'var(--text2)'; }
}

// ─── RISK FROM ENTRY+SL ────────────────────────────────────────────────────
function calcRisk() {
  const buy = parseNum(document.getElementById('f_buy').value);
  const sl  = parseNum(document.getElementById('f_sl').value);
  const el  = document.getElementById('prev_risk');
  if (!isNaN(buy) && !isNaN(sl) && buy > 0 && sl > 0 && buy !== sl) {
    el.textContent = (Math.abs((buy-sl)/buy)*100).toFixed(2)+'%';
    el.style.color = 'var(--yellow)';
    // Auto-détecter la direction
    const dir = sl < buy ? 'LONG' : 'SHORT';
    const dirEl = document.getElementById('f_dir');
    if (dirEl) dirEl.value = dir;
    const dirDisplay = document.getElementById('f_dir_display');
    if (dirDisplay) {
      dirDisplay.textContent = dir === 'LONG' ? '▲ LONG' : '▼ SHORT';
      dirDisplay.style.color = dir === 'LONG' ? 'var(--green)' : 'var(--red)';
    }
  } else { el.textContent = '–'; el.style.color = 'var(--text2)'; }
}

// ─── P&L CALC ──────────────────────────────────────────────────────────────
function calcPnl() {
  const buy    = parseNum(document.getElementById('f_buy').value);
  const sell   = parseNum(document.getElementById('f_sell').value);
  const sl     = parseNum(document.getElementById('f_sl').value);
  const amtIn  = parseNum(document.getElementById('f_amount_in').value);
  const amtOut = parseNum(document.getElementById('f_amount_out').value);
  const dir    = document.getElementById('f_dir').value;

  const dolEl  = document.getElementById('prev_pnl_dollar');
  const pctEl  = document.getElementById('prev_pnlpct');
  const rrEl   = document.getElementById('prev_rr');

  let pnlDollar=null, pnlPct=null, rrReal=null;
  const riskPctCalc = (!isNaN(buy) && !isNaN(sl) && buy>0) ? Math.abs((buy-sl)/buy)*100 : 0;

  let _estimated = false;
  if (!isNaN(amtIn) && !isNaN(amtOut) && amtIn>0) {
    pnlDollar = dir === 'SHORT' ? amtIn - amtOut : amtOut - amtIn;
    // HL import : amtIn = notionnel → lev=1 ; Manuel : amtIn = marge → lev = levier réel
    const _isHL1 = !!(document.getElementById('f_hl_id')?.value);
    const _lev1 = (!_isHL1 && _calcValues && _calcValues.leverage > 1) ? _calcValues.leverage : 1;
    pnlPct    = (pnlDollar / (amtIn / _lev1)) * 100;
    if (riskPctCalc > 0) rrReal = pnlDollar / (amtIn * _lev1 * riskPctCalc / 100);
  } else if (!isNaN(buy) && !isNaN(sell) && buy>0) {
    pnlPct = dir==='LONG' ? ((sell-buy)/buy)*100 : ((buy-sell)/buy)*100;
    if (riskPctCalc > 0) rrReal = pnlPct / riskPctCalc;
  } else if (_calcValues && _calcValues.tp && _calcValues.qty && _calcValues.entry) {
    // P&L estimé net de frais : résultat si le TP est touché
    const lev = _calcValues.leverage || 1;
    pnlDollar  = _calcValues.gainNet != null
      ? _calcValues.gainNet   // calculateur a déjà soustrait les frais
      : (dir === 'LONG'
          ? (_calcValues.tp - _calcValues.entry) * _calcValues.qty
          : (_calcValues.entry - _calcValues.tp) * _calcValues.qty);
    const amtInEst = (_calcValues.qty * _calcValues.entry) / lev;
    pnlPct  = _calcValues.pnlPctEst != null ? _calcValues.pnlPctEst : (amtInEst > 0 ? (pnlDollar / amtInEst) * 100 : null);
    rrReal  = _calcValues.rrNet     != null ? _calcValues.rrNet     : (riskPctCalc > 0 ? pnlDollar / (amtInEst * riskPctCalc / 100) : null);
    _estimated = true;
  }

  const setEl = (el, val, unit, decimals=2) => {
    if (val!==null) {
      el.textContent = (_estimated ? '~ ' : '') + (val>=0?'+':'') + val.toFixed(decimals) + unit;
      el.style.color = val>=0 ? 'var(--green)' : 'var(--red)';
      el.style.opacity = _estimated ? '0.65' : '1';
    } else {
      el.textContent='–'; el.style.color='var(--text2)'; el.style.opacity='1';
    }
  };
  setEl(dolEl, pnlDollar, ' $');
  if(pnlDollar!==null){ const _dv=dolEl.textContent; dolEl.innerHTML=`<span data-pnl-px data-v="${_dv}" data-p="${pnlDollar>=0?1:0}">${_dv}</span>`; }
  setEl(pctEl, pnlPct,    '%');
  setEl(rrEl,  rrReal,    'R');
}

// ─── TOAST ─────────────────────────────────────────────────────────────────
function _showToast(msg, durationMs = 3500) {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed', bottom: '84px', right: '24px', zIndex: '9999',
    background: 'rgba(10,11,30,0.95)',
    border: '1px solid rgba(124,58,237,0.3)',
    color: 'var(--text)', padding: '10px 16px', borderRadius: '12px',
    fontSize: '13px', fontWeight: '600', letterSpacing: '.2px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
    backdropFilter: 'blur(10px)',
    animation: 'fadeInUp .25s ease',
    pointerEvents: 'none',
  });
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .35s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, durationMs);
}

// ─── AUTO-UPDATE PORTFOLIO ─────────────────────────────────────────────────
async function _autoUpdatePortfolio(tradeDate) {
  /** Récupère le solde live et l'enregistre pour la date de clôture du trade.
   *  Silencieux si le bot est éteint. */
  try {
    const resp = await fetch('http://127.0.0.1:8000/balance',
      { signal: AbortSignal.timeout(3000) });
    const data = await resp.json();
    if (!data.ok || data.balance == null) return;
    const val = +data.balance.toFixed(2);
    // Écraser l'entrée du jour si elle existe, sinon en ajouter une
    portfolioPoints = portfolioPoints.filter(p => p.date !== tradeDate);
    portfolioPoints.push({ date: tradeDate, value: val });
    portfolioPoints.sort((a, b) => a.date.localeCompare(b.date));
    savePortfolio();
    renderPortfolioChart();
    const fmt = val.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    _showToast(`📈 Solde mis à jour · $${fmt}`);
  } catch {
    // Bot hors-ligne → skip silencieux, aucune erreur affichée
  }
}

// ─── SAVE TRADE ────────────────────────────────────────────────────────────
function saveTrade() {
  const buy    = parseNum(document.getElementById('f_buy').value);
  const sell   = parseNum(document.getElementById('f_sell').value);
  const sl     = parseNum(document.getElementById('f_sl').value);
  const amtIn  = parseNum(document.getElementById('f_amount_in').value);
  const amtOut = parseNum(document.getElementById('f_amount_out').value);
  const dir    = document.getElementById('f_dir').value;

  if (isNaN(buy) || !buy) { alert("Renseigne au moins le prix d'entrée."); return; }

  let pnlDollar=null, pnlPct=null, riskPct=0, rrReal=null;
  if (!isNaN(sl) && buy>0) riskPct = Math.abs((buy-sl)/buy)*100;
  if (!isNaN(amtIn) && !isNaN(amtOut) && amtIn>0) {
    pnlDollar = dir==='SHORT' ? amtIn-amtOut : amtOut-amtIn;
    const _isHL2 = !!(document.getElementById('f_hl_id')?.value);
    const _lev2 = (!_isHL2 && _calcValues && _calcValues.leverage > 1) ? _calcValues.leverage : 1;
    pnlPct    = (pnlDollar / (amtIn / _lev2)) * 100;
    if (riskPct > 0) rrReal = pnlDollar / (amtIn * _lev2 * riskPct / 100);
  } else if (!isNaN(sell) && sell && buy>0) {
    pnlPct = dir==='LONG' ? ((sell-buy)/buy)*100 : ((buy-sell)/buy)*100;
    if (riskPct > 0) rrReal = pnlPct / riskPct;
  } else if (document.getElementById('f_is_idea')?.checked &&
             _calcValues && _calcValues.tp && _calcValues.qty && _calcValues.entry) {
    // Idée : P&L estimé net de frais, exclu des stats via isIdea
    const lev = _calcValues.leverage || 1;
    pnlDollar = _calcValues.gainNet != null
      ? _calcValues.gainNet
      : (dir === 'LONG'
          ? (_calcValues.tp - _calcValues.entry) * _calcValues.qty
          : (_calcValues.entry - _calcValues.tp) * _calcValues.qty);
    const amtInEst = (_calcValues.qty * _calcValues.entry) / lev;
    pnlPct = _calcValues.pnlPctEst != null ? _calcValues.pnlPctEst : (amtInEst > 0 ? (pnlDollar / amtInEst) * 100 : null);
    rrReal = _calcValues.rrNet     != null ? _calcValues.rrNet     : (riskPct > 0 ? pnlDollar / (amtInEst * riskPct / 100) : null);
  }

  const ts=document.getElementById('f_time').value, te=document.getElementById('f_time_end').value;
  let durMins=null;
  if (ts && te) { const [sh,sm]=ts.split(':').map(Number),[eh,em]=te.split(':').map(Number); durMins=(eh*60+em)-(sh*60+sm); if(durMins<0) durMins+=1440; }

  const trade = {
    id:        editingId || Date.now(),
    ticker:    (document.getElementById('f_ticker').value||'–').toUpperCase(),
    date:      document.getElementById('f_date').value,
    time:      ts, timeEnd: te,
    dur:       durMins,
    dir,
    buy,
    sl:        isNaN(sl)   ? null : sl,
    sell:      isNaN(sell) ? null : sell,
    amtIn:     isNaN(amtIn)  ? null : amtIn,
    amtOut:    isNaN(amtOut) ? null : amtOut,
    pnlDollar: pnlDollar!==null ? +pnlDollar.toFixed(2) : null,
    pnlPct:    pnlPct!==null    ? +pnlPct.toFixed(3)    : null,
    risk:      +riskPct.toFixed(3),
    leverage:  _calcValues.leverage  ?? null,
    realRisk:  _calcValues.realRisk  ?? null,
    rrTarget:  parseNum(document.getElementById('f_rr').value)||1.4,
    rrReal:    rrReal!==null ? +rrReal.toFixed(3) : null,
    lowBr:     document.getElementById('f_lowbr').value,
    highBr:    document.getElementById('f_highbr').value,
    img5:      _pendingImg5 ? 'idb' : (_pendingImg5 === null && editingId ? (trades.find(x=>x.id===editingId)||{}).img5||'' : ''),
    img15:     _pendingImg15 ? 'idb' : (_pendingImg15 === null && editingId ? (trades.find(x=>x.id===editingId)||{}).img15||'' : ''),
    title:       document.getElementById('f_title')?.value.trim() || '',
    setupGrade:  document.getElementById('f_grade')?.value || '',
    note:      document.getElementById('f_note').value.trim(),
    noteLevels: document.getElementById('f_note_levels')?.value.trim() || '',
    hl_id:     document.getElementById('f_hl_id')?.value || undefined,
    isIdea:    document.getElementById('f_is_idea')?.checked || false,
    isPaper:   document.getElementById('f_is_paper')?.checked || false,
    reviewed:  editingId ? !!(trades.find(x=>x.id===editingId)?.reviewed) : false,
    reviewAgain: editingId ? !!(trades.find(x=>x.id===editingId)?.reviewAgain) : false,
    reviewComment: editingId ? (trades.find(x=>x.id===editingId)?.reviewComment || '') : '',
    reviewGrade: editingId ? (trades.find(x=>x.id===editingId)?.reviewGrade || '') : '',
  };

  if (editingId) {
    const idx=trades.findIndex(t=>t.id===editingId); if(idx>-1) trades[idx]=trade; editingId=null;
    if (_pendingImg5  !== null) { if (_pendingImg5)  saveIdbImage(trade.id+'_img5',  _pendingImg5); else deleteIdbImage(trade.id+'_img5');  trade.img5  = _pendingImg5  ? 'idb' : ''; }
    if (_pendingImg15 !== null) { if (_pendingImg15) saveIdbImage(trade.id+'_img15', _pendingImg15); else deleteIdbImage(trade.id+'_img15'); trade.img15 = _pendingImg15 ? 'idb' : ''; }
  } else {
    trades.unshift(trade);
    const savedId = trade.id;
    if (_pendingImg5)  saveIdbImage(savedId + '_img5',  _pendingImg5);
    if (_pendingImg15) saveIdbImage(savedId + '_img15', _pendingImg15);
  }
  const _f5 = _pendingImg5File, _f15 = _pendingImg15File;
  const _rrVal = document.getElementById('f_rr')?.value;
  if (_rrVal) localStorage.setItem('tjournal_rr', _rrVal);
  save(); renderTable(); resetForm();
  // Supprime du disque les screenshots chargés via "Dernier"
  if (_f5 || _f15) {
    [_f5, _f15].filter(Boolean).forEach(fn => {
      fetch('http://127.0.0.1:8000/screenshots/delete_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fn }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => {});
    });
  }
  // Mise à jour automatique du portefeuille uniquement sur trade clôturé (sell ou amtOut renseigné)
  const _isClosed = (trade.sell != null || trade.amtOut != null) && !trade.isIdea;
  if (_isClosed) _autoUpdatePortfolio(trade.date);
}

// ── Sélecteur de ticker custom ───────────────────────────────────────────────
// Liste + couleur de marque de chaque ticker. Pour en ajouter un : une ligne ici,
// le rendu du menu et la synchro suivent automatiquement.
const TICKER_OPTIONS = [
  { s: 'BTC',  c: '#f7931a' },
  { s: 'ETH',  c: '#8b9ef5' },
  { s: 'SOL',  c: '#c084fc' },
  { s: 'HYPE', c: '#50d2c1' },
  { s: 'TAO',  c: '#6ee7ff' },
  { s: 'XRP',  c: '#c9d3dd' },
  { s: 'LINK', c: '#3b6cf0' },
  { s: 'ADA',  c: '#4fa3ff' },
  { s: 'DOGE', c: '#d4b73f' },
  { s: 'BNB',  c: '#f3ba2f' },
  { s: 'PUMP', c: '#4ade80' },
];
const _tickerColor = (sym) => (TICKER_OPTIONS.find(o => o.s === sym)?.c) || '#8a93a3';

function renderTickerDD() {
  const panel = document.getElementById('ticker_dd_panel');
  if (!panel) return;
  panel.innerHTML = TICKER_OPTIONS.map(o =>
    `<button type="button" class="ticker-opt" role="option" data-ticker="${o.s}" `
    + `style="--dot:${o.c}" onclick="pickTicker('${o.s}')">`
    + `<span class="ticker-dot"></span>${o.s}</button>`
  ).join('');
}

function toggleTickerDD(force) {
  const dd = document.getElementById('ticker_dd');
  if (!dd) return;
  const open = force != null ? force : !dd.classList.contains('open');
  dd.classList.toggle('open', open);
  document.getElementById('ticker_dd_trigger')?.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function pickTicker(val) {
  setTicker(val);
  toggleTickerDD(false);
}

// Ferme le menu au clic extérieur ou sur Échap
document.addEventListener('click', (e) => {
  const dd = document.getElementById('ticker_dd');
  if (dd && dd.classList.contains('open') && !dd.contains(e.target)) toggleTickerDD(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleTickerDD(false); });

function setTicker(val) {
  const el = document.getElementById('f_ticker');
  if (!el) return;
  el.value = val;
  syncTickerChips();
}
function syncTickerChips() {
  const val = (document.getElementById('f_ticker')?.value || '').toUpperCase().trim();
  document.querySelectorAll('.ticker-btn').forEach(c => c.classList.toggle('active', c.dataset.ticker === val));
  // Reflète f_ticker dans le sélecteur custom : pastille de couleur + libellé sur
  // le déclencheur, et coche sur l'option correspondante. Un ticker importé hors
  // de la liste (ex. depuis les fills Hyperliquid) s'affiche avec une couleur
  // neutre — comme les anciens boutons qui ne s'allumaient simplement pas.
  const dd = document.getElementById('ticker_dd');
  if (!dd) return;
  dd.classList.toggle('has-value', !!val);
  const cur = document.getElementById('ticker_dd_current');
  if (cur) {
    cur.style.setProperty('--dot', val ? _tickerColor(val) : '');
    const lab = cur.querySelector('.ticker-dd-label');
    if (lab) lab.textContent = val || 'Choisir…';
  }
  dd.querySelectorAll('.ticker-opt').forEach(o => o.classList.toggle('selected', o.dataset.ticker === val));
}

// Rendu initial du menu + synchro (une fois le DOM prêt)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { renderTickerDD(); syncTickerChips(); });
} else {
  renderTickerDD();
  syncTickerChips();
}

// ── Widget : Top événements crypto (CoinMarketCal) ───────────────────────────
function _evtEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g,
    m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}
function _evtSrcSlug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function _evtRelTime(ts) {
  if (!ts) return '';
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 60)  return "à l'instant";
  const m = Math.floor(sec / 60); if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);   if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);   return `il y a ${d} j`;
}
function toggleEvtPopover(force) {
  const fab = document.getElementById('evtFab');
  if (!fab) return;
  const open = force != null ? force : !fab.classList.contains('open');
  fab.classList.toggle('open', open);
  fab.querySelector('.evt-fab-trigger')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) loadTopEvents();   // rafraîchit le fil dès l'ouverture (news au plus frais)
}
// Ferme le popover au clic extérieur ou sur Échap
document.addEventListener('click', (e) => {
  const fab = document.getElementById('evtFab');
  if (fab && fab.classList.contains('open') && !fab.contains(e.target)) toggleEvtPopover(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleEvtPopover(false); });

async function loadTopEvents() {
  const fab   = document.getElementById('evtFab');
  const list  = document.getElementById('evt-list');
  const upd   = document.getElementById('evt-updated');
  if (!fab || !list) return;
  try {
    // Timeout large : un refresh (toutes les 3 h) génère le résumé LLM local,
    // ce qui peut prendre plusieurs dizaines de secondes avec un modèle 7B en CPU.
    const r = await fetch('http://127.0.0.1:8000/events/top', { signal: AbortSignal.timeout(75000) });
    const d = await r.json();
    // Clé API non configurée → on masque simplement le bouton (pas d'erreur bruyante)
    if (d.disabled) { fab.style.display = 'none'; return; }
    const allEvents = d.events || [];
    if (!d.ok && !allEvents.length) { fab.style.display = 'none'; return; }
    const _readSet = _evtReadSet();
    const events = allEvents.filter(e => !_readSet.has(e.url));
    const _dot = document.getElementById('evt-fab-dot');
    if (_dot) _dot.style.display = events.length ? 'block' : 'none';   // pastille non-lus
    if (!events.length) {
      fab.style.display = 'block';
      list.innerHTML = allEvents.length
        ? '<div class="evt-empty">Tout est lu ✓</div>'
        : '<div class="evt-empty">Aucune actu à afficher pour le moment.</div>';
      if (upd) upd.textContent = '';
      return;
    }
    list.innerHTML = events.map((e) => {
      const src  = e.source || '';
      const slug = _evtSrcSlug(src);
      const rel  = _evtRelTime(e.ts);
      const url  = e.url || '';
      const open = url
        ? `<a class="evt-open" href="${_evtEsc(url)}" target="_blank" rel="noopener noreferrer" title="Ouvrir l'article dans un onglet">article ↗</a>`
        : '';
      const sumBtn = url
        ? `<button type="button" class="evt-sum-btn" onclick="toggleNewsSummary(this)">✦ Résumé</button>`
        : '';
      return `<div class="evt-item" data-src="${slug}" data-url="${_evtEsc(url)}">`
        + `<div class="evt-main">`
        +   `<div class="evt-title">${_evtEsc(e.title)}</div>`
        +   `<div class="evt-meta"><span class="evt-kind">${_evtEsc(src)}</span>`
        +     (rel ? `<span class="evt-time">${_evtEsc(rel)}</span>` : '') + `</div>`
        +   `<div class="evt-actions">${sumBtn}${open}<button type="button" class="evt-read-btn" onclick="markNewsRead(this,event)" title="Marquer comme lu (retire du fil)">✓ lu</button></div>`
        +   `<div class="evt-sum-out" style="display:none"></div>`
        + `</div></div>`;
    }).join('');
    fab.style.display = 'block';
    if (upd) {
      const suffix = d.stale ? ' · cache' : '';
      upd.textContent = d.updated
        ? 'MàJ ' + new Date(d.updated * 1000).toLocaleDateString('fr-FR',
            { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + suffix
        : '';
    }
  } catch (err) {
    // Bot hors-ligne ou API injoignable : on masque le bouton sans casser le dashboard
    fab.style.display = 'none';
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadTopEvents);
} else {
  loadTopEvents();
}
// Rafraîchissement auto du fil toutes les 5 min (les news arrivent au fil de la
// journée). On saute le cycle si le popover est ouvert, pour ne pas couper la
// lecture ; les articles marqués lus restent masqués.
setInterval(() => {
  const fab = document.getElementById('evtFab');
  if (!fab || !fab.classList.contains('open')) loadTopEvents();
}, 5 * 60 * 1000);

// Résumé d'UNE news à la demande : le serveur récupère l'article + le résume
// via le LLM local, et on l'affiche en dépliant sous la news (aucun onglet).
async function toggleNewsSummary(btn) {
  const item = btn.closest('.evt-item');
  const out  = item && item.querySelector('.evt-sum-out');
  const url  = item && item.getAttribute('data-url');
  if (!out || !url) return;

  // Déjà chargé → simple bascule afficher/masquer
  if (out.dataset.loaded === '1') {
    out.style.display = (out.style.display === 'none') ? 'block' : 'none';
    return;
  }

  out.style.display = 'block';
  out.innerHTML = '<span class="evt-sum-load">Résumé en cours (IA locale)…</span>';
  btn.disabled = true;
  try {
    // Timeout large : fetch de l'article + inférence LLM (quelques secondes)
    const r = await fetch('http://127.0.0.1:8000/events/summarize?url=' + encodeURIComponent(url),
                          { signal: AbortSignal.timeout(90000) });
    const d = await r.json();
    if (d.ok && d.summary) {
      out.innerHTML = '<span class="evt-sum-label">✦ Résumé · IA locale</span>' + _evtEsc(d.summary);
      out.dataset.loaded = '1';
    } else {
      out.innerHTML = '<span class="evt-sum-err">Résumé indisponible'
        + (d.error ? ' — ' + _evtEsc(d.error) : '') + '</span>';
    }
  } catch (err) {
    out.innerHTML = '<span class="evt-sum-err">Résumé indisponible (bot ou IA locale hors-ligne).</span>';
  } finally {
    btn.disabled = false;
  }
}

// Synthèse du jour : analyse de plusieurs articles → paragraphes thématiques
// avec sources cliquables. À la demande, mis en cache côté serveur.
async function toggleNewsDigest(btn) {
  const out = document.getElementById('evt-digest');
  if (!out) return;
  // Ouvert → on referme
  if (out.dataset.open === '1') { out.style.display = 'none'; out.dataset.open = '0'; return; }
  out.dataset.open = '1';
  out.style.display = 'block';

  // Articles NON LUS = ceux actuellement affichés dans le fil
  const urls = [...document.querySelectorAll('#evt-list .evt-item')]
    .map(it => it.getAttribute('data-url')).filter(Boolean);
  if (!urls.length) {
    out.innerHTML = '<div class="evt-empty">Rien à résumer — tout est lu ✓</div>';
    return;
  }

  out.innerHTML = '<div class="evt-digest-load">Analyse des articles non lus… (IA locale, ~15-40 s)</div>';
  btn.disabled = true;
  try {
    const r = await fetch('http://127.0.0.1:8000/events/digest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }), signal: AbortSignal.timeout(180000),
    });
    const d = await r.json();
    if (d.ok && d.paragraphs && d.paragraphs.length) {
      out.innerHTML = d.paragraphs.map(p => {
        const srcs = (p.sources || []).map(s => {
          const full = s.title || s.source || '';
          const t = full.length > 44 ? full.slice(0, 44) + '…' : full;
          return `<a class="evt-digest-src" href="${_evtEsc(s.url)}" target="_blank" rel="noopener noreferrer" title="${_evtEsc(full)}">${_evtEsc(t)} <span class="evt-digest-src-med">${_evtEsc(s.source)}</span> ↗</a>`;
        }).join('');
        return `<div class="evt-digest-para">`
          + (p.theme ? `<div class="evt-digest-theme">${_evtEsc(p.theme)}</div>` : '')
          + `<div class="evt-digest-text">${_evtEsc(p.text)}</div>`
          + `<div class="evt-digest-foot">`
          +   `<div class="evt-digest-srcs">${srcs}</div>`
          +   `<button type="button" class="evt-read-btn" onclick="markDigestRead(this,event)" title="Marquer comme lu (retire aussi les articles du fil)">✓ lu</button>`
          + `</div></div>`;
      }).join('');
    } else {
      out.innerHTML = '<div class="evt-sum-err">Résumé indisponible'
        + (d.error ? ' — ' + _evtEsc(d.error) : '') + '</div>';
    }
  } catch (err) {
    out.innerHTML = '<div class="evt-sum-err">Résumé indisponible (bot ou IA locale hors-ligne).</div>';
  } finally {
    btn.disabled = false;
  }
}

// ── Articles lus : masqués du fil, mémorisés dans localStorage ───────────────
const _EVT_READ_KEY = 'tjournal_news_read';
function _evtReadSet() {
  try { return new Set(JSON.parse(localStorage.getItem(_EVT_READ_KEY) || '[]')); }
  catch (e) { return new Set(); }
}
function _evtSaveRead(set) {
  // borne à 300 URLs (les actus tournent, inutile de garder plus)
  try { localStorage.setItem(_EVT_READ_KEY, JSON.stringify([...set].slice(-300))); } catch (e) {}
}
function _evtUpdateDot() {
  const dot = document.getElementById('evt-fab-dot');
  const list = document.getElementById('evt-list');
  if (dot) dot.style.display = (list && list.querySelector('.evt-item')) ? 'block' : 'none';
}
function markNewsRead(btn, ev) {
  if (ev) ev.stopPropagation();   // sinon le retrait de l'item ferme le popover
  const item = btn.closest('.evt-item'); if (!item) return;
  const url = item.getAttribute('data-url');
  if (url) { const s = _evtReadSet(); s.add(url); _evtSaveRead(s); }
  item.remove();
  const list = document.getElementById('evt-list');
  if (list && !list.querySelector('.evt-item')) {
    list.innerHTML = '<div class="evt-empty">Tout est lu ✓</div>';
  }
  _evtUpdateDot();
}
// Marque un paragraphe du résumé comme lu : retire ses articles sources du fil
// (même état "lu"), et le paragraphe ne réapparaîtra plus au prochain chargement.
function markDigestRead(btn, ev) {
  if (ev) ev.stopPropagation();   // sinon le retrait du paragraphe ferme le popover
  const para = btn.closest('.evt-digest-para'); if (!para) return;
  const urls = [...para.querySelectorAll('.evt-digest-src')].map(a => a.getAttribute('href')).filter(Boolean);
  if (urls.length) {
    const s = _evtReadSet();
    urls.forEach(u => s.add(u));
    _evtSaveRead(s);
    // retire aussi ces articles du fil en direct
    document.querySelectorAll('#evt-list .evt-item').forEach(it => {
      if (urls.includes(it.getAttribute('data-url'))) it.remove();
    });
    const list = document.getElementById('evt-list');
    if (list && !list.querySelector('.evt-item')) list.innerHTML = '<div class="evt-empty">Tout est lu ✓</div>';
  }
  para.remove();
  const dig = document.getElementById('evt-digest');
  if (dig && !dig.querySelector('.evt-digest-para')) dig.innerHTML = '<div class="evt-empty">Résumé du jour lu ✓</div>';
  _evtUpdateDot();
}

function resetForm() {
  editingId = null;
  ['f_ticker','f_title','f_buy','f_sl','f_sell','f_time_end','f_note','f_note_levels','f_amount_in','f_amount_out','f_hl_id'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('f_rr').value = localStorage.getItem('tjournal_rr') || '1.4';
  resetImgZones();
  document.getElementById('f_dir').value='LONG'; document.getElementById('f_lowbr').value='N'; document.getElementById('f_highbr').value='N';
  const dirDisplayEl = document.getElementById('f_dir_display');
  if (dirDisplayEl) { dirDisplayEl.textContent = '—'; dirDisplayEl.style.color = 'var(--text2)'; }
  const now=new Date(); document.getElementById('f_date').value=now.toISOString().slice(0,10); document.getElementById('f_time').value=now.toTimeString().slice(0,5);
  document.getElementById('prev_dur').textContent='–'; document.getElementById('prev_risk').textContent='–';
  const cp = document.getElementById('custom_paste'); if (cp) cp.value = '';
  const cf = document.getElementById('custom_feedback'); if (cf) cf.innerHTML = '';
  // Réinitialiser les feedbacks ordre/cancel
  const pof = document.getElementById('place_order_feedback'); if (pof) pof.textContent = '';
  const cof = document.getElementById('cancel_orders_feedback'); if (cof) cof.textContent = '';
  setGrade('');
  const ideaCb = document.getElementById('f_is_idea'); if (ideaCb) ideaCb.checked = false;
  toggleIdeaStyle();
  const paperCb = document.getElementById('f_is_paper'); if (paperCb) paperCb.checked = journalMode === 'paper';
  togglePaperStyle();
  calcPosition();
  calcPnl();
  syncTickerChips();
  resetCandleHelper();
}

// Affiche/masque le bouton "À revoir" et son compteur selon le nombre de
// trades flaggés reviewAgain dans le mode réel/paper actif — mis à jour à
// chaque rendu de table pour rester synchro avec reviewMarkAndNext().
function _updateReviewAgainBtn() {
  const btn = document.getElementById('reviewAgainBtn');
  if (!btn) return;
  const count = _applyModeFilter(trades).filter(t => !!t.reviewAgain).length;
  document.getElementById('reviewAgainCount').textContent = count;
  btn.style.display = count > 0 ? '' : 'none';
}

// ─── TABLE RENDER ──────────────────────────────────────────────────────────
function renderTable() {
  _updateReviewAgainBtn();
  const tbody=document.getElementById('tradeTbody');
  // Apply type filter (pris vs idées) + tri par date décroissante
  const typeList = _applyReviewFilter(_applyModeFilter(_applyTypeFilter(trades))).slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  if (!typeList.length) {
    tbody.innerHTML=`<tr><td colspan="21"><div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><p>${trades.length ? 'Aucun trade de ce type' : 'Aucun trade enregistré'}</p></div></td></tr>`;
    return;
  }
  // Numérotation chronologique : trade le plus ancien = #1
  const _chronoRank = new Map(
    trades.filter(t => !t._isComment).slice()
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
      .map((t, i) => [t.id, i + 1])
  );
  // ── Stats par jour (pour afficher dans le séparateur) ──────────────────────
  const _dayStats = {};
  typeList.forEach(t => {
    if (t._isComment) { _dayStats[t.date] = _dayStats[t.date] || { count:0, pnl:0, hasPnl:false, wins:0, losses:0 }; return; }
    const ds = _dayStats[t.date] || (_dayStats[t.date] = { count:0, pnl:0, hasPnl:false, wins:0, losses:0 });
    ds.count++;
    if (t.pnlDollar !== null) {
      ds.pnl += t.pnlDollar; ds.hasPnl = true;
      if (t.pnlDollar > 0) ds.wins++; else if (t.pnlDollar < 0) ds.losses++;
    }
  });
  const _dayFmt = dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  };
  const _daySep = dateStr => {
    const s = _dayStats[dateStr];
    const wl   = (s.wins || s.losses) ? `<span style="color:var(--text2)">${s.wins}W&nbsp;/&nbsp;${s.losses}L</span>` : '';
    const pnl  = s.hasPnl ? `<span class="${s.pnl>=0?'pos':'neg'}" data-pnl-px data-v="${s.pnl>=0?'+':''}${s.pnl.toFixed(2)} $" data-p="${s.pnl>=0?1:0}" style="font-weight:700">${s.pnl>=0?'+':''}${s.pnl.toFixed(2)}&nbsp;$</span>` : '';
    const nb   = `<span style="color:var(--text2)">${s.count} trade${s.count>1?'s':''}</span>`;
    return `<tr class="day-sep"><td colspan="21"><div style="display:flex;align-items:center;justify-content:space-between"><span class="day-sep-label">${_dayFmt(dateStr)}</span><div class="day-sep-stats">${nb}${wl}${pnl}</div></div></td></tr>`;
  };
  tbody.innerHTML = typeList.map((t,i) => {
    const sep = (i===0 || typeList[i-1].date !== t.date) ? _daySep(t.date) : '';
    if (t._isComment) {
      return sep + `<tr class="tr-comment${t.reviewed?' tr-reviewed':''}" onclick="openCommentPreview(${t.id})" style="cursor:pointer">
        <td colspan="20" style="color:var(--text2);max-width:0">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:min(800px,70vw)">
            <span style="opacity:.5;margin-right:7px;font-style:normal">💬</span>${escHtml(t.text)}
          </div>
        </td>
        <td onclick="event.stopPropagation()" style="white-space:nowrap;text-align:center">
          <button class="btn btn-sm btn-review${t.reviewed?' done':''}" style="cursor:pointer;padding:5px 8px" onclick="toggleCommentReviewedInRow(${t.id})" title="${t.reviewed?'Reviewé — cliquer pour annuler':'Marquer comme reviewé'}"><svg width="13" height="13" viewBox="0 0 24 24" fill="${t.reviewed?'currentColor':'none'}" stroke="${t.reviewed?'rgba(255,255,255,0.9)':'currentColor'}" stroke-width="2" style="vertical-align:middle;display:block"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="${t.reviewed?'rgba(255,255,255,0.25)':'none'}"/></svg></button>
          <button class="btn btn-secondary btn-sm" style="cursor:pointer;margin-left:4px" onclick="editCommentById(${t.id})">✏</button>
          <button class="btn btn-danger btn-sm" style="cursor:pointer;margin-left:4px" onclick="deleteComment(${t.id})">✕</button>
        </td>
      </tr>`;
    }
    const pnlVal = t.pnlDollar ?? t.pnlPct ?? null;
    const pnlCls = pnlVal === null ? '' : pnlVal >= 0 ? 'pos' : 'neg';
    const isWin  = pnlVal !== null && pnlVal > 0;
    const isLoss = pnlVal !== null && pnlVal < 0;
    const isIdea  = !!t.isIdea;
    const isReviewed = !!t.reviewed;
    const trCls   = (isIdea ? 'tr-idea' : isWin ? 'tr-win' : isLoss ? 'tr-loss' : '') + (isReviewed ? ' tr-reviewed' : '');
    const wlBadge = isIdea ? '<span class="wl-badge idea">💡</span>' : isWin ? '<span class="wl-badge w">W</span>' : isLoss ? '<span class="wl-badge l">L</span>' : '';
    const dirTag = t.dir==='LONG' ? '<span class="tag tag-long">LONG</span>' : '<span class="tag tag-short">SHORT</span>';
    const noteStr= (t.note || t.noteLevels || t.reviewComment || t.reviewGrade) ? `<span class="note-icon" data-note="${escHtml(t.note)}" data-note-levels="${escHtml(t.noteLevels)}" data-review-comment="${escHtml(t.reviewComment||'')}" data-review-grade="${escHtml(t.reviewGrade||'')}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>` : '<span style="color:var(--text2)">—</span>';
    const durStr = t.dur!==null && t.dur!==undefined ? (t.dur<60?t.dur+'min':Math.floor(t.dur/60)+'h'+(t.dur%60>0?String(t.dur%60).padStart(2,'0'):'')) : '–';
    const icon   = `<img class="crypto-icon" src="${cryptoIconUrl(t.ticker)}" onerror="this.style.display='none'" alt=""/>`;
    const pnlDolStr = t.pnlDollar!==null ? (t.pnlDollar>=0?'+':'')+t.pnlDollar.toFixed(2)+'$' : '–';
    const pnlDolHtml = t.pnlDollar!==null ? `<span data-pnl-px data-v="${pnlDolStr}" data-p="${t.pnlDollar>=0?1:0}">${pnlDolStr}</span>` : '–';
    const pnlPctStr = t.pnlPct!==null    ? (t.pnlPct>=0?'+':'')+t.pnlPct.toFixed(2)+'%'    : '–';
    let imgs='<div class="imgs-cell">';
    if (t.img5  === 'idb') imgs+=`<div class="img-thumb" onclick="event.stopPropagation();loadIdbImage(${t.id}+'_img5').then(d=>{if(d){const img=document.getElementById('imgZoomSrc');img.src=d;document.getElementById('imgZoom').classList.add('open');}});" title="Screenshot 1">1</div>`;
    else if (t.img5)       imgs+=`<div class="img-thumb" onclick="event.stopPropagation();viewImg(${jsPath(t.img5)})" title="Screenshot 1">1</div>`;
    if (t.img15 === 'idb') imgs+=`<div class="img-thumb" onclick="event.stopPropagation();loadIdbImage(${t.id}+'_img15').then(d=>{if(d){const img=document.getElementById('imgZoomSrc');img.src=d;document.getElementById('imgZoom').classList.add('open');}});" title="Screenshot 2">2</div>`;
    else if (t.img15)      imgs+=`<div class="img-thumb" onclick="event.stopPropagation();viewImg(${jsPath(t.img15)})" title="Screenshot 2">2</div>`;
    if (!t.img5 && !t.img15) imgs+='<span style="color:var(--text2)">—</span>';
    imgs+='</div>';
    const tradeNum = _chronoRank.get(t.id) ?? (i + 1);
    return sep + `<tr class="${trCls}" onclick="openModal(${t.id})">
      <td style="color:var(--text2);text-align:center">${tradeNum}${wlBadge}</td>
      <td>${t.date}<br><span style="color:var(--text2);font-size:10px">${t.time}${t.timeEnd?'→'+t.timeEnd:''}</span></td>
      <td style="max-width:160px"><div class="ticker-cell">${icon}<span style="min-width:0;overflow:hidden">${t.ticker}${t.title?`<br><span style="font-size:10px;font-style:italic;color:rgba(255,255,255,0.88);background:rgba(255,255,255,0.08);padding:1px 6px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);display:inline-block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px;margin-top:2px">${escHtml(t.title)}</span>`:''}</span></div></td>
      <td style="text-align:center">${gradeTag(t.setupGrade,'col')}</td>
      <td>${dirTag}</td>
      <td style="color:var(--text3);text-align:right">${durStr}</td>
      <td style="text-align:right">${fmtPrice(t.buy)}</td><td style="color:var(--red);text-align:right">${fmtPrice(t.sl)}</td><td style="text-align:right">${fmtPrice(t.sell)}</td>
      <td style="color:var(--text3);text-align:right">${t.amtIn!==null?t.amtIn+'$':'–'}</td>
      <td style="color:var(--text3);text-align:right">${t.amtOut!==null?t.amtOut+'$':'–'}</td>
      <td class="${pnlCls} td-pnl" style="font-weight:700;text-align:right">${pnlDolHtml}</td>
      <td class="${pnlCls}" style="text-align:right">${pnlPctStr}</td>
      <td style="color:var(--yellow);text-align:right">${t.risk?t.risk.toFixed(2)+'%':'–'}</td>
      <td style="text-align:center">${t.leverage ? `<span style="padding:1px 7px;border-radius:5px;background:rgba(245,158,11,0.13);border:1px solid rgba(245,158,11,0.3);color:var(--yellow);font-size:10px;font-weight:700">×${t.leverage}</span>` : '–'}</td>
      <td style="color:var(--yellow);font-weight:600;text-align:right">${t.realRisk!=null?t.realRisk.toFixed(2)+'%':'–'}</td>
      <td style="text-align:right">${t.rrTarget??'–'}</td>
      <td class="${pnlCls}" style="text-align:right">${t.rrReal!==null?(t.rrReal>=0?'+':'')+t.rrReal.toFixed(2)+'R':'–'}</td>
      <td onclick="event.stopPropagation()" style="text-align:center">${imgs}</td>
      <td style="text-align:center">${noteStr}</td>
      <td onclick="event.stopPropagation()" style="white-space:nowrap;text-align:center">
        <button class="btn btn-sm btn-review${isReviewed?' done':''}" style="cursor:pointer;padding:5px 8px" onclick="toggleReviewed(${t.id})" title="${isReviewed?'Reviewé — cliquer pour annuler':'Marquer comme reviewé'}"><svg width="13" height="13" viewBox="0 0 24 24" fill="${isReviewed?'currentColor':'none'}" stroke="${isReviewed?'rgba(255,255,255,0.9)':'currentColor'}" stroke-width="2" style="vertical-align:middle;display:block"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="${isReviewed?'rgba(255,255,255,0.25)':'none'}"/></svg></button>
        <button class="btn btn-secondary btn-sm" style="cursor:pointer;margin-left:4px" onclick="editTrade(${t.id})">✏</button>
        <button class="btn btn-danger btn-sm" style="cursor:pointer;margin-left:4px" onclick="deleteTrade(${t.id})">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ─── IMAGE VIEWER (same tab) ───────────────────────────────────────────────
function viewImg(path) {
  const url = 'file:///'+cleanPath(path).replace(/\\/g,'/');
  const img = document.getElementById('imgZoomSrc');
  img.src = url;
  img.onerror = () => { img.alt='Image introuvable'; };
  document.getElementById('imgZoom').classList.add('open');
}
function viewImgSrc(lbl) {
  const src = lbl === '5min' ? window._zoomImg5 : window._zoomImg15;
  if (!src) return;
  const img = document.getElementById('imgZoomSrc');
  img.src = src;
  document.getElementById('imgZoom').classList.add('open');
}
function closeZoom() { document.getElementById('imgZoom').classList.remove('open'); }

// ─── POMODORO (fenêtre séparée, app autonome apps/pomodoro/pomodoro.html) ──
// Fenêtre à part plutôt qu'overlay in-page : permet de garder le Pomodoro
// visible/utilisable en même temps que le reste de l'app (ex. mode Review),
// ce qu'un overlay plein écran empêchait par construction.
let _pomodoroWin = null;
function openPomodoroWindow() {
  if (_pomodoroWin && !_pomodoroWin.closed) { _pomodoroWin.focus(); return; }
  _pomodoroWin = window.open('../pomodoro/pomodoro.html', 'orbitPomodoro', 'width=420,height=640,resizable=yes');
}

document.addEventListener('keydown', e => { if (e.key==='Escape') { closeZoom(); closeModal(); closeCommentDialog(); closeCommentPreview(); } });
document.addEventListener('keydown', e => { if (e.key==='Enter' && e.ctrlKey && document.getElementById('comment-dialog').style.display==='flex') saveComment(); });

// ─── MODAL DÉTAIL ──────────────────────────────────────────────────────────
// Corps de fiche trade partagé entre la modale de détail (openModal) et le
// mode Review (file d'attente des non-reviewés) — icône/ticker/grade/titre/
// P&L, ligne date/durée/direction, screenshots, grille de champs, note.
// `opts.padRight`/`opts.padLeft` réservent l'espace pour les boutons
// positionnés en absolu par l'appelant (openModal en a besoin, le mode
// Review non — ses actions vivent dans une barre séparée en bas de carte).
function _tradeCardBodyHtml(t, opts) {
  opts = opts || {};
  const editable = !!opts.editable;
  const pnlVal=(t.pnlDollar??t.pnlPct??0); const pnlCls=pnlVal>=0?'pos':'neg';
  const pnlDolStr=t.pnlDollar!==null?(t.pnlDollar>=0?'+':'')+t.pnlDollar.toFixed(2)+' $':'–';
  const pnlDolHtml=t.pnlDollar!==null?`<span id="rc-pnl-dollar" data-pnl-px data-v="${pnlDolStr}" data-p="${t.pnlDollar>=0?1:0}">${pnlDolStr}</span>`:`<span id="rc-pnl-dollar">${pnlDolStr}</span>`;
  const pnlPctStr=t.pnlPct!==null?(t.pnlPct>=0?'+':'')+t.pnlPct.toFixed(2)+'%':'–';
  const img5src  = t.img5  === 'idb' ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' : (t.img5  ? 'file:///'+cleanPath(t.img5).replace(/\\/g,'/') : null);
  const img15src = t.img15 === 'idb' ? 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' : (t.img15 ? 'file:///'+cleanPath(t.img15).replace(/\\/g,'/') : null);
  const mkImg=(src, lbl, dispLbl) => src
    ? `<div class="modal-img-container" style="cursor:zoom-in" onclick="viewImgSrc('${lbl}')"><img src="${src}" alt="${dispLbl}" onerror="this.parentElement.innerHTML='<div class=no-img>Image introuvable</div>'"/></div>`
    : `<div class="no-img">Pas de screenshot ${dispLbl}</div>`;
  const icon=`<img src="${cryptoIconUrl(t.ticker)}" onerror="this.style.display='none'" style="width:34px;height:34px;border-radius:50%;vertical-align:middle;margin-right:10px" alt=""/>`;
  const durStr=t.dur!==null&&t.dur!==undefined?(t.dur<60?t.dur+'min':Math.floor(t.dur/60)+'h'+(t.dur%60>0?String(t.dur%60).padStart(2,'0'):'')):'–';
  // Champ numérique cliquable en mode review (editable) — id stable pour être
  // mis à jour ciblé sans re-render complet (évite le flicker des screenshots).
  const fld = (label, field, valueHtml, cls) => `<div class="modal-field"><label>${label}</label><div class="val${cls?' '+cls:''}" id="rc-val-${field}"${editable?` onclick="_startInlineEdit('${field}','number',${t.id})" style="cursor:pointer"`:''}>${valueHtml}</div></div>`;
  const brFld = (label, field) => `<div class="modal-field"><label>${label}</label><div class="val" id="rc-val-${field}" style="color:${brColor(t[field])}${editable?';cursor:pointer':''}"${editable?` onclick="_cycleBrField('${field}',${t.id})"`:''}>${brLabel(t[field])}</div></div>`;
  const shotEdit = (which) => editable ? ` <button type="button" title="Remplacer" onclick="event.stopPropagation();document.getElementById('rc-shot${which}-input').click()" style="border:none;background:rgba(255,255,255,0.08);color:var(--text2);border-radius:5px;padding:1px 6px;cursor:pointer;font-size:10px">✏</button><input id="rc-shot${which}-input" type="file" accept="image/*" style="display:none" onchange="_replaceReviewScreenshot(event,'${which}',${t.id})"/>` : '';
  const noteBoxInner = (t.note || t.noteLevels) ? _noteSectionsHtml(t.note, t.noteLevels) : `<div style="color:var(--text2);font-style:italic">Cliquer pour ajouter une note…</div>`;
  return `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;padding-right:${opts.padRight||0}px;padding-left:${opts.padLeft||0}px">
      <div>
        <span style="font-size:22px;font-weight:800;display:flex;align-items:center;gap:12px">${icon}${t.ticker}${t.setupGrade?gradeTag(t.setupGrade,'lg'):''}</span>
        ${t.title?`<div style="margin-top:7px"><span style="font-style:italic;color:rgba(255,255,255,0.9);background:rgba(255,255,255,0.09);padding:2px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);font-size:13px">${escHtml(t.title)}</span></div>`:''}
      </div>
      <div style="text-align:right">
        <div style="font-size:26px;font-weight:800;letter-spacing:-1px" class="${pnlCls}">${pnlDolHtml}</div>
        <div style="font-size:13px;color:var(--text2)" id="rc-pnl-pct">${pnlPctStr}</div>
      </div>
    </div>
    <div style="color:var(--text2);font-size:12px;margin-bottom:16px">${t.date} · ${t.time}${t.timeEnd?' → '+t.timeEnd:''} · ${durStr} · ${t.dir}</div>
    <div class="modal-imgs">
      <div class="modal-img-block"><div class="modal-img-lbl">Screenshot 1 <span style="color:var(--text2);font-size:9px">(clic = zoom)</span>${shotEdit('5')}</div><div id="rc-shot5">${mkImg(img5src,'5min','Screenshot 1')}</div></div>
      <div class="modal-img-block"><div class="modal-img-lbl">Screenshot 2 <span style="color:var(--text2);font-size:9px">(clic = zoom)</span>${shotEdit('15')}</div><div id="rc-shot15">${mkImg(img15src,'15min','Screenshot 2')}</div></div>
    </div>
    <div class="modal-grid">
      ${fld('Entrée','buy',fmtPrice(t.buy))}
      ${fld('Stop Loss','sl',fmtPrice(t.sl),'neg')}
      ${fld('Sortie','sell',fmtPrice(t.sell))}
      <div class="modal-field"><label>Risque</label><div class="val" id="rc-val-risk" style="color:var(--yellow)">${t.risk?t.risk.toFixed(2)+'%':'–'}</div></div>
      ${fld('Montant entré','amtIn',t.amtIn!==null?t.amtIn+' $':'–')}
      ${fld('Montant sorti','amtOut',t.amtOut!==null?t.amtOut+' $':'–',pnlCls)}
      ${fld('RR visé','rrTarget',t.rrTarget??'–')}
      <div class="modal-field"><label>RR réalisé</label><div class="val ${pnlCls}" id="rc-val-rrReal">${t.rrReal!==null?(t.rrReal>=0?'+':'')+t.rrReal.toFixed(2)+'R':'–'}</div></div>
      ${brFld('Low Broken','lowBr')}
      ${brFld('High Broken','highBr')}
    </div>
    ${editable ? `<div class="modal-note-box" style="margin-top:16px;background:rgba(255,255,255,0.03);border:1px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:10px;letter-spacing:1px;color:var(--text2);margin-bottom:7px;font-weight:700;text-transform:uppercase">Note</div>
      <div id="rc-note-display" onclick="_startNoteEdit(${t.id})" style="cursor:pointer">${noteBoxInner}</div>
    </div>` : ((t.note || t.noteLevels)?`<div class="modal-note-box" style="margin-top:16px;background:rgba(255,255,255,0.03);border:1px solid var(--border2);border-radius:12px;padding:14px">
      <div style="font-size:10px;letter-spacing:1px;color:var(--text2);margin-bottom:7px;font-weight:700;text-transform:uppercase">Note</div>
      ${_noteSectionsHtml(t.note, t.noteLevels)}
    </div>`:'')}
    ${(t.reviewComment || t.reviewGrade)?`<div class="modal-note-box" style="margin-top:16px;background:rgba(6,182,212,0.06);border:1px solid rgba(6,182,212,0.3);border-radius:12px;padding:14px">
      <div style="font-size:10px;letter-spacing:1px;color:#22d3ee;margin-bottom:7px;font-weight:700;text-transform:uppercase">🔁 Review</div>
      ${t.reviewGrade?`<div style="margin-bottom:${t.reviewComment?'10px':'0'}">${gradeTag(t.reviewGrade,'lg')}</div>`:''}
      ${t.reviewComment?`<div style="font-size:14px;line-height:1.6;color:var(--text);white-space:pre-wrap">${escHtml(t.reviewComment)}</div>`:''}
    </div>`:''}`;
}
// ─── ÉDITION INLINE (mode Review) ──────────────────────────────────────────
// Recalcule risk/pnlDollar/pnlPct/rrReal directement sur l'objet trade, sans
// dépendre du DOM du formulaire (calcRisk()/calcPnl() sont couplés à f_buy
// etc.) — version pure réutilisable depuis l'édition inline de la review.
function _recomputeTradeStats(t) {
  const buy=t.buy, sl=t.sl, sell=t.sell, amtIn=t.amtIn, amtOut=t.amtOut, dir=t.dir;
  t.risk = (buy!=null && sl!=null && buy>0 && sl>0 && buy!==sl) ? Math.abs((buy-sl)/buy)*100 : null;
  const riskPctCalc = t.risk || 0;
  const lev = (t.leverage && t.leverage > 1) ? t.leverage : 1;
  if (amtIn!=null && amtOut!=null && amtIn>0) {
    t.pnlDollar = dir==='SHORT' ? amtIn-amtOut : amtOut-amtIn;
    t.pnlPct = (t.pnlDollar/(amtIn/lev))*100;
    t.rrReal = riskPctCalc>0 ? t.pnlDollar/(amtIn*lev*riskPctCalc/100) : null;
  } else if (buy!=null && sell!=null && buy>0) {
    t.pnlDollar = null;
    t.pnlPct = dir==='LONG' ? ((sell-buy)/buy)*100 : ((buy-sell)/buy)*100;
    t.rrReal = riskPctCalc>0 ? t.pnlPct/riskPctCalc : null;
  } else {
    t.pnlDollar = null; t.pnlPct = null; t.rrReal = null;
  }
}
function _fieldValueHtml(t, field) {
  if (field === 'buy')      return fmtPrice(t.buy);
  if (field === 'sl')       return fmtPrice(t.sl);
  if (field === 'sell')     return fmtPrice(t.sell);
  if (field === 'amtIn')    return t.amtIn!==null?t.amtIn+' $':'–';
  if (field === 'amtOut')   return t.amtOut!==null?t.amtOut+' $':'–';
  if (field === 'rrTarget') return t.rrTarget??'–';
  return '–';
}
function _startInlineEdit(field, type, id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  const el = document.getElementById('rc-val-' + field); if (!el) return;
  const raw = t[field] ?? '';
  el.innerHTML = `<input type="${type}" step="any" value="${raw}" style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(124,58,237,0.4);border-radius:6px;padding:2px 6px;color:var(--text);font-size:inherit;font-weight:inherit"
    onblur="_commitInlineEdit('${field}',${id})"
    onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape'){this.dataset.cancel='1';this.blur();}"/>`;
  const inp = el.querySelector('input');
  inp.focus(); inp.select();
}
function _commitInlineEdit(field, id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  const el = document.getElementById('rc-val-' + field); if (!el) return;
  const input = el.querySelector('input');
  if (!input.dataset.cancel) {
    const v = parseNum(input.value);
    t[field] = isNaN(v) ? null : v;
    if (['buy','sl','sell','amtIn','amtOut'].includes(field)) { _recomputeTradeStats(t); _refreshDerivedDisplay(t); }
    save(); renderTable();
  }
  el.innerHTML = _fieldValueHtml(t, field);
}
// Met à jour Risque/RR réalisé/P&L (header) après un recalcul, sans toucher
// au reste de la carte (screenshots inclus).
function _refreshDerivedDisplay(t) {
  const pnlCls = (t.pnlDollar??t.pnlPct??0) >= 0 ? 'pos' : 'neg';
  const riskEl = document.getElementById('rc-val-risk');
  if (riskEl) riskEl.textContent = t.risk ? t.risk.toFixed(2)+'%' : '–';
  const rrEl = document.getElementById('rc-val-rrReal');
  if (rrEl) { rrEl.textContent = t.rrReal!==null?(t.rrReal>=0?'+':'')+t.rrReal.toFixed(2)+'R':'–'; rrEl.className = 'val ' + pnlCls; }
  const amtOutEl = document.getElementById('rc-val-amtOut');
  if (amtOutEl) amtOutEl.className = 'val ' + pnlCls;
  const pnlDolEl = document.getElementById('rc-pnl-dollar');
  if (pnlDolEl) {
    const pnlDolStr = t.pnlDollar!==null?(t.pnlDollar>=0?'+':'')+t.pnlDollar.toFixed(2)+' $':'–';
    pnlDolEl.outerHTML = t.pnlDollar!==null ? _pxSpan(pnlDolStr, t.pnlDollar>=0).replace('<span', '<span id="rc-pnl-dollar"') : `<span id="rc-pnl-dollar">${pnlDolStr}</span>`;
    const pnlHeaderEl = document.getElementById('rc-pnl-dollar').parentElement;
    if (pnlHeaderEl) pnlHeaderEl.className = pnlCls;
  }
  const pnlPctEl = document.getElementById('rc-pnl-pct');
  if (pnlPctEl) pnlPctEl.textContent = t.pnlPct!==null?(t.pnlPct>=0?'+':'')+t.pnlPct.toFixed(2)+'%':'–';
}
function _cycleBrField(field, id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  const order = ['', 'Y', 'E'];
  const idx = order.indexOf(t[field] || '');
  t[field] = order[(idx + 1) % order.length];
  save(); renderTable();
  const el = document.getElementById('rc-val-' + field);
  if (el) { el.textContent = brLabel(t[field]); el.style.color = brColor(t[field]); }
}
function _startNoteEdit(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  const el = document.getElementById('rc-note-display'); if (!el) return;
  const taStyle = "width:100%;min-height:50px;background:rgba(255,255,255,0.05);border:1px solid rgba(124,58,237,0.4);border-radius:8px;padding:8px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical";
  el.outerHTML = `<div id="rc-note-display">
    <div class="note-section-lbl" style="margin-bottom:4px">Général</div>
    <textarea id="rc-note-edit-general" style="${taStyle};margin-bottom:8px" onblur="_scheduleNoteCommit(${id})" onkeydown="if(event.key==='Escape'){this.dataset.cancel='1';this.blur();}">${escHtml(t.note||'')}</textarea>
    <div class="note-section-lbl" style="margin-bottom:4px">Niveaux (TP / SL / Entrée)</div>
    <textarea id="rc-note-edit-levels" style="${taStyle}" onblur="_scheduleNoteCommit(${id})" onkeydown="if(event.key==='Escape'){this.dataset.cancel='1';this.blur();}">${escHtml(t.noteLevels||'')}</textarea>
  </div>`;
  document.getElementById('rc-note-edit-general').focus();
}
// Les deux textareas (Général / Niveaux) partagent un seul commit, déclenché
// seulement quand le focus quitte les DEUX champs — sinon tabuler de l'un à
// l'autre validerait prématurément et ferait disparaître le second champ.
function _scheduleNoteCommit(id) {
  setTimeout(() => {
    const active = document.activeElement;
    if (active && (active.id === 'rc-note-edit-general' || active.id === 'rc-note-edit-levels')) return;
    _commitNoteEdit(id);
  }, 0);
}
function _commitNoteEdit(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  const taGeneral = document.getElementById('rc-note-edit-general');
  const taLevels  = document.getElementById('rc-note-edit-levels');
  if (!taGeneral || !taLevels) return;
  if (!taGeneral.dataset.cancel && !taLevels.dataset.cancel) {
    t.note = taGeneral.value;
    t.noteLevels = taLevels.value;
    save(); renderTable();
  }
  const noteBoxInner = (t.note || t.noteLevels) ? _noteSectionsHtml(t.note, t.noteLevels) : `<div style="color:var(--text2);font-style:italic">Cliquer pour ajouter une note…</div>`;
  document.getElementById('rc-note-display').outerHTML = `<div id="rc-note-display" onclick="_startNoteEdit(${id})" style="cursor:pointer">${noteBoxInner}</div>`;
}
function _replaceReviewScreenshot(event, which, id) {
  const file = event.target.files[0]; if (!file) return;
  const t = trades.find(x => x.id === id); if (!t) return;
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    saveIdbImage(id + '_img' + which, dataUrl).then(() => {
      if (which === '5') t.img5 = 'idb'; else t.img15 = 'idb';
      save(); renderTable();
      window['_zoomImg' + which] = dataUrl;
      const container = document.getElementById('rc-shot' + which);
      if (container) container.innerHTML = `<div class="modal-img-container" style="cursor:zoom-in" onclick="viewImgSrc('${which==='5'?'5min':'15min'}')"><img src="${dataUrl}" alt="Screenshot ${which==='5'?'1':'2'}"/></div>`;
    });
  };
  reader.readAsDataURL(file);
}

// Charge les screenshots IndexedDB (asynchrone) et prépare window._zoomImg5/15
// pour viewImgSrc — partagé entre openModal et le mode Review, paramétré par
// l'id du conteneur puisque les deux ont leur propre DOM.
function _loadModalImages(t, containerId) {
  const img5src  = t.img5  !== 'idb' && t.img5  ? 'file:///'+cleanPath(t.img5).replace(/\\/g,'/')  : null;
  const img15src = t.img15 !== 'idb' && t.img15 ? 'file:///'+cleanPath(t.img15).replace(/\\/g,'/') : null;
  window._zoomImg5  = img5src;
  window._zoomImg15 = img15src;
  if (t.img5 === 'idb') loadIdbImage(t.id+'_img5').then(d => {
    window._zoomImg5 = d;
    const el = document.querySelector('#'+containerId+' .modal-img-block:first-child .modal-img-container img');
    if (el && d) el.src = d;
  });
  if (t.img15 === 'idb') loadIdbImage(t.id+'_img15').then(d => {
    window._zoomImg15 = d;
    const el = document.querySelector('#'+containerId+' .modal-img-block:last-child .modal-img-container img');
    if (el && d) el.src = d;
  });
}

function openModal(id, fromDay=null) {
  const t=trades.find(x=>x.id===id); if (!t) return;
  const backBtn=fromDay?`<button onclick="showDayTrades('${fromDay}')" style="position:absolute;top:16px;left:16px;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,0.06);border:1px solid var(--border2);border-radius:8px;color:var(--text2);font-size:12px;font-weight:600;padding:5px 10px;cursor:pointer;transition:all .2s" onmouseover="this.style.background='rgba(124,58,237,0.12)';this.style.color='var(--text)'" onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.color='var(--text2)'"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>Retour</button>`:'';
  document.getElementById('modalContent').innerHTML=`
    ${backBtn}
    <button id="modal-review-btn" onclick="toggleReviewedInModal(${t.id})" title="${t.reviewed?'Reviewé — cliquer pour annuler':'Marquer comme reviewé'}" class="btn-review${t.reviewed?' done':''}" style="position:absolute;top:16px;right:56px;width:32px;height:32px;border-radius:8px;border:1px solid;display:flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;transition:all .2s;border-color:${t.reviewed?'rgba(139,71,240,0.5)':'var(--border2)'}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="${t.reviewed?'currentColor':'none'}" stroke="${t.reviewed?'rgba(255,255,255,0.9)':'currentColor'}" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="${t.reviewed?'rgba(255,255,255,0.25)':'none'}"/></svg>
    </button>
    ${_tradeCardBodyHtml(t, { padRight: 88, padLeft: fromDay ? 90 : 0 })}`;
  document.getElementById('tradeModal').classList.add('open');
  _loadModalImages(t, 'modalContent');
}
function closeModal() { document.getElementById('tradeModal').classList.remove('open'); }
document.getElementById('tradeModal').addEventListener('click', e => { if(e.target===document.getElementById('tradeModal')) closeModal(); });
document.getElementById('portfolioModal').addEventListener('click', e => { if(e.target===document.getElementById('portfolioModal')) closePortfolioModal(); });

// ─── MODE REVIEW (file d'attente des trades non reviewés) ─────────────────
let _reviewQueue = [];
let _reviewIdx   = 0;
let _reviewMode  = 'unreviewed'; // 'unreviewed' (file par défaut) | 'again' (flaggés "revoir plus tard")

function openReviewMode(mode) {
  _reviewMode = mode === 'again' ? 'again' : 'unreviewed';
  // Tout ce qui a un statut reviewé (trades pris, idées, ET commentaires —
  // ces derniers ont leur propre œil de review, cf. toggleCommentReviewedInRow)
  // du mode réel/paper actuellement actif. En mode 'again', on prend plutôt
  // les trades explicitement flaggés "revoir plus tard" lors d'une review
  // précédente, quel que soit leur statut reviewed (toujours true à ce stade).
  _reviewQueue = _applyModeFilter(trades).filter(t => _reviewMode === 'again' ? !!t.reviewAgain : !t.reviewed);
  // Ordre aléatoire (Fisher-Yates) plutôt que chronologique, pour ne pas
  // toujours revoir les trades dans le même ordre prévisible.
  for (let i = _reviewQueue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [_reviewQueue[i], _reviewQueue[j]] = [_reviewQueue[j], _reviewQueue[i]];
  }
  _reviewIdx = 0;
  document.getElementById('reviewModal').classList.add('open');
  renderReviewCard();
}

function closeReviewMode() {
  document.getElementById('reviewModal').classList.remove('open');
}

// ─── VERROU DE SCROLL ARRIÈRE-PLAN ─────────────────────────────────────────
// Empêche le tableau de trades de défiler sous une modale ouverte. Recalcule
// l'état à chaque changement de classe/style plutôt que de verrouiller/
// déverrouiller dans chaque fonction open/close individuelle, car le
// raccourci Escape global (case 'Escape' du keydown principal) ferme toutes
// les modales d'un coup en manipulant directement les classes CSS, en
// contournant ces fonctions — un compteur basé sur les appels serait donc
// désynchronisé dans ce cas précis.
function _anyOverlayOpen() {
  if (document.querySelector('.modal-overlay.open, .img-zoom-overlay.open')) return true;
  const cd = document.getElementById('comment-dialog');
  const cp = document.getElementById('comment-preview');
  return (cd && cd.style.display === 'flex') || (cp && cp.style.display === 'flex');
}
new MutationObserver(() => {
  document.body.style.overflow = _anyOverlayOpen() ? 'hidden' : '';
}).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

// Corps de carte pour une ligne de commentaire (pas de ticker/P&L/images —
// juste une date et un texte, même contenu que openCommentPreview).
function _commentCardBodyHtml(t) {
  const d = new Date(t.date + 'T00:00:00');
  const dateStr = d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  return `
    <div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--accent);margin-bottom:14px">💬 Commentaire — ${dateStr}</div>
    <div style="font-size:16px;line-height:1.8;color:var(--text);white-space:pre-wrap;font-style:italic">${escHtml(t.text)}</div>`;
}

let _reviewDraftId = null;
let _reviewDraftGrade = '';
let _reviewDraftComment = '';
let _lastReviewUndo = null;
function renderReviewCard() {
  const container = document.getElementById('reviewModalContent');
  const undoBtnHtml = _lastReviewUndo ? `<button class="btn btn-ghost btn-sm" onclick="undoLastReview()" style="color:#f59e0b">↺ Annuler le dernier</button>` : '';
  if (_reviewQueue.length === 0) {
    container.innerHTML = (_reviewMode === 'again' ? `
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:40px;margin-bottom:14px">✅</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">Rien à revoir pour l'instant</div>
        <div style="font-size:13px;color:var(--text2)">Aucun trade flaggé "revoir plus tard".</div>
      </div>` : `
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:40px;margin-bottom:14px">🎉</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">Tout est reviewé !</div>
        <div style="font-size:13px;color:var(--text2)">Aucun trade en attente de review pour le moment.</div>
      </div>`) + (undoBtnHtml ? `<div style="text-align:center;margin-top:8px">${undoBtnHtml}</div>` : '');
    return;
  }
  const t = _reviewQueue[_reviewIdx];
  if (_reviewDraftId !== t.id) {
    _reviewDraftId = t.id;
    _reviewDraftGrade = t.reviewGrade || '';
    _reviewDraftComment = t.reviewComment || '';
  }
  const counterLabel = _reviewMode === 'again' ? 'à revoir' : 'non reviewés';
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding-right:36px">
      <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text2)">${_reviewIdx+1} / ${_reviewQueue.length} ${counterLabel}</div>
      <div style="display:flex;gap:6px">
        ${undoBtnHtml}
        ${!t._isComment ? `<button class="btn btn-ghost btn-sm" onclick="closeReviewMode();editTrade(${t.id})">✏ Modifier</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="reviewPrev()" ${_reviewIdx===0?'disabled':''}>◀ Précédent</button>
        <button class="btn btn-ghost btn-sm" onclick="reviewSkip()" ${_reviewIdx>=_reviewQueue.length-1?'disabled':''}>Passer ▶</button>
      </div>
    </div>
    ${t._isComment ? _commentCardBodyHtml(t) : _tradeCardBodyHtml(t, { editable: true })}
    ${!t._isComment ? `
    <div style="margin-top:16px">
      <label style="font-size:10px;letter-spacing:1px;color:#22d3ee;margin-bottom:6px;display:block;font-weight:700;text-transform:uppercase">🔁 Grade de review</label>
      <div id="reviewGradePicker" style="display:flex;gap:6px">
        ${['C','B','A','A+'].map(g => {
          const cfg = _GRADE_CFG[g]; const active = _reviewDraftGrade === g;
          return `<button type="button" data-grade="${g}" onclick="setReviewGrade(${t.id},'${g}')" style="height:36px;width:44px;border-radius:8px;border:1px solid ${active?cfg.bc_act:cfg.bc_idle};background:${active?cfg.act:cfg.idle};color:${active?cfg.clr_act:cfg.clr_idle};font-size:13px;font-weight:800;cursor:pointer;transition:all .15s;letter-spacing:.5px">${g}</button>`;
        }).join('')}
      </div>
    </div>` : ''}
    <div style="margin-top:16px">
      <label style="font-size:10px;letter-spacing:1px;color:#22d3ee;margin-bottom:6px;display:block;font-weight:700;text-transform:uppercase">🔁 Commentaire de review</label>
      <textarea id="reviewCommentInput" placeholder="Note additionnelle pour cette review…" oninput="_onReviewCommentInput(${t.id})" style="width:100%;min-height:70px;background:rgba(255,255,255,0.03);border:1px solid rgba(6,182,212,0.3);border-radius:10px;padding:10px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical">${escHtml(_reviewDraftComment)}</textarea>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-ghost" style="flex:1;justify-content:center;padding:12px" onclick="reviewMarkAndNext(true)" title="Raccourci : R">
        🔁 Revoir plus tard
      </button>
      <button class="btn btn-primary" style="flex:1;justify-content:center;padding:12px" onclick="reviewMarkAndNext(false)" title="Raccourci : Entrée">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Terminé — Suivant
      </button>
    </div>`;
  if (!t._isComment) _loadModalImages(t, 'reviewModalContent');
}

// Marque le trade courant reviewé, le retire de la file, avance. Persiste et
// re-render le tableau à chaque marquage (pas seulement à la fermeture) pour
// rester cohérent quel que soit le chemin de fermeture du modal (bouton,
// clic extérieur, Échap). `again` (bool) distingue "revoir plus tard"
// (reviewAgain=true, réapparaîtra dans la file dédiée) de "terminé"
// (reviewAgain=false) — réévalué à chaque passage, ce qui permet de boucler
// indéfiniment sur un même trade tant qu'on choisit "revoir plus tard".
function _onReviewCommentInput(id) {
  if (id !== _reviewDraftId) return;
  _reviewDraftComment = document.getElementById('reviewCommentInput').value;
}
function setReviewGrade(id, g) {
  if (id !== _reviewDraftId) return;
  _reviewDraftGrade = (_reviewDraftGrade === g) ? '' : g;
  // Restyle les boutons en place plutôt qu'un renderReviewCard() complet :
  // celui-ci régénère aussi les screenshots (_tradeCardBodyHtml +
  // _loadModalImages async), provoquant un flicker visible à chaque clic.
  const picker = document.getElementById('reviewGradePicker');
  if (picker) {
    picker.querySelectorAll('button[data-grade]').forEach(btn => {
      const bg = btn.getAttribute('data-grade');
      const cfg = _GRADE_CFG[bg];
      const active = _reviewDraftGrade === bg;
      btn.style.background = active ? cfg.act : cfg.idle;
      btn.style.borderColor = active ? cfg.bc_act : cfg.bc_idle;
      btn.style.color = active ? cfg.clr_act : cfg.clr_idle;
    });
  }
}
function reviewMarkAndNext(again) {
  const t = _reviewQueue[_reviewIdx];
  if (t) {
    _lastReviewUndo = { id: t.id, reviewed: t.reviewed, reviewAgain: t.reviewAgain, reviewGrade: t.reviewGrade, reviewComment: t.reviewComment };
    t.reviewGrade = _reviewDraftGrade;
    t.reviewComment = _reviewDraftComment;
    t.reviewed = true; t.reviewAgain = !!again; save(); renderTable();
  }
  _reviewQueue.splice(_reviewIdx, 1);
  if (_reviewIdx >= _reviewQueue.length) _reviewIdx = Math.max(0, _reviewQueue.length - 1);
  _reviewDraftId = null;
  renderReviewCard();
}
// Annule la dernière action de review (Terminé/Revoir plus tard) : restaure
// l'état précédent du trade et le replace dans la file en cours. Un seul
// niveau d'annulation — se réarme à chaque nouvelle validation.
function undoLastReview() {
  if (!_lastReviewUndo) return;
  const t = trades.find(x => x.id === _lastReviewUndo.id);
  if (t) {
    t.reviewed = _lastReviewUndo.reviewed;
    t.reviewAgain = _lastReviewUndo.reviewAgain;
    t.reviewGrade = _lastReviewUndo.reviewGrade;
    t.reviewComment = _lastReviewUndo.reviewComment;
    save(); renderTable();
    if (!_reviewQueue.includes(t)) _reviewQueue.splice(_reviewIdx, 0, t);
  }
  _lastReviewUndo = null;
  renderReviewCard();
}
function reviewSkip() {
  if (_reviewIdx < _reviewQueue.length - 1) { _reviewIdx++; renderReviewCard(); }
}
function reviewPrev() {
  if (_reviewIdx > 0) { _reviewIdx--; renderReviewCard(); }
}

document.getElementById('reviewModal').addEventListener('click', e => { if (e.target === document.getElementById('reviewModal')) closeReviewMode(); });
// Raccourcis clavier scopés au mode Review (n'agit que si le modal est
// ouvert) — Entrée/flèches sont libres partout ailleurs dans l'app.
document.addEventListener('keydown', e => {
  const modal = document.getElementById('reviewModal');
  if (!modal || !modal.classList.contains('open')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input','textarea','select'].includes(tag)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape')          { closeReviewMode(); }
  else if (e.key === 'Enter')      { e.preventDefault(); reviewMarkAndNext(false); }
  else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); reviewMarkAndNext(true); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); reviewSkip(); }
  else if (e.key === 'ArrowLeft')  { e.preventDefault(); reviewPrev(); }
});

// ─── REVIEW TOGGLE ─────────────────────────────────────────────────────────
function toggleReviewed(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  t.reviewed = !t.reviewed;
  save(); renderTable();
}
function _dayToggleReview(id, ds) {
  const t = trades.find(x => x.id === id); if (!t) return;
  t.reviewed = !t.reviewed;
  save(); renderTable(); showDayTrades(ds);
}
function toggleReviewedInModal(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  t.reviewed = !t.reviewed;
  save(); renderTable();
  const btn = document.getElementById('modal-review-btn');
  if (!btn) return;
  const rev = t.reviewed;
  btn.className = `btn-review${rev ? ' done' : ''}`;
  btn.title = rev ? 'Reviewé — cliquer pour annuler' : 'Marquer comme reviewé';
  btn.style.borderColor = rev ? 'rgba(139,71,240,0.5)' : 'var(--border2)';
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${rev?'currentColor':'none'}" stroke="${rev?'rgba(255,255,255,0.9)':'currentColor'}" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="${rev?'rgba(255,255,255,0.25)':'none'}"/></svg>`;
}

// ─── EDIT / DELETE ─────────────────────────────────────────────────────────
function editTrade(id) {
  const t=trades.find(x=>x.id===id); if(!t) return;
  editingId=id;
  document.getElementById('f_ticker').value   =t.ticker;
  document.getElementById('f_date').value     =t.date;
  document.getElementById('f_time').value     =t.time;
  document.getElementById('f_time_end').value =t.timeEnd||'';
  document.getElementById('f_dir').value      =t.dir;
  document.getElementById('f_buy').value      =t.buy;
  document.getElementById('f_sl').value       =t.sl??'';
  document.getElementById('f_sell').value     =t.sell??'';
  document.getElementById('f_amount_in').value=t.amtIn??'';
  document.getElementById('f_amount_out').value=t.amtOut??'';
  document.getElementById('f_rr').value       =t.rrTarget||'';
  document.getElementById('f_lowbr').value    =t.lowBr;
  document.getElementById('f_highbr').value   =t.highBr;
  resetImgZones();
  if (t.img5 === 'idb')  loadIdbImage(t.id + '_img5').then(d  => { if (d) { _pendingImg5  = d; showImgPreview('5',  d); } });
  if (t.img15 === 'idb') loadIdbImage(t.id + '_img15').then(d => { if (d) { _pendingImg15 = d; showImgPreview('15', d); } });
  if (t.img5  && t.img5  !== 'idb') { /* legacy path, skip */ }
  if (t.img15 && t.img15 !== 'idb') { /* legacy path, skip */ }
  const titleEl = document.getElementById('f_title'); if (titleEl) titleEl.value = t.title || '';
  setGrade(t.setupGrade || '');
  document.getElementById('f_note').value     =t.note;
  const noteLevelsEl = document.getElementById('f_note_levels'); if (noteLevelsEl) noteLevelsEl.value = t.noteLevels || '';
  const hlId = document.getElementById('f_hl_id'); if (hlId) hlId.value = t.hl_id || '';
  const ideaCb = document.getElementById('f_is_idea'); if (ideaCb) ideaCb.checked = !!t.isIdea;
  toggleIdeaStyle();
  const paperCb = document.getElementById('f_is_paper'); if (paperCb) paperCb.checked = !!t.isPaper;
  togglePaperStyle();
  calcDuration(); calcRisk(); calcPnl();
  syncTickerChips();
  switchJournalTab('trader');
  document.querySelector('.card').scrollIntoView({behavior:'smooth'});
}
function deleteTrade(id) {
  if(!confirm('Supprimer ce trade ?')) return;
  const t = trades.find(x => x.id === id);
  if (t) { deleteIdbImage(t.id+'_img5'); deleteIdbImage(t.id+'_img15'); }
  trades=trades.filter(t=>t.id!==id); save(); renderTable();
}
function clearAll() { if(!confirm('Effacer TOUS les trades ? Action irréversible.')) return; trades=[]; clearAllIdbImages(); save(); renderTable(); }

// ─── COMMENTS ──────────────────────────────────────────────────────────────
let _editingCommentId = null;
function openCommentDialog() {
  _editingCommentId = null;
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('comment-date-input').value = today;
  document.getElementById('comment-text-input').value = '';
  document.getElementById('comment-dialog').style.display = 'flex';
  setTimeout(() => document.getElementById('comment-text-input').focus(), 50);
}
function closeCommentDialog() {
  document.getElementById('comment-dialog').style.display = 'none';
  _editingCommentId = null;
}
function saveComment() {
  const date = document.getElementById('comment-date-input').value;
  const text = document.getElementById('comment-text-input').value.trim();
  if (!date || !text) return;
  if (_editingCommentId) {
    const t = trades.find(x => x.id === _editingCommentId);
    if (t) { t.date = date; t.text = text; }
  } else {
    trades.push({ id: Date.now(), _isComment: true, date, text, isPaper: journalMode === 'paper' });
  }
  save(); renderTable();
  closeCommentDialog();
  if (!_editingCommentId) switchJournalTab('historique');
}
function deleteComment(id) {
  trades = trades.filter(x => x.id !== id);
  save(); renderTable();
}
function toggleCommentReviewedInRow(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  t.reviewed = !t.reviewed;
  save(); renderTable();
}
function editCommentById(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  _editingCommentId = t.id;
  document.getElementById('comment-date-input').value = t.date;
  document.getElementById('comment-text-input').value = t.text;
  document.getElementById('comment-dialog').style.display = 'flex';
  setTimeout(() => document.getElementById('comment-text-input').focus(), 50);
}
let _previewCommentId = null;
function openCommentPreview(id) {
  const t = trades.find(x => x.id === id); if (!t) return;
  _previewCommentId = id;
  const d = new Date(t.date + 'T00:00:00');
  document.getElementById('comment-preview-date').textContent = d.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  document.getElementById('comment-preview-text').textContent = t.text;
  const eye = document.getElementById('comment-preview-eye');
  eye.className = `btn-review${t.reviewed ? ' done' : ''}`;
  eye.style.borderColor = t.reviewed ? 'rgba(139,71,240,0.5)' : 'var(--border2)';
  eye.title = t.reviewed ? 'Reviewé — cliquer pour annuler' : 'Marquer comme reviewé';
  eye.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="${t.reviewed?'currentColor':'none'}" stroke="${t.reviewed?'rgba(255,255,255,0.9)':'currentColor'}" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="${t.reviewed?'rgba(255,255,255,0.25)':'none'}"/></svg>`;
  document.getElementById('comment-preview').style.display = 'flex';
}
function closeCommentPreview() {
  document.getElementById('comment-preview').style.display = 'none';
  _previewCommentId = null;
}
function toggleCommentReviewed() {
  const t = trades.find(x => x.id === _previewCommentId); if (!t) return;
  t.reviewed = !t.reviewed;
  save(); renderTable();
  const eye = document.getElementById('comment-preview-eye');
  const rev = t.reviewed;
  eye.className = `btn-review${rev ? ' done' : ''}`;
  eye.style.borderColor = rev ? 'rgba(139,71,240,0.5)' : 'var(--border2)';
  eye.title = rev ? 'Reviewé — cliquer pour annuler' : 'Marquer comme reviewé';
  eye.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="${rev?'currentColor':'none'}" stroke="${rev?'rgba(255,255,255,0.9)':'currentColor'}" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="${rev?'rgba(255,255,255,0.25)':'none'}"/></svg>`;
}
function editComment() {
  const t = trades.find(x => x.id === _previewCommentId); if (!t) return;
  closeCommentPreview();
  _editingCommentId = t.id;
  document.getElementById('comment-date-input').value = t.date;
  document.getElementById('comment-text-input').value = t.text;
  document.getElementById('comment-dialog').style.display = 'flex';
  setTimeout(() => document.getElementById('comment-text-input').focus(), 50);
}

// ─── EXPORT CSV ────────────────────────────────────────────────────────────
function exportCSV() {
  if(!trades.length){alert('Aucun trade.');return;}
  const cols=['#','Date','Heure Entrée','Heure Sortie','Ticker','Dir','Durée(min)','Entrée','SL','Sortie','Montant In','Montant Out','P&L$','P&L%','Risque%','RR visé','RR réal.','Low','High','Screenshot 1','Screenshot 2','Note','Niveaux (TP/SL/Entrée)'];
  const _csvRank = new Map(trades.filter(t=>!t._isComment).slice().sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id).map((t,i)=>[t.id,i+1]));
  const rows=trades.filter(t=>!t._isComment).map((t,i)=>[_csvRank.get(t.id)??i+1,t.date,t.time,t.timeEnd||'',t.ticker,t.dir,t.dur??'',t.buy,t.sl??'',t.sell??'',t.amtIn??'',t.amtOut??'',t.pnlDollar??'',t.pnlPct??'',t.risk??'',t.rrTarget??'',t.rrReal??'',t.lowBr,t.highBr,t.img5,t.img15,'"'+(t.note||'').replace(/"/g,'""')+'"','"'+(t.noteLevels||'').replace(/"/g,'""')+'"']);
  const csv=[cols,...rows].map(r=>r.join(';')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'})); a.download='tradeflow_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
}

// ─── HEADER ────────────────────────────────────────────────────────────────
function _notifyParentStats() {
  if (window.parent === window) return;
  // Lit la vraie valeur même quand l'élément est pixel-masqué (textContent vide)
  const _val = el => { if (!el) return '–'; const sp = el.matches?.('[data-pnl-px]') ? el : el.querySelector('[data-pnl-px]'); return (sp ? sp.dataset.v : el.textContent) || '–'; };
  const wr  = document.getElementById('hdrWR');
  const pnl = document.getElementById('hdrPnl');
  window.parent.postMessage({
    type: 'stats_update',
    total:     document.getElementById('hdrTotal')?.textContent || '–',
    wr:        _val(wr),
    pnl:       _val(pnl),
    rr:        _val(document.getElementById('hdrRR')),
    portfolio: document.getElementById('hdrPortfolio')?.textContent || '–',
    wrClass:   (wr?.className  || 'val neu').replace('val ',''),
    pnlClass:  (pnl?.className || 'val neu').replace('val ',''),
  }, '*');
}

function updateHeader() {
  const at = _applyTypeFilter(activeTrades());
  if(!at.length) {
    document.getElementById('hdrTotal').textContent='0';
    ['hdrWR','hdrPnl','hdrRR'].forEach(id=>{ document.getElementById(id).textContent='–'; document.getElementById(id).className='val neu'; });
    return;
  }
  const wins=at.filter(t=>(t.pnlDollar??t.pnlPct??0)>=0).length;
  const wr=(wins/at.length*100).toFixed(0);
  const useDollar=at.some(t=>t.pnlDollar!==null);
  const pnlTotal=at.reduce((s,t)=>s+(useDollar?(t.pnlDollar??0):(t.pnlPct??0)),0);
  const rrs=at.filter(t=>t.rrReal!==null).map(t=>t.rrReal);
  const avgRR=rrs.length?(rrs.reduce((a,b)=>a+b,0)/rrs.length).toFixed(2):'–';
  document.getElementById('hdrTotal').textContent=at.length;
  const _hdrWrEl=document.getElementById('hdrWR');
  _hdrWrEl.className='val '+(wr>=50?'pos':'neg');
  _hdrWrEl.innerHTML=`<span data-pnl-px data-v="${wr}%" data-p="${wr>=50?1:0}">${wr}%</span>`;
  const _hdrPnlVal=(pnlTotal>=0?'+':'')+pnlTotal.toFixed(2)+(useDollar?'$':'%');
  const _hdrPnlEl=document.getElementById('hdrPnl');
  _hdrPnlEl.className='val '+(pnlTotal>=0?'pos':'neg');
  if(useDollar) _hdrPnlEl.innerHTML=`<span data-pnl-px data-v="${_hdrPnlVal}" data-p="${pnlTotal>=0?1:0}">${_hdrPnlVal}</span>`;
  else _hdrPnlEl.textContent=_hdrPnlVal;
  const _hdrRrEl=document.getElementById('hdrRR');
  if(avgRR!=='–') _hdrRrEl.innerHTML=_pxSpan(avgRR+'R', parseFloat(avgRR)>=1);
  else _hdrRrEl.textContent='–';
  _notifyParentStats();
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────
function renderDashboard() {
  (window.renderDashKPIs || renderDashKPIs)();
  renderHomeEquity();
  renderRecentTrades();
  (window.renderCalendar || renderCalendar)();
  renderPortfolioChart();
  animateKPIs(['home_pnl','home_wr','home_nb','home_rr','home_pf']);
}

/* ── SPARKLINES ─────────────────────────────────────── */
function sparkSetup(id) {
  const c = document.getElementById(id);
  if (!c) return null;
  const W = c.parentElement.clientWidth - 32;
  c.width  = Math.max(W, 40);
  c.height = 28;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  return { c, ctx, W: c.width, H: 28 };
}

function drawSparkLine(id, values, color) {
  if (!values || values.length < 2) return;
  const s = sparkSetup(id); if (!s) return;
  const { ctx, W, H } = s;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const px = i => (i / (values.length - 1)) * W;
  const py = v => H - 2 - ((v - min) / range) * (H - 5);
  // fill
  ctx.beginPath();
  ctx.moveTo(px(0), py(values[0]));
  for (let i = 1; i < values.length; i++) ctx.lineTo(px(i), py(values[i]));
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = color + '28'; ctx.fill();
  // line
  ctx.beginPath();
  ctx.moveTo(px(0), py(values[0]));
  for (let i = 1; i < values.length; i++) ctx.lineTo(px(i), py(values[i]));
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.stroke();
  // last dot
  ctx.beginPath();
  ctx.arc(px(values.length - 1), py(values[values.length - 1]), 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
}

function drawSparkBars(id, values, colorFn) {
  if (!values || values.length < 1) return;
  const s = sparkSetup(id); if (!s) return;
  const { ctx, W, H } = s;
  const maxAbs = Math.max(...values.map(Math.abs), 1);
  const slot = W / values.length;
  const barW = Math.max(1, slot - 2);
  values.forEach((v, i) => {
    const barH = Math.max(2, (Math.abs(v) / maxAbs) * (H - 2));
    const x = i * slot + (slot - barW) / 2;
    ctx.fillStyle = colorFn(v);
    ctx.fillRect(x, H - barH, barW, barH);
  });
}

function renderDashKPIs() {
  const data = dashFilteredTrades();
  const setEmpty = () => {
    ['home_pnl','home_wr','home_nb','home_rr','home_pf','home_ticker'].forEach(id => {
      const el = document.getElementById(id);
      if(el){ el.textContent='–'; el.className='kpi-value neu'; }
    });
    ['home_pnl_sub','home_wr_sub','home_nb_sub','home_rr_sub','home_pf_sub','home_ticker_sub'].forEach(id => {
      const el = document.getElementById(id); if(el) el.textContent='';
    });
  };
  if(!data.length){ setEmpty(); return; }

  const useDollar = data.some(t=>t.pnlDollar!==null);
  const pUnit = useDollar?'$':'%';
  const pVal = t => useDollar?(t.pnlDollar??0):(t.pnlPct??0);

  // P&L Total
  const totalPnl = data.reduce((s,t)=>s+pVal(t),0);
  const pnlEl = document.getElementById('home_pnl');
  const _homePnlVal = (totalPnl>=0?'+':'')+totalPnl.toFixed(2)+pUnit;
  pnlEl.className = 'kpi-value '+(totalPnl>=0?'pos':'neg');
  if(useDollar) pnlEl.innerHTML=`<span data-pnl-px data-v="${_homePnlVal}" data-p="${totalPnl>=0?1:0}">${_homePnlVal}</span>`;
  else pnlEl.textContent=_homePnlVal;
  document.getElementById('home_pnl_sub').textContent = 'P&L · ' + _dashPeriodLabel();

  // Win Rate — utilise pnlDollar en priorité (pnlPct peut être null pour les imports HL)
  const wins   = data.filter(t=>(t.pnlDollar??t.pnlPct??0)>=0);
  const losses = data.filter(t=>(t.pnlDollar??t.pnlPct??0)<0);
  const wr = (wins.length/data.length*100).toFixed(1);
  const wrEl = document.getElementById('home_wr');
  wrEl.innerHTML = `<span data-pnl-px data-v="${wr}%" data-p="${wr>=50?1:0}">${wr}%</span>`;
  wrEl.className   = 'kpi-value '+(wr>=50?'pos':'neg');
  document.getElementById('home_wr_sub').innerHTML = _pxSpan(wins.length+'W / '+losses.length+'L', wins.length>=losses.length);

  // Nb Trades
  const nbEl = document.getElementById('home_nb');
  nbEl.textContent = data.length;
  nbEl.className   = 'kpi-value neu';
  document.getElementById('home_nb_sub').textContent = 'trades enregistrés';

  // RR Moyen
  const rrs   = data.filter(t=>t.rrReal!==null).map(t=>t.rrReal);
  const avgRR = rrs.length?(rrs.reduce((a,b)=>a+b,0)/rrs.length).toFixed(2):null;
  const rrEl  = document.getElementById('home_rr');
  if(avgRR!==null) rrEl.innerHTML = _pxSpan(avgRR+'R', parseFloat(avgRR)>=1);
  else rrEl.textContent = '–';
  rrEl.className   = 'kpi-value '+(avgRR!==null?(parseFloat(avgRR)>=0?'pos':'neg'):'neu');
  document.getElementById('home_rr_sub').textContent = avgRR!==null?'sur '+rrs.length+' trades':'';

  // Profit Factor
  const gW = wins.reduce((s,t)=>s+Math.abs(pVal(t)),0);
  const gL = losses.reduce((s,t)=>s+Math.abs(pVal(t)),0);
  const pf = gL>0?(gW/gL).toFixed(2):(wins.length>0?'∞':'–');
  const pfEl = document.getElementById('home_pf');
  if(pf!=='–') pfEl.innerHTML = _pxSpan(pf, pf==='∞'||parseFloat(pf)>=1);
  else pfEl.textContent = '–';
  pfEl.className   = 'kpi-value '+(pf==='∞'||parseFloat(pf)>=1?'pos':'neg');
  document.getElementById('home_pf_sub').textContent = 'gross win / gross loss';

  // Meilleur Ticker by total P&L
  const byTicker = {};
  data.forEach(t=>{ byTicker[t.ticker]=(byTicker[t.ticker]||0)+pVal(t); });
  const best = Object.entries(byTicker).sort((a,b)=>b[1]-a[1])[0]||null;
  const tickEl = document.getElementById('home_ticker');
  if(best){
    tickEl.textContent = best[0];
    tickEl.className   = 'kpi-value '+(best[1]>=0?'pos':'neg');
    document.getElementById('home_ticker_sub').innerHTML = _pxSpan((best[1]>=0?'+':'')+best[1].toFixed(2)+pUnit, best[1]>=0);
  } else {
    tickEl.textContent='–'; tickEl.className='kpi-value neu';
    document.getElementById('home_ticker_sub').textContent='';
  }

  // ── Sparklines ──────────────────────────────────────
  const G = '#10b981', R = '#ef4444', A = '#a78bfa', Y = '#f59e0b';
  const recent = data.slice(-30);

  // 1. P&L Total — courbe cumulative
  const cumPnl = []; let acc = 0;
  recent.forEach(t => { acc += pVal(t); cumPnl.push(acc); });
  drawSparkLine('spark_pnl', cumPnl, totalPnl >= 0 ? G : R);

  // 2. Win Rate — barres W/L par trade
  const wrVals = recent.map(t => (t.pnlDollar ?? t.pnlPct ?? 0) >= 0 ? 1 : -1);
  drawSparkBars('spark_wr', wrVals, v => v >= 0 ? G + 'cc' : R + 'cc');

  // 3. Nb Trades — barres par semaine (8 dernières semaines)
  const weekBuckets = {};
  data.forEach(t => {
    const d = new Date(t.date); if (isNaN(d)) return;
    const day = d.getDay(), diff = (day + 6) % 7;
    const mon = new Date(d); mon.setDate(d.getDate() - diff);
    const key = mon.toISOString().slice(0, 10);
    weekBuckets[key] = (weekBuckets[key] || 0) + 1;
  });
  const weekVals = Object.values(weekBuckets).slice(-8);
  drawSparkBars('spark_nb', weekVals, () => G + '99');

  // 4. RR Moyen — barres RR par trade (derniers 30 avec RR)
  const rrVals = recent.filter(t => t.rrReal !== null).map(t => t.rrReal);
  drawSparkBars('spark_rr', rrVals, v => v >= 1 ? G + 'cc' : v >= 0 ? Y + 'cc' : R + 'cc');

  // 5. Profit Factor — PF glissant cumulatif sur les 30 derniers trades
  const pfVals = [];
  let gw = 0, gl = 0;
  recent.forEach(t => {
    const v = pVal(t);
    if (v >= 0) gw += v; else gl += Math.abs(v);
    pfVals.push(gl > 0 ? gw / gl : gw > 0 ? 3 : 1);
  });
  drawSparkLine('spark_pf', pfVals, Y);

  // 6. Meilleur Ticker — barres P&L par ticker (max 8 tickers)
  const tickerEntries = Object.entries(byTicker).sort((a,b) => b[1]-a[1]).slice(0, 8);
  drawSparkBars('spark_ticker', tickerEntries.map(e => e[1]), v => v >= 0 ? A + 'cc' : R + 'cc');

  updateMonthlyGoal();
}

// ── OBJECTIFS MENSUELS ────────────────────────────────────────────────────
function updateMonthlyGoal() {
  const now = new Date();
  const yr = now.getFullYear(), mo = now.getMonth();
  const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  const lbl = document.getElementById('goal-month-lbl');
  if (lbl) lbl.textContent = MONTHS[mo] + ' ' + yr;

  const monthData = trades.filter(t => {
    if (t._isComment || t.isIdea) return false;
    if (t.pnlDollar === null && t.pnlPct === null) return false;
    if (!t.date) return false;
    const d = new Date(t.date + 'T00:00:00');
    return d.getFullYear() === yr && d.getMonth() === mo;
  });

  const total = monthData.length;
  const wins  = monthData.filter(t => (t.pnlDollar ?? t.pnlPct ?? 0) >= 0).length;
  const wr    = total > 0 ? wins / total * 100 : null;

  const C = 238.76; // 2π×38
  const GOAL_T = 4, GOAL_WR = 75;

  // Gauge trades
  const gt = document.getElementById('gg-trades');
  const vt = document.getElementById('goal-trades-val');
  if (gt && vt) {
    gt.style.strokeDashoffset = C * (1 - Math.min(total / GOAL_T, 1));
    const done = total >= GOAL_T;
    gt.style.stroke = done ? '#10b981' : 'var(--accent)';
    vt.textContent  = total;
    vt.style.color  = done ? '#10b981' : 'var(--text)';
  }

  // Gauge win rate
  const gw = document.getElementById('gg-wr');
  const vw = document.getElementById('goal-wr-val');
  if (gw && vw) {
    const p = wr !== null ? Math.min(wr / GOAL_WR, 1) : 0;
    gw.style.strokeDashoffset = C * (1 - p);
    const done = wr !== null && wr >= GOAL_WR;
    gw.style.stroke = done ? '#10b981' : 'var(--accent2)';
    if (wr !== null) vw.innerHTML = `<span data-pnl-px data-v="${Math.round(wr)}%" data-p="${done?1:0}">${Math.round(wr)}%</span>`;
    else vw.textContent = '—';
    vw.style.color  = done ? '#10b981' : 'var(--text)';
  }

  // Badge + état de la card
  const badge = document.getElementById('goal-badge');
  const card  = document.getElementById('goal-card');
  if (!badge || !card) return;
  const tOk = total >= GOAL_T, wOk = wr !== null && wr >= GOAL_WR;
  if (tOk && wOk) {
    badge.textContent = '✓ Objectif atteint';
    badge.className   = 'goal-badge goal-badge--achieved';
    card.classList.add('goal-achieved');
  } else if (tOk || wOk) {
    if (tOk) badge.innerHTML = `WR : <span data-pnl-px data-v="${Math.round(wr)}%" data-p="0">${Math.round(wr)}%</span> / 75%`;
    else badge.textContent = `${total} / 4 trades`;
    badge.className   = 'goal-badge goal-badge--partial';
    card.classList.remove('goal-achieved');
  } else {
    badge.textContent = total > 0 ? `${total} / 4 trades` : 'Aucun trade ce mois';
    badge.className   = 'goal-badge goal-badge--pending';
    card.classList.remove('goal-achieved');
  }
}

// ── Equity curve — dots background ───────────────────────────────
// Dots + gradient gérés en CSS sur .chart-card--equity
const equityDotsPlugin = {
  id: 'equityDots',
  afterDraw(chart) {
    if (chart.canvas.id !== 'chartHomeEquity') return;
    const xScale = chart.scales.x;
    if (!xScale) return;
    const { ctx, chartArea } = chart;
    const ticks = xScale.ticks;
    if (!ticks || ticks.length < 2) return;
    const MOIS = ['jan','fév','mar','avr','mai','juin','juil','aoû','sep','oct','nov','déc'];
    ctx.save();
    for (let i = 1; i < ticks.length; i++) {
      const label = xScale.getLabelForValue(ticks[i].value) || '';
      const prev  = xScale.getLabelForValue(ticks[i-1].value) || '';
      const d    = new Date(label.split(' ')[0]);
      const dPrev = new Date(prev.split(' ')[0]);
      if (!isNaN(d) && !isNaN(dPrev) && d.getFullYear() !== dPrev.getFullYear()) {
        const x = xScale.getPixelForValue(ticks[i].value);
        ctx.beginPath();
        ctx.setLineDash([3, 5]);
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.strokeStyle = isLight() ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
};

// ── Equity curve — reveal + crosshair ────────────────────────────
const equityRevealPlugin = {
  id: 'equityReveal',
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== 'chartHomeEquity') return;
    const idx = chart._revealIdx;
    if (idx == null) return;
    const { ctx, chartArea } = chart;
    const meta  = chart.getDatasetMeta(0);
    const pts   = meta.data;
    if (!pts || pts.length < 2) return;
    const hIdx  = Math.min(idx, pts.length - 1);
    const hPt   = pts[hIdx];

    // Use interpolated x/y if available (smooth animation), else snap to point
    const rx = chart._revealX ?? hPt.x;
    const ry = chart._revealY ?? hPt.y;

    // Bright bezier line (0 → hIdx), clipped to interpolated x
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, rx - chartArea.left + 1, chartArea.height);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    const drawTo = Math.min(Math.ceil(chart._revealIdxF ?? hIdx), pts.length - 1);
    for (let i = 1; i <= drawTo; i++) {
      const p = pts[i - 1], c = pts[i];
      ctx.bezierCurveTo(p.cp2x ?? (p.x + c.x) / 2, p.cp2y ?? (p.y + c.y) / 2,
                        c.cp1x ?? (p.x + c.x) / 2, c.cp1y ?? (p.y + c.y) / 2,
                        c.x, c.y);
    }
    ctx.strokeStyle = isLight() ? '#1e1e3a' : '#ffffff';
    ctx.lineWidth   = 2.5;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.restore();

    // Vertical dashed line at interpolated x
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(rx, chartArea.top);
    ctx.lineTo(rx, chartArea.bottom);
    ctx.strokeStyle = isLight() ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Dot + halo at interpolated position
    ctx.save();
    ctx.beginPath();
    ctx.arc(rx, ry, 8, 0, Math.PI * 2);
    ctx.fillStyle = isLight() ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rx, ry, 4, 0, Math.PI * 2);
    ctx.fillStyle = isLight() ? '#1e1e3a' : '#ffffff';
    ctx.fill();
    ctx.restore();
  }
};

// ── Bezier interpolation helper (suit la courbe exacte Chart.js tension) ──
function bezierPointAt(pts, idxF) {
  const lo  = Math.max(0, Math.floor(idxF));
  const hi  = Math.min(pts.length - 1, Math.ceil(idxF));
  if (lo === hi) return { x: pts[lo].x, y: pts[lo].y };
  const t   = idxF - lo;
  const mt  = 1 - t;
  const p   = pts[lo], c = pts[hi];
  const cp2x = p.cp2x ?? (p.x + c.x) / 2, cp2y = p.cp2y ?? (p.y + c.y) / 2;
  const cp1x = c.cp1x ?? (p.x + c.x) / 2, cp1y = c.cp1y ?? (p.y + c.y) / 2;
  return {
    x: mt*mt*mt*p.x + 3*mt*mt*t*cp2x + 3*mt*t*t*cp1x + t*t*t*c.x,
    y: mt*mt*mt*p.y + 3*mt*mt*t*cp2y + 3*mt*t*t*cp1y + t*t*t*c.y
  };
}

// ── Portfolio reveal plugin ────────────────────────────────────────
const portfolioRevealPlugin = {
  id: 'portfolioReveal',
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== 'chartPortfolio') return;
    const idx = chart._revealIdx;
    if (idx == null) return;
    const { ctx, chartArea } = chart;
    const meta = chart.getDatasetMeta(0);
    const pts  = meta.data;
    if (!pts || pts.length < 2) return;
    const hIdx   = Math.min(idx, pts.length - 1);
    const rx     = chart._revealX ?? pts[hIdx].x;
    const ry     = chart._revealY ?? pts[hIdx].y;
    const bright = isLight() ? '#1e1e3a' : '#ffffff';
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, rx - chartArea.left + 1, chartArea.height);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    const drawTo = Math.min(Math.ceil(chart._revealIdxF ?? hIdx), pts.length - 1);
    for (let i = 1; i <= drawTo; i++) {
      const p = pts[i-1], c = pts[i];
      ctx.bezierCurveTo(p.cp2x??(p.x+c.x)/2, p.cp2y??(p.y+c.y)/2, c.cp1x??(p.x+c.x)/2, c.cp1y??(p.y+c.y)/2, c.x, c.y);
    }
    ctx.strokeStyle = bright;
    ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke(); ctx.restore();
    ctx.save(); ctx.setLineDash([4,5]);
    ctx.beginPath(); ctx.moveTo(rx, chartArea.top); ctx.lineTo(rx, chartArea.bottom);
    ctx.strokeStyle = isLight() ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(rx, ry, 8, 0, Math.PI*2);
    ctx.fillStyle = isLight() ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)'; ctx.fill();
    ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI*2);
    ctx.fillStyle = bright; ctx.fill(); ctx.restore();
  }
};

// ── Analytics Equity reveal plugin ────────────────────────────────
const analyticsEquityRevealPlugin = {
  id: 'analyticsEquityReveal',
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== 'chartEquity') return;
    const idx = chart._revealIdx;
    if (idx == null) return;
    const { ctx, chartArea } = chart;
    const meta = chart.getDatasetMeta(0);
    const pts  = meta.data;
    if (!pts || pts.length < 2) return;
    const hIdx   = Math.min(idx, pts.length - 1);
    const rx     = chart._revealX ?? pts[hIdx].x;
    const ry     = chart._revealY ?? pts[hIdx].y;
    const bright = isLight() ? '#1e1e3a' : '#ffffff';
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left, chartArea.top, rx - chartArea.left + 1, chartArea.height);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    const drawTo = Math.min(Math.ceil(chart._revealIdxF ?? hIdx), pts.length - 1);
    for (let i = 1; i <= drawTo; i++) {
      const p = pts[i-1], c = pts[i];
      ctx.bezierCurveTo(p.cp2x??(p.x+c.x)/2, p.cp2y??(p.y+c.y)/2, c.cp1x??(p.x+c.x)/2, c.cp1y??(p.y+c.y)/2, c.x, c.y);
    }
    ctx.strokeStyle = bright;
    ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke(); ctx.restore();
    ctx.save(); ctx.setLineDash([4,5]);
    ctx.beginPath(); ctx.moveTo(rx, chartArea.top); ctx.lineTo(rx, chartArea.bottom);
    ctx.strokeStyle = isLight() ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.arc(rx, ry, 8, 0, Math.PI*2);
    ctx.fillStyle = isLight() ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)'; ctx.fill();
    ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI*2);
    ctx.fillStyle = bright; ctx.fill(); ctx.restore();
  }
};

// ── Bar chart sync plugin (crosshair vertical synchronisé) ──
const barSyncPlugin = {
  id: 'barSync',
  afterDraw(chart) {
    if (chart.canvas.id !== 'chartProjMonthly') return;
    const idx = chart._syncIdx;
    if (idx == null || idx < 0) return;
    const meta = chart.getDatasetMeta(0);
    const bar = meta.data[idx];
    if (!bar) return;
    const { ctx, chartArea } = chart;
    ctx.save(); ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(bar.x, chartArea.top); ctx.lineTo(bar.x, chartArea.bottom);
    ctx.strokeStyle = isLight() ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }
};

// ── Projection crosshair plugin (reveal coloré sur courbe déterministe) ──
const projectionCrosshairPlugin = {
  id: 'projectionCrosshair',
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== 'chartProjection') return;
    const rx = chart._revealX;
    if (rx == null) return;
    const { ctx, chartArea } = chart;
    const idxF = chart._revealIdxF ?? 0;

    // Reveal coloré sur la courbe déterministe (dataset 3)
    const detMeta = chart.getDatasetMeta(3);
    const pts = detMeta?.data;
    if (pts && pts.length >= 2) {
      const { y: ry } = bezierPointAt(pts, idxF);
      // Ligne verte révélée
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartArea.left, chartArea.top, rx - chartArea.left + 1, chartArea.height);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      const drawTo = Math.min(Math.ceil(idxF), pts.length - 1);
      for (let i = 1; i <= drawTo; i++) {
        const p = pts[i-1], c = pts[i];
        ctx.bezierCurveTo(p.cp2x??(p.x+c.x)/2, p.cp2y??(p.y+c.y)/2,
                          c.cp1x??(p.x+c.x)/2, c.cp1y??(p.y+c.y)/2, c.x, c.y);
      }
      ctx.strokeStyle = isLight() ? '#1e1e3a' : '#ffffff';
      ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke(); ctx.restore();
      // Dot
      ctx.save();
      ctx.beginPath(); ctx.arc(rx, ry, 8, 0, Math.PI*2);
      ctx.fillStyle = isLight() ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)'; ctx.fill();
      ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI*2);
      ctx.fillStyle = isLight() ? '#1e1e3a' : '#ffffff'; ctx.fill(); ctx.restore();
    }

    // Trait pointillé vertical
    ctx.save(); ctx.setLineDash([4,5]);
    ctx.beginPath(); ctx.moveTo(rx, chartArea.top); ctx.lineTo(rx, chartArea.bottom);
    ctx.strokeStyle = isLight() ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); ctx.restore();
  }
};

function renderHomeEquity() {
  destroyHomeEquity();
  const canvas  = document.getElementById('chartHomeEquity');
  const empty   = document.getElementById('homeEquityEmpty');
  const tooltip = document.getElementById('homeEquityTooltip');
  if (!canvas) return;
  const periodTrades = dashFilteredTrades();
  if (!periodTrades.length) {
    canvas.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  canvas.style.display = '';
  if (empty) empty.style.display = 'none';

  const useDollar = periodTrades.some(t => t.pnlDollar !== null);
  const pVal  = t => useDollar ? (t.pnlDollar ?? 0) : (t.pnlPct ?? 0);
  const pUnit = useDollar ? '$' : '%';
  const sorted = [...periodTrades].sort((a, b) =>
    new Date(a.date + 'T' + (a.time || '00:00')) - new Date(b.date + 'T' + (b.time || '00:00')));

  let cum = 0;
  const eqD    = sorted.map(t => { cum += pVal(t); return +cum.toFixed(2); });
  const labels = sorted.map(t => t.date + (t.time ? ' ' + t.time : ''));
  const lastVal = eqD[eqD.length - 1];
  const opts = chartOpts('P&L ' + pUnit, true);
  opts.plugins = opts.plugins || {};
  opts.plugins.tooltip = { enabled: false };
  const MOIS = ['jan','fév','mar','avr','mai','juin','juil','aoû','sep','oct','nov','déc'];
  opts.scales = opts.scales || {};
  opts.scales.x = {
    ...(opts.scales?.x || {}),
    grid: { display: false }, border: { display: false },
    ticks: {
      maxTicksLimit: 8,
      color: chartTick(),
      font: { size: 11 },
      callback: function(val, index, ticks) {
        const label = this.getLabelForValue(val);
        if (!label) return '';
        const d = new Date(label.split(' ')[0]);
        if (isNaN(d)) return '';
        // Nouvelle année → afficher l'année
        if (index > 0 && ticks[index - 1]) {
          const prev = new Date((this.getLabelForValue(ticks[index-1].value)||'').split(' ')[0]);
          if (!isNaN(prev) && prev.getFullYear() !== d.getFullYear())
            return String(d.getFullYear());
        }
        return `${d.getDate()} ${MOIS[d.getMonth()]}`;
      }
    }
  };
  opts.scales.y = { ...(opts.scales?.y || {}), grid: { display: false }, border: { display: false } };

  charts.homeEquity = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: eqD,
        borderColor: isLight() ? 'rgba(30,30,58,0.22)' : 'rgba(255,255,255,0.22)',
        backgroundColor: 'transparent',
        fill: false, tension: 0.4, cubicInterpolationMode: 'monotone',
        pointRadius: 0, pointHoverRadius: 0,
        borderWidth: 2
      }]
    },
    options: opts,
    plugins: [equityDotsPlugin, equityRevealPlugin]
  });

  // ── Hover handlers (avec lerp pour un suivi fluide avec délai) ──────────
  const LERP = 0.06; // facteur d'interpolation par frame (plus petit = plus de lag)

  function _revealTick(chart, pts) {
    const tgt = chart._revealTarget;
    if (tgt === null) {
      chart._revealIdx  = null;
      chart._revealIdxF = null;
      chart._revealX    = null;
      chart._revealY    = null;
      chart._revealAnimId = null;
      chart.update('none');
      if (tooltip) tooltip.style.display = 'none';
      return;
    }
    const cur = chart._revealIdxF ?? tgt;
    const nxt = cur + (tgt - cur) * LERP;
    chart._revealIdxF = nxt;
    chart._revealIdx  = Math.round(nxt);

    // Interpolation x/y entre les deux points encadrants
    const { x: _rx, y: _ry } = bezierPointAt(pts, nxt);
    chart._revealX = _rx; chart._revealY = _ry;

    chart.update('none');

    // Mettre à jour le tooltip à la position interpolée
    if (tooltip) {
      const ci  = chart._revealIdx;
      const val = eqD[ci];
      const lbl = labels[ci];
      tooltip.innerHTML =
        `<div style="font-size:15px;font-weight:800;color:var(--text)">${val >= 0 ? '+' : ''}${val.toFixed(2)}${pUnit}</div>` +
        `<div style="font-size:11px;color:var(--text2);margin-top:3px">${lbl}</div>`;
      const rx  = chart._revealX;
      const tw  = tooltip.offsetWidth || 140;
      const rect = canvas.getBoundingClientRect();
      const left = rx + 14 + tw > rect.width ? rx - tw - 14 : rx + 14;
      tooltip.style.left    = left + 'px';
      tooltip.style.top     = (chart.chartArea.top + 10) + 'px';
      tooltip.style.display = 'block';
    }

    // Continuer si pas encore arrivé à destination
    if (Math.abs(nxt - tgt) > 0.02) {
      chart._revealAnimId = requestAnimationFrame(() => _revealTick(chart, pts));
    } else {
      // Snap exact sur le point cible
      const snapIdx = Math.round(tgt);
      chart._revealIdxF = snapIdx;
      chart._revealIdx  = snapIdx;
      const snapPt = pts[Math.min(snapIdx, pts.length - 1)];
      chart._revealX = snapPt.x;
      chart._revealY = snapPt.y;
      chart._revealAnimId = null;
      chart.update('none');
    }
  }

  if (canvas._portMousemove)  canvas.removeEventListener('mousemove',  canvas._portMousemove);
  if (canvas._portMouseleave) canvas.removeEventListener('mouseleave', canvas._portMouseleave);
  if (canvas._docLeave)       document.removeEventListener('mousemove', canvas._docLeave);

  canvas._portMousemove = e => {
    const chart = charts.homeEquity;
    if (!chart) return;
    // Mode privé : pas d'infobulle au survol (elle révélerait la valeur masquée)
    if (_pnlHidden) { if (tooltip) tooltip.style.display = 'none'; return; }
    const rect = canvas.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) * (chart.width / rect.width);
    const { chartArea } = chart;
    if (!chartArea || mx < chartArea.left || mx > chartArea.right) return;
    const pts = chart.getDatasetMeta(0).data;
    let ci = 0, cd = Infinity;
    pts.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < cd) { cd = d; ci = i; } });
    chart._revealTarget = ci;
    if (!chart._revealAnimId)
      chart._revealAnimId = requestAnimationFrame(() => _revealTick(chart, pts));
  };

  canvas._portMouseleave = () => { if (tooltip) tooltip.style.display = 'none'; };
  canvas._docLeave = e => { const r=canvas.getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) if(tooltip) tooltip.style.display='none'; };

  canvas.addEventListener('mousemove',  canvas._portMousemove);
  canvas.addEventListener('mouseleave', canvas._portMouseleave);
  document.addEventListener('mousemove', canvas._docLeave);
}

function renderRecentTrades() {
  const container = document.getElementById('homeRecentTrades');
  if(!container) return;
  if(!trades.length){
    container.innerHTML=`<div class="empty-state" style="padding:40px 20px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>Aucun trade enregistré</p></div>`;
    return;
  }
  const sorted = [...dashFilteredTrades()].sort((a,b)=>{
    const da=new Date(a.date+'T'+(a.time||'00:00'));
    const db=new Date(b.date+'T'+(b.time||'00:00'));
    return db-da;
  });
  const recent = sorted.slice(0,5);
  container.innerHTML = recent.map(t=>{
    const pnlDol = t.pnlDollar!==null?t.pnlDollar:null;
    const pnlPct = t.pnlPct!==null?t.pnlPct:null;
    const mainVal = pnlDol!==null?pnlDol:(pnlPct!==null?pnlPct:null);
    const pnlCls  = mainVal!==null?(mainVal>=0?'pos':'neg'):'';
    const pnlDolStr = pnlDol!==null?(pnlDol>=0?'+':'')+pnlDol.toFixed(2)+'$':'–';
    const pnlPctStr = pnlPct!==null?(pnlPct>=0?'+':'')+pnlPct.toFixed(2)+'%':'';
    const dirTag = t.dir==='LONG'
      ? '<span class="tag tag-long" style="font-size:9px;padding:1px 5px">L</span>'
      : '<span class="tag tag-short" style="font-size:9px;padding:1px 5px">S</span>';
    const icon = `<img src="${cryptoIconUrl(t.ticker)}" onerror="this.style.display='none'" style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.06);flex-shrink:0" alt=""/>`;
    return `<div class="recent-trade-row" onclick="openModal(${t.id})">
      <div class="recent-trade-left">
        ${icon}
        <div class="recent-trade-meta">
          <div class="recent-trade-ticker">${escHtml(t.ticker)} ${dirTag}</div>
          <div class="recent-trade-date">${t.date}${t.time?' · '+t.time:''}</div>
        </div>
      </div>
      <div class="recent-trade-right">
        <div class="recent-trade-pnl ${pnlCls}">${pnlDol!==null?`<span data-pnl-px data-v="${pnlDolStr}" data-p="${pnlCls==='pos'?1:0}">${pnlDolStr}</span>`:pnlDolStr}</div>
        ${pnlPctStr?`<div class="recent-trade-pnlpct ${pnlCls}">${pnlPctStr}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

// ─── ANALYTICS ─────────────────────────────────────────────────────────────
function getFiltered() {
  const period=document.getElementById('filterPeriod').value, ticker=document.getElementById('filterTicker').value;
  let f=[...trades];
  if(period!=='all'){const c=new Date();c.setDate(c.getDate()-parseInt(period));f=f.filter(t=>new Date(t.date)>=c);}
  if(ticker!=='all') f=f.filter(t=>t.ticker===ticker);
  if (_typeFilter === 'ideas') f = f.filter(t => !!t.isIdea);
  // Exclure le paper trading, comme le fait l'en-tête (activeTrades) —
  // sinon les stats Analyses divergent des pilules du haut
  else f = f.filter(t => !t.isIdea && !t.isPaper);
  return f;
}
function renderAnalytics() {
  const tickers=[...new Set(trades.filter(t=>!t._isComment).map(t=>t.ticker).filter(x=>x&&x!=='–'))];
  const sel=document.getElementById('filterTicker'); const cur=sel.value;
  sel.innerHTML='<option value="all">Tous</option>'+tickers.map(t=>`<option value="${t}">${t}</option>`).join('');
  if(tickers.includes(cur)) sel.value=cur;
  const data=getFiltered().filter(t=>t.pnlDollar!==null||t.pnlPct!==null);
  if(!data.length){['kpi_wr','kpi_pnl','kpi_rr','kpi_pf'].forEach(id=>document.getElementById(id).textContent='–');destroyCharts();return;}

  const wins=data.filter(t=>(t.pnlDollar??t.pnlPct??0)>=0), losses=data.filter(t=>(t.pnlDollar??t.pnlPct??0)<0);
  const wr=(wins.length/data.length*100).toFixed(1);
  const useDollar=data.some(t=>t.pnlDollar!==null);
  const pUnit=useDollar?'$':'%';
  const pVal=(t)=>useDollar?(t.pnlDollar??0):(t.pnlPct??0);
  const totalPnl=data.reduce((s,t)=>s+pVal(t),0).toFixed(2);
  const rrs=data.filter(t=>t.rrReal!==null).map(t=>t.rrReal);
  const avgRR=rrs.length?(rrs.reduce((a,b)=>a+b,0)/rrs.length).toFixed(2):'–';
  const winRRs =data.filter(t=>t.rrReal!==null&&(t.pnlDollar??t.pnlPct??0)>0).map(t=>t.rrReal);
  const lossRRs=data.filter(t=>t.rrReal!==null&&(t.pnlDollar??t.pnlPct??0)<0).map(t=>t.rrReal);
  const avgWinRR  = winRRs.length  ? (winRRs.reduce((a,b)=>a+b,0)/winRRs.length).toFixed(2)   : null;
  const avgLossRR = lossRRs.length ? (lossRRs.reduce((a,b)=>a+b,0)/lossRRs.length).toFixed(2) : null;
  const gW=wins.reduce((s,t)=>s+Math.abs(pVal(t)),0), gL=losses.reduce((s,t)=>s+Math.abs(pVal(t)),0);
  const pf=gL>0?(gW/gL).toFixed(2):wins.length>0?'∞':'–';

  document.getElementById('kpi_wr').innerHTML=`<span data-pnl-px data-v="${wr}%" data-p="${wr>=50?1:0}">${wr}%</span>`; document.getElementById('kpi_wr').className='kpi-value '+(wr>=50?'pos':'neg');
  document.getElementById('kpi_wr_sub').innerHTML=_pxSpan(`${wins.length}W / ${losses.length}L`, wins.length>=losses.length);
  const _kpiPnlVal=(totalPnl>=0?'+':'')+totalPnl+pUnit;
  const _kpiPnlEl=document.getElementById('kpi_pnl');
  _kpiPnlEl.className='kpi-value '+(totalPnl>=0?'pos':'neg');
  if(useDollar) _kpiPnlEl.innerHTML=`<span data-pnl-px data-v="${_kpiPnlVal}" data-p="${totalPnl>=0?1:0}">${_kpiPnlVal}</span>`;
  else _kpiPnlEl.textContent=_kpiPnlVal;
  document.getElementById('kpi_pnl_sub').textContent='P&L cumulé';
  const _kpiRrEl=document.getElementById('kpi_rr');
  if(avgRR!=='–') _kpiRrEl.innerHTML=_pxSpan(avgRR+'R', parseFloat(avgRR)>=1); else _kpiRrEl.textContent='–';
  _kpiRrEl.className='kpi-value '+(avgRR>0?'pos':'neg');
  if(avgWinRR !== null && avgLossRR !== null) document.getElementById('kpi_rr_sub').innerHTML = _pxSpan('W: +'+avgWinRR+'R  |  L: '+avgLossRR+'R', true);
  else document.getElementById('kpi_rr_sub').textContent = 'sur '+rrs.length+' trades';
  const _kpiPfEl=document.getElementById('kpi_pf');
  if(pf!=='–') _kpiPfEl.innerHTML=_pxSpan(pf, pf==='∞'||parseFloat(pf)>=1); else _kpiPfEl.textContent='–';
  _kpiPfEl.className='kpi-value '+(parseFloat(pf)>=1?'pos':'neg');
  document.getElementById('kpi_pf_sub').textContent='gross win / gross loss';

  destroyCharts();
  const sorted=[...data].sort((a,b)=>new Date(a.date+' '+a.time)-new Date(b.date+' '+b.time));

  // Equity
  let cum=0; const eqD=sorted.map(t=>{cum+=pVal(t);return+cum.toFixed(2);}); const eqColor=eqD[eqD.length-1]>=0?'#10b981':'#ef4444';
  _equityRevealColor = eqColor;
  const eqLabels = sorted.map(t=>t.date+' '+t.time);
  const eqOpts = chartOpts('P&L '+pUnit, true);
  eqOpts.plugins = eqOpts.plugins || {}; eqOpts.plugins.tooltip = { enabled: false };
  eqOpts.scales = eqOpts.scales || {};
  eqOpts.scales.x = { ...(eqOpts.scales?.x||{}), grid:{display:false}, border:{display:false} };
  eqOpts.scales.y = { ...(eqOpts.scales?.y||{}), grid:{display:false}, border:{display:false} };
  const eqCanvas = document.getElementById('chartEquity');
  charts.equity=new Chart(eqCanvas,{type:'line',data:{labels:eqLabels,datasets:[{data:eqD,borderColor:isLight()?'rgba(30,30,58,0.22)':'rgba(255,255,255,0.22)',backgroundColor:'transparent',fill:false,tension:0.4,cubicInterpolationMode:'monotone',pointRadius:0,pointHoverRadius:0,borderWidth:2}]},options:eqOpts,plugins:[analyticsEquityRevealPlugin]});
  // Hover reveal for chartEquity
  (function(){
    const canvas=eqCanvas, tooltip=document.getElementById('chartEquityTooltip');
    const LERP=0.06;
    function _eqRevealTick(chart,pts){
      const tgt=chart._revealTarget;
      if(tgt===null){chart._revealIdx=null;chart._revealIdxF=null;chart._revealX=null;chart._revealY=null;chart._revealAnimId=null;chart.update('none');if(tooltip)tooltip.style.display='none';return;}
      const cur=chart._revealIdxF??tgt; const nxt=cur+(tgt-cur)*LERP;
      chart._revealIdxF=nxt; chart._revealIdx=Math.round(nxt);
      const{x:_ex,y:_ey}=bezierPointAt(pts,nxt); chart._revealX=_ex; chart._revealY=_ey;
      chart.update('none');
      if(tooltip){
        const ci=chart._revealIdx; const val=eqD[ci]; const lbl=eqLabels[ci];
        tooltip.innerHTML=`<div style="font-size:15px;font-weight:800;color:var(--text)">${val>=0?'+':''}${val.toFixed(2)}${pUnit}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">${lbl}</div>`;
        const rx=chart._revealX; const tw=tooltip.offsetWidth||140; const rect=canvas.getBoundingClientRect();
        tooltip.style.left=(rx+14+tw>rect.width?rx-tw-14:rx+14)+'px';
        tooltip.style.top=(chart.chartArea.top+10)+'px'; tooltip.style.display='block';
      }
      if(Math.abs(nxt-tgt)>0.02){chart._revealAnimId=requestAnimationFrame(()=>_eqRevealTick(chart,pts));}
      else{const si=Math.round(tgt);chart._revealIdxF=si;chart._revealIdx=si;const sp=pts[Math.min(si,pts.length-1)];chart._revealX=sp.x;chart._revealY=sp.y;chart._revealAnimId=null;chart.update('none');}
    }
    if(canvas._portMousemove)  canvas.removeEventListener('mousemove',  canvas._portMousemove);
    if(canvas._portMouseleave) canvas.removeEventListener('mouseleave', canvas._portMouseleave);
    if(canvas._docLeave)       document.removeEventListener('mousemove', canvas._docLeave);

    canvas._portMousemove=e=>{
      const chart=charts.equity;if(!chart)return;
      // Mode privé : pas d'infobulle au survol (elle révélerait la valeur masquée)
      if(_pnlHidden){ if(tooltip) tooltip.style.display='none'; return; }
      const rect=canvas.getBoundingClientRect();const mx=(e.clientX-rect.left)*(chart.width/rect.width);const{chartArea}=chart;
      if(!chartArea||mx<chartArea.left||mx>chartArea.right) return;
      const pts=chart.getDatasetMeta(0).data;let ci=0,cd=Infinity;pts.forEach((p,i)=>{const d=Math.abs(p.x-mx);if(d<cd){cd=d;ci=i;}});
      chart._revealTarget=ci;if(!chart._revealAnimId)chart._revealAnimId=requestAnimationFrame(()=>_eqRevealTick(chart,pts));
    };
    canvas._portMouseleave=()=>{ if(tooltip) tooltip.style.display='none'; };
    canvas._docLeave=e=>{const r=canvas.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)if(tooltip)tooltip.style.display='none';};

    canvas.addEventListener('mousemove',  canvas._portMousemove);
    canvas.addEventListener('mouseleave', canvas._portMouseleave);
    document.addEventListener('mousemove', canvas._docLeave);
  })();

  // Distribution
  const bins=useDollar?[-1000,-500,-200,-100,-50,-20,0,20,50,100,200,500,1000]:[-50,-30,-20,-10,-5,0,5,10,20,30,50];
  const dc=Array(bins.length-1).fill(0); data.forEach(t=>{const v=pVal(t);for(let i=0;i<bins.length-1;i++){if(v>=bins[i]&&v<bins[i+1]){dc[i]++;break;}}});
  charts.dist=new Chart(document.getElementById('chartDist'),{type:'bar',data:{labels:bins.slice(0,-1).map((b,i)=>`${b}→${bins[i+1]}`),datasets:[{data:dc,backgroundColor:bins.slice(0,-1).map(b=>b>=0?'rgba(16,185,129,0.75)':'rgba(239,68,68,0.75)'),borderRadius:5}]},options:chartOpts('Trades')});

  // RR
  const rrF=sorted.filter(t=>t.rrReal!==null); const rrV=rrF.map(t=>t.rrReal);
  charts.rr=new Chart(document.getElementById('chartRR'),{type:'bar',data:{labels:rrF.map((_,i)=>'#'+(i+1)),datasets:[{data:rrV,backgroundColor:rrV.map(v=>v>=0?'rgba(16,185,129,0.75)':'rgba(239,68,68,0.75)'),borderRadius:5}]},options:chartOpts('RR')});

  // Ticker
  const bt={};data.forEach(t=>{bt[t.ticker]=(bt[t.ticker]||0)+pVal(t);});const tk=Object.keys(bt),tv=tk.map(k=>+bt[k].toFixed(2));
  charts.ticker=new Chart(document.getElementById('chartTicker'),{type:'bar',data:{labels:tk,datasets:[{data:tv,backgroundColor:tv.map(v=>v>=0?'rgba(16,185,129,0.75)':'rgba(239,68,68,0.75)'),borderRadius:5}]},options:chartOpts(pUnit)});

  // Long/Short
  const lW=data.filter(t=>t.dir==='LONG'&&(t.pnlPct??0)>=0).length,lL=data.filter(t=>t.dir==='LONG'&&(t.pnlPct??0)<0).length;
  const sW=data.filter(t=>t.dir==='SHORT'&&(t.pnlPct??0)>=0).length,sL=data.filter(t=>t.dir==='SHORT'&&(t.pnlPct??0)<0).length;
  charts.dir=new Chart(document.getElementById('chartDir'),{type:'doughnut',data:{labels:['Long Win','Long Loss','Short Win','Short Loss'],datasets:[{data:[lW,lL,sW,sL],backgroundColor:['rgba(16,185,129,0.85)','rgba(239,68,68,0.85)','rgba(124,58,237,0.85)','rgba(245,158,11,0.85)'],borderColor:chartGrid(),borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:chartLegend(),font:{family:'Inter',size:12}}},tooltip:{enabled:!_pnlHidden}}}});
}
function destroyCharts() { Object.values(charts).forEach(c=>{if(c){if(c._revealAnimId){cancelAnimationFrame(c._revealAnimId);c._revealAnimId=null;}c.destroy();}}); charts={}; }
function destroyHomeEquity() { if(charts.homeEquity){charts.homeEquity.destroy();delete charts.homeEquity;} }
function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
function chartGrid()        { return isLight() ? 'rgba(0,0,0,0.07)'            : 'rgba(255,255,255,0.04)'; }
function chartTick()        { return isLight() ? '#6b7280'                     : '#64748b'; }
function chartTooltipBg()   { return isLight() ? 'rgba(255,255,255,0.97)'      : 'rgba(13,13,39,0.95)'; }
function chartTooltipTitle(){ return isLight() ? '#6b7280'                     : '#94a3b8'; }
function chartTooltipBody() { return isLight() ? '#1e1e3a'                     : '#e2e8f0'; }
function chartLegend()      { return isLight() ? '#6b7280'                     : '#94a3b8'; }

function chartOpts(yLabel,showX=false) {
  // tooltip.enabled=false en mode privé : ces graphiques (Distribution, RR,
  // Ticker, P&L sessions) utilisent le tooltip natif Chart.js, qui révélerait
  // les valeurs exactes au survol si on ne le désactivait pas explicitement.
  return {responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{enabled:!_pnlHidden,backgroundColor:chartTooltipBg(),borderColor:'rgba(124,58,237,0.3)',borderWidth:1,titleColor:chartTooltipTitle(),bodyColor:chartTooltipBody(),padding:10}},scales:{x:{display:showX,ticks:{color:chartTick(),font:{family:'Inter',size:10},maxTicksLimit:8,maxRotation:0},grid:{color:chartGrid()}},y:{ticks:{color:chartTick(),font:{family:'Inter',size:10}},grid:{color:chartGrid()}}}};
}

// ─── CALENDAR ──────────────────────────────────────────────────────────────
function renderCalendar() {
  const MONTHS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  document.getElementById('calTitle').textContent=MONTHS[calMonth]+' '+calYear;
  const grid=document.getElementById('calGrid'); grid.innerHTML='';
  let offset=new Date(calYear,calMonth,1).getDay()-1; if(offset<0) offset=6;
  const dIM=new Date(calYear,calMonth+1,0).getDate();
  const today=new Date();
  const byDate={};
  trades.forEach(t=>{ if(t._isComment) return; if(!byDate[t.date]) byDate[t.date]=[]; byDate[t.date].push(t); });

  for(let i=0;i<offset;i++) grid.insertAdjacentHTML('beforeend','<div class="cal-day empty"></div>');
  for(let d=1;d<=dIM;d++){
    const ds=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const dt=byDate[ds]||[];
    const dtTaken=dt.filter(t=>!t.isIdea&&(t.pnlDollar!=null||t.pnlPct!=null));
    const dtIdeas=dt.filter(t=>!!t.isIdea);
    const isT=today.getFullYear()===calYear&&today.getMonth()===calMonth&&today.getDate()===d;
    const useDollar=dtTaken.some(t=>t.pnlDollar!=null);
    let pnlDay=dtTaken.length?dtTaken.reduce((s,t)=>s+(useDollar?(t.pnlDollar??0):(t.pnlPct??0)),0):null;
    let cls='cal-day'+(isT?' today':'')+(dtTaken.length?(pnlDay>=0?' green-day':' red-day'):(dt.length?' neutral-day':''));
    const _calPnlV=pnlDay!==null?`${pnlDay>=0?'+':''}${pnlDay.toFixed(0)}${useDollar?'$':'%'}`:'';
    const _calPnlI=useDollar&&pnlDay!==null?`<span data-pnl-px data-v="${_calPnlV}" data-p="${pnlDay>=0?1:0}">${_calPnlV}</span>`:_calPnlV;
    const pnlStr=pnlDay!==null?`<div class="cal-pnl ${pnlDay>=0?'pos':'neg'}">${_calPnlI}</div>`:'';
    const takenCnt=dtTaken.length?`${dtTaken.length}T`:'';
    const ideaCnt=dtIdeas.length?`${dtIdeas.length}💡`:'';
    const cntStr=dt.length?`<div class="cal-count">${[takenCnt,ideaCnt].filter(Boolean).join(' ')}</div>`:'';
    grid.insertAdjacentHTML('beforeend',`<div class="${cls}" onclick="${dt.length?`showDayTrades('${ds}')`:''}" style="${dt.length?'cursor:pointer':'cursor:default'}"><span class="cal-day-num">${d}</span>${pnlStr}${cntStr}</div>`);
  }
}
function calPrev(){
  if(calViewMode==='months'){calYear--;renderCalendarMonths();}
  else{calMonth--;if(calMonth<0){calMonth=11;calYear--;}(window.renderCalendar||renderCalendar)();}
}
function calNext(){
  if(calViewMode==='months'){calYear++;renderCalendarMonths();}
  else{calMonth++;if(calMonth>11){calMonth=0;calYear++;}(window.renderCalendar||renderCalendar)();}
}

function showDayTrades(ds) {
  const dt=trades.filter(t=>t.date===ds); if(!dt.length) return;
  const taken=dt.filter(t=>!t.isIdea&&(t.pnlDollar!=null||t.pnlPct!=null));
  const ideas=dt.filter(t=>!!t.isIdea);
  const useDollar=taken.some(t=>t.pnlDollar!=null);
  const total=taken.reduce((s,t)=>s+(useDollar?(t.pnlDollar??0):(t.pnlPct??0)),0);
  const pUnit=useDollar?'$':'%'; const pc=total>=0?'pos':'neg';
  const takenLabel=taken.length?`<span>${taken.length} pris</span>`:'';
  const ideaLabel=ideas.length?`<span style="color:var(--text2)">${ideas.length} idée${ideas.length>1?'s':''}</span>`:'';
  const _totalV=`${total>=0?'+':''}${total.toFixed(2)}${pUnit}`;
  const _totalI=useDollar?`<span data-pnl-px data-v="${_totalV}" data-p="${total>=0?1:0}">${_totalV}</span>`:_totalV;
  const totalLabel=taken.length?`<span class="${pc}" style="font-weight:700">Total: ${_totalI}</span>`:'';
  const renderRow=(t,isIdea)=>{
    const p=(t.pnlDollar??t.pnlPct??0);
    const pc2=p>=0?'pos':'neg';
    const icon=`<img src="${cryptoIconUrl(t.ticker)}" onerror="this.style.display='none'" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:6px" alt=""/>`;
    const _psV=t.pnlDollar!=null?(t.pnlDollar>=0?'+':'')+parseFloat(t.pnlDollar).toFixed(2)+'$':null;
    const ps=_psV!=null?`<span data-pnl-px data-v="${_psV}" data-p="${t.pnlDollar>=0?1:0}">${_psV}</span>`:(t.pnlPct!=null?(t.pnlPct>=0?'+':'')+parseFloat(t.pnlPct).toFixed(2)+'%':'–');
    const ideaBadge=isIdea?`<span style="font-size:10px;background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.3);border-radius:5px;padding:1px 5px;margin-left:6px">💡 idée</span>`:'';
    const rowBg=isIdea?'rgba(255,255,255,0.015)':'rgba(255,255,255,0.03)';
    const hoverBg=isIdea?'rgba(99,102,241,0.06)':'rgba(124,58,237,0.08)';
    const pnlStyle=isIdea?`color:var(--text2);font-style:italic;font-weight:500`:`font-weight:700`;
    const dirClr=t.dir==='LONG'?'var(--green)':'var(--red)';
    const metaParts=[
      t.title?`<span style="font-style:italic;color:rgba(255,255,255,0.9);background:rgba(255,255,255,0.09);padding:1px 8px;border-radius:5px;border:1px solid rgba(255,255,255,0.1)">${escHtml(t.title)}</span>`:'',
      `<span style="color:${dirClr};font-weight:600">${t.dir}</span>`,
      t.time?`<span>${t.time}</span>`:''
    ].filter(Boolean).join(`<span style="opacity:.4"> · </span>`);
    const gradeRight=t.setupGrade?`<div style="margin-bottom:3px;text-align:right">${gradeTag(t.setupGrade,'sm')}</div>`:'';
    const defaultOpacity=isIdea?'0.7':(t.reviewed?'0.52':'1');
    const reviewBtn=!isIdea?`<button onclick="event.stopPropagation();_dayToggleReview(${t.id},'${ds}')" class="btn-review${t.reviewed?' done':''}" style="width:24px;height:24px;border-radius:6px;border:1px solid;border-color:${t.reviewed?'rgba(139,71,240,0.5)':'var(--border2)'};background:${t.reviewed?'rgba(124,58,237,0.13)':'transparent'};cursor:pointer;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0" title="${t.reviewed?'Retirer le review':'Marquer comme reviewé'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="${t.reviewed?'currentColor':'none'}" stroke="${t.reviewed?'rgba(255,255,255,0.9)':'currentColor'}" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3" fill="${t.reviewed?'rgba(255,255,255,0.25)':'none'}"/></svg></button>`:''
    return`<div onclick="openModal(${t.id},'${ds}')" style="cursor:pointer;padding:10px 14px;background:${rowBg};border:1px solid var(--border2);border-radius:10px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;transition:background .15s;opacity:${defaultOpacity}" onmouseover="this.style.background='${hoverBg}';this.style.opacity='1'" onmouseout="this.style.background='${rowBg}';this.style.opacity='${defaultOpacity}'"><span style="display:flex;align-items:center;gap:8px;min-width:0;overflow:hidden">${icon}<strong style="font-size:13px;white-space:nowrap;flex-shrink:0">${t.ticker}</strong><span style="width:1px;height:14px;background:rgba(255,255,255,0.14);flex-shrink:0"></span><span style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${metaParts}</span>${ideaBadge}</span><div style="display:flex;align-items:center;gap:8px;flex-shrink:0">${reviewBtn}<div style="text-align:right">${gradeRight}<span class="${isIdea?'':''+pc2}" style="${pnlStyle}">${ps}</span></div></div></div>`;
  };
  document.getElementById('modalContent').innerHTML=`
    <div style="margin-bottom:16px">
      <div style="font-size:18px;font-weight:800;margin-bottom:6px">${ds}</div>
      <div style="display:flex;gap:16px;font-size:13px;color:var(--text2);flex-wrap:wrap">
        ${takenLabel}${ideaLabel}${totalLabel}
      </div>
    </div>
    ${taken.map(t=>renderRow(t,false)).join('')}
    ${ideas.length&&taken.length?`<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--text2);margin:12px 0 8px">Idées</div>`:''}
    ${ideas.map(t=>renderRow(t,true)).join('')}`;
  document.getElementById('tradeModal').classList.add('open');
}

// ─── PORTFOLIO ─────────────────────────────────────────────────────────────
function addPortfolioPoint() {
  const val=parseFloat(document.getElementById('p_value').value);
  const date=document.getElementById('p_date').value;
  if(isNaN(val)||!date){alert('Renseigne une valeur et une date.');return;}
  portfolioPoints=portfolioPoints.filter(p=>p.date!==date);
  portfolioPoints.push({date,value:val});
  portfolioPoints.sort((a,b)=>a.date.localeCompare(b.date));
  savePortfolio(); renderPortfolioChart();
  document.getElementById('p_value').value='';
}
// ─── CHART VISUAL HELPERS ──────────────────────────────────────────────────

function colorToRgb(color) {
  if (!color) return '16,185,129';
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return `${m[1]},${m[2]},${m[3]}`;
  if (color.startsWith('#') && color.length >= 7)
    return `${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)}`;
  return '16,185,129';
}

function areaGradient(context, rgb, alphaTop=0.42) {
  const {chart} = context;
  const {ctx, chartArea} = chart;
  if (!chartArea) return `rgba(${rgb},${alphaTop})`;
  const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0,    `rgba(${rgb},${alphaTop})`);
  g.addColorStop(0.42, `rgba(${rgb},${+(alphaTop * 0.18).toFixed(3)})`);
  g.addColorStop(1,    `rgba(${rgb},0)`);
  return g;
}

// Dots plugin placeholder (disabled)
const areaDotsPlugin = { id: 'areaDots' };

// ─── STRATEGY TEST ─────────────────────────────────────────────────────────

// ─── V2 ANIMATION SYSTEM ───────────────────────────────────────────────────

// Cursor glow follower — RAF loop auto-stop quand convergé (évite le cursor flicker Chrome)
(function() {
  const glow = document.getElementById('cursor-glow');
  if (!glow) return;
  let mx = window.innerWidth / 2, my = window.innerHeight / 2;
  let gx = mx, gy = my;
  const SPEED = 0.085;
  let hasMovedOnce = false;
  let rafId = null;

  function loop() {
    const dx = mx - gx, dy = my - gy;
    gx += dx * SPEED;
    gy += dy * SPEED;
    glow.style.transform = `translate(${gx - 45}px, ${gy - 45}px)`;
    if (Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = null; // arrêt : glow convergé, plus de mise à jour DOM
    }
  }

  glow.style.opacity = '0';
  document.addEventListener('mousemove', e => {
    mx = e.clientX; my = e.clientY;
    if (!hasMovedOnce) { hasMovedOnce = true; gx = mx; gy = my; glow.style.opacity = '1'; }
    if (!rafId) rafId = requestAnimationFrame(loop); // relance uniquement si arrêté
  });

  // Color cursor glow based on region (left=violet, right=teal)
  document.addEventListener('mousemove', e => {
    const ratio = e.clientX / window.innerWidth;
    const r1 = Math.round(124 + (6-124)*ratio);
    const g1 = Math.round(58  + (182-58)*ratio);
    const b1 = Math.round(237 + (212-237)*ratio);
    glow.style.background = `radial-gradient(circle, rgba(${r1},${g1},${b1},0.08) 0%, rgba(${r1},${g1},${b1},0.03) 42%, transparent 70%)`;
  });
})();

// Note tooltip
(function() {
  const tooltip = document.getElementById('note-tooltip');
  if (!tooltip) return;
  let hideTimer = null;

  document.addEventListener('mouseover', e => {
    const icon = e.target.closest('.note-icon');
    if (!icon) return;
    const note          = icon.getAttribute('data-note');
    const noteLevels    = icon.getAttribute('data-note-levels');
    const reviewComment = icon.getAttribute('data-review-comment');
    const reviewGrade   = icon.getAttribute('data-review-grade');
    if (!note && !noteLevels && !reviewComment && !reviewGrade) return;
    clearTimeout(hideTimer);
    // Label "Note" fixe via ::before ; contenu (1 ou 2 sous-sections) injecté ici
    let html = _noteSectionsHtml(note, noteLevels);
    if (reviewComment || reviewGrade) {
      html += `<div class="note-section" style="margin-top:${html?'16px':'0'}"><div class="note-section-lbl" style="color:#22d3ee">🔁 Review${reviewGrade?' — '+escHtml(reviewGrade):''}</div>${reviewComment?`<div class="note-section-txt">${escHtml(reviewComment)}</div>`:''}</div>`;
    }
    tooltip.innerHTML = html;
    tooltip.classList.add('visible');
    // Position: above the icon, or below if not enough room
    requestAnimationFrame(() => {
      const rect = icon.getBoundingClientRect();
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      let x = rect.left;
      let y = rect.top - th - 8;
      if (y < 8) y = rect.bottom + 8;
      if (x + tw > window.innerWidth - 12) x = window.innerWidth - tw - 12;
      if (x < 8) x = 8;
      tooltip.style.left = x + 'px';
      tooltip.style.top  = y + 'px';
    });
  });

  document.addEventListener('mouseout', e => {
    if (!e.target.closest('.note-icon')) return;
    hideTimer = setTimeout(() => tooltip.classList.remove('visible'), 120);
  });
})();

// Tab click ripple
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', function(e) {
    const rect = this.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'tab-ripple';
    ripple.style.left = (e.clientX - rect.left - 5) + 'px';
    ripple.style.top  = (e.clientY - rect.top  - 5) + 'px';
    this.appendChild(ripple);
    setTimeout(() => ripple.remove(), 580);
  });
});

// KPI count-up animation — accepte une liste d'IDs optionnelle
function animateKPIs(ids) {
  const targets = ids || ['kpi_wr', 'kpi_pnl', 'kpi_rr', 'kpi_pf'];
  targets.forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    // Préserver le span pixel-masquable : l'animation écrase textContent,
    // on restaure le markup original à la fin (sinon le masquage n'a plus de prise)
    const pxHtml = el.querySelector('[data-pnl-px]') ? el.innerHTML : null;
    const finalText = el.textContent.trim();
    if (!finalText || finalText === '–' || finalText === '∞') return;

    // Extract: optional sign, number, suffix
    const m = finalText.match(/^([+\-]?)([\d.]+)(.*)$/);
    if (!m) return;
    const sign   = m[1];
    const numStr = m[2];
    const suffix = m[3];
    const target = parseFloat(numStr);
    if (isNaN(target) || target === 0) return;
    const decimals = numStr.includes('.') ? numStr.split('.')[1].length : 0;

    // Immédiatement à 0 pour éviter le flash du "–"
    el.textContent = sign + (0).toFixed(decimals) + suffix;

    const DURATION = 750;
    const DELAY    = idx * 80;

    setTimeout(() => {
      el.classList.add('kpi-pop');
      let startTs = null;
      const tick = (ts) => {
        if (!startTs) startTs = ts;
        const p    = Math.min((ts - startTs) / DURATION, 1);
        const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
        const cur  = target * ease;
        el.textContent = sign + cur.toFixed(decimals) + suffix;
        if (p < 1) requestAnimationFrame(tick);
        else {
          if (pxHtml !== null) el.innerHTML = pxHtml;
          else el.textContent = finalText;
          el.classList.remove('kpi-pop');
        }
      };
      requestAnimationFrame(tick);
    }, DELAY);
  });
}

// ─── ANALYTICS SUB-TABS ────────────────────────────────────────────────────
function switchAnalyticsTab(tab) {
  localStorage.setItem('tjournal_atab', tab);
  document.querySelectorAll('.atab').forEach(b => b.classList.remove('active'));
  document.getElementById('atab-' + tab).classList.add('active');
  document.getElementById('analytics-stats').style.display      = (tab === 'stats')      ? '' : 'none';
  document.getElementById('analytics-projection').style.display = (tab === 'projection') ? '' : 'none';
  if (tab === 'projection') {
    prefillProjectionInputs();
    requestAnimationFrame(() => renderProjection());
  } else {
    requestAnimationFrame(() => (window.renderAnalytics || renderAnalytics)());
  }
}

// ─── PROJECTION: PRE-FILL INPUTS FROM REAL TRADES ──────────────────────────
let proj_prefilled = false;
function prefillProjectionInputs() {
  if (proj_prefilled) return;
  if (!trades.length) return;

  // WR% et trades/mois depuis les vrais trades
  const byMonth = {};
  trades.forEach(t => {
    if (t._isComment || !t.date) return;
    const key = t.date.slice(0, 7);
    if (!byMonth[key]) byMonth[key] = { w: 0, l: 0 };
    if ((t.pnlPct ?? 0) >= 0) byMonth[key].w++; else byMonth[key].l++;
  });
  const mvals = Object.values(byMonth);
  if (mvals.length) {
    const avgW   = mvals.reduce((s, m) => s + m.w, 0) / mvals.length;
    const avgL   = mvals.reduce((s, m) => s + m.l, 0) / mvals.length;
    const avgTpm = avgW + avgL;
    const avgWR  = avgTpm > 0 ? (avgW / avgTpm) * 100 : 50;
    if (!document.getElementById('proj_wr').value)
      document.getElementById('proj_wr').value = avgWR.toFixed(1);
    if (!document.getElementById('proj_tpm').value)
      document.getElementById('proj_tpm').value = Math.max(1, Math.round(avgTpm));
  }

  // RR cible depuis les vrais trades (hors manqués)
  const at = activeTrades();
  const winTrades = at.filter(t => (t.pnlPct ?? 0) >= 0);
  const w = at.length ? winTrades.length / at.length : 0;
  const rrs = at.filter(t => t.rrReal != null && !isNaN(t.rrReal));
  if (rrs.length && w > 0) {
    const avgRR = rrs.reduce((s, t) => s + t.rrReal, 0) / rrs.length;
    const rr_cible = (avgRR + (1 - w)) / w;
    if (!document.getElementById('proj_rr').value)
      document.getElementById('proj_rr').value = Math.max(0, rr_cible).toFixed(2);
  }
  updateProjExpected();

  // Avg risk
  const risks = at.filter(t => t.risk !== null && t.risk !== undefined && !isNaN(parseFloat(t.risk)));
  if (risks.length) {
    const avgRisk = risks.reduce((s, t) => s + parseFloat(t.risk), 0) / risks.length;
    if (!document.getElementById('proj_risk').value)
      document.getElementById('proj_risk').value = avgRisk.toFixed(2);
  }

  proj_prefilled = true;
}

// ─── PROJECTION: RENDER ─────────────────────────────────────────────────────
function renderProjection() {
  // 1. Read inputs (use sensible defaults if empty)
  const capital   = parseFloat(document.getElementById('proj_capital').value)    || 1000;
  const wr_pct    = parseFloat(document.getElementById('proj_wr').value)           || 50;
  const tpm       = parseFloat(document.getElementById('proj_tpm').value)          || 3;
  const rr_cible  = parseFloat(document.getElementById('proj_rr').value)           || 1.9;
  const risk      = parseFloat(document.getElementById('proj_risk').value)         || 1;
  const monthly   = parseFloat(document.getElementById('proj_monthly').value)      || 0;
  const years     = parseInt(document.getElementById('proj_years').value)          || 20;
  const leverage   = parseFloat(document.getElementById('proj_leverage')?.value)   || 1;
  const months    = years * 12;
  const r  = risk / 100;
  const w  = wr_pct / 100;
  // Frais réels : taker 0.045% + maker 0.015% = 0.060% aller-retour, sur position totale (= capital × levier)
  const FEE_RT     = 0.0006;
  const r_eff      = r * leverage;               // risque effectif par trade (fraction du capital)
  const fee_frac   = FEE_RT * leverage;          // frais par trade (fraction du capital)
  const rwin_frac  = rr_cible * r_eff - fee_frac;   // gain net si win
  const rloss_frac = r_eff + fee_frac;               // perte nette si loss

  const fmt = v => v >= 1e6 ? (v/1e6).toFixed(2)+'M$' : v >= 1e3 ? (v/1e3).toFixed(1)+'k$' : v.toFixed(0)+'$';

  // 1b. Phase 2 params
  const phase2Active   = document.getElementById('proj_phase2_enabled')?.checked ?? false;
  const p2Year         = parseInt(document.getElementById('proj_p2_year')?.value)      || 0;
  const p2Withdrawal   = parseFloat(document.getElementById('proj_p2_withdrawal')?.value) || 0;
  const p2Tpm          = tpm;
  const transitionMonth = phase2Active ? Math.min(p2Year * 12, months) : months + 1;

  // helper : params selon la phase
  const phaseFlow = m => m > transitionMonth ? -p2Withdrawal : monthly;
  const phaseTpm  = m => m > transitionMonth ? p2Tpm : tpm;

  // 2. Deterministic equity curve
  const rr_exp = w * rwin_frac - (1 - w) * rloss_frac;  // espérance par trade (fraction capital)
  const mu = 1 + rr_exp;
  const detCurve = [capital];
  for (let m = 1; m <= months; m++) {
    const prev = detCurve[m - 1];
    const next = Math.max(0, (prev + phaseFlow(m)) * Math.pow(mu, phaseTpm(m)));
    detCurve.push(next);
  }

  // 3. Monte Carlo — 300 simulations
  const N_SIM = 300;
  const allSims = [];
  for (let s = 0; s < N_SIM; s++) {
    const sim = [capital];
    let cap = capital;
    for (let m = 1; m <= months; m++) {
      cap = Math.max(0, cap + phaseFlow(m));
      const trades = phaseTpm(m);
      for (let t = 0; t < trades; t++) {
        cap = Math.max(0, Math.random() < w ? cap * (1 + rwin_frac) : cap * (1 - rloss_frac));
      }
      sim.push(cap);
    }
    allSims.push(sim);
  }
  // Percentiles at each month
  const p10 = [], p50 = [], p90 = [];
  for (let m = 0; m <= months; m++) {
    const vals = allSims.map(s => s[m]).sort((a, b) => a - b);
    p10.push(vals[Math.floor(N_SIM * 0.10)]);
    p50.push(vals[Math.floor(N_SIM * 0.50)]);
    p90.push(vals[Math.floor(N_SIM * 0.90)]);
  }

  // 4. Monthly delta (from deterministic)
  const monthlyDelta = detCurve.slice(1).map((v, i) => +(v - detCurve[i]).toFixed(2));

  // 5. Labels
  // fullLabels : label complet pour chaque mois (utilisé dans les tooltips)
  const fullLabels = Array.from({ length: months + 1 }, (_, i) => {
    if (i === 0) return 'Départ';
    const y = Math.floor((i - 1) / 12);
    const m = ((i - 1) % 12) + 1;
    if (y === 0) return `Mois ${m}`;
    return `An ${y} · Mois ${m}`;
  });
  // labels épars pour l'axe X (évite le surencombrement)
  // v = index de données → toujours utiliser labels[v] dans le callback, jamais labels[i]
  const labels = Array.from({ length: months + 1 }, (_, i) => {
    if (i === 0) return 'Départ';
    if (i % 12 === 0) return `${i / 12}a`;
    return '';
  });

  // 6. Summary stats
  const setS = (id, val, cls = '') => {
    document.getElementById(id).textContent = val;
    if (cls) document.getElementById(id).className = 'kpi-value ' + cls;
  };
  setS('proj_s1y',  fmt(detCurve[Math.min(12, months)]));
  setS('proj_s5y',  fmt(detCurve[Math.min(60, months)]));
  setS('proj_s10y', fmt(detCurve[Math.min(120, months)]));
  const cap20y = months >= 240 ? detCurve[240] : (() => {
    let v = capital;
    for (let m = 1; m <= 240; m++) v = (v + monthly) * Math.pow(mu, tpm);
    return v;
  })();
  setS('proj_s20y', fmt(cap20y));
  const cagr = (Math.pow(detCurve[months] / capital, 1 / years) - 1) * 100;
  setS('proj_scagr', cagr.toFixed(1) + '%', cagr >= 0 ? 'pos' : 'neg');
  const fracThreshold = (curve, threshold) => {
    for (let i = 1; i < curve.length; i++) {
      if (curve[i] >= threshold) {
        const frac = (threshold - curve[i - 1]) / (curve[i] - curve[i - 1]);
        return i - 1 + frac;
      }
    }
    return -1;
  };
  const fmtDuration = f => {
    if (f < 0) return '> ' + years + 'a';
    const totalM = Math.round(f);
    if (totalM <= 0) return '< 1m';
    const y = Math.floor(totalM / 12), m = totalM % 12;
    if (y === 0) return `${m} mois`;
    return m === 0 ? `${y} an${y > 1 ? 's' : ''}` : `${y}a ${m}m`;
  };
  const idx100k = fracThreshold(detCurve, 100000);
  const idx1m   = fracThreshold(detCurve, 1000000);
  document.getElementById('proj_s100k').textContent = fmtDuration(idx100k);
  document.getElementById('proj_s1m').textContent   = fmtDuration(idx1m);
  animateKPIs(['proj_s1y','proj_s5y','proj_s10y','proj_s20y','proj_scagr']);

  // 8. Destroy old projection charts only
  if (charts.projection)  { if(charts.projection._revealAnimId){cancelAnimationFrame(charts.projection._revealAnimId);charts.projection._revealAnimId=null;} charts.projection.destroy();  delete charts.projection; }
  if (charts.projMonthly) { charts.projMonthly.destroy(); delete charts.projMonthly; }

  // 8b. Plugin de rupture Phase 2 (fermeture sur transitionMonth/months/fmt)
  const phaseBreakPlugin = {
    id: 'phaseBreak',
    afterDraw(chart) {
      if (!phase2Active || transitionMonth <= 0 || transitionMonth >= months) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x.getPixelForValue(transitionMonth);
      if (!x || x <= chartArea.left || x >= chartArea.right) return;
      ctx.save();
      // Zone Phase 2 (fond léger)
      ctx.fillStyle = 'rgba(245,158,11,0.05)';
      ctx.fillRect(x, chartArea.top, chartArea.right - x, chartArea.bottom - chartArea.top);
      // Ligne verticale tiretée
      ctx.strokeStyle = 'rgba(245,158,11,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      // Badge "Phase 2"
      const label = `Phase 2 — ${p2Year}a`;
      ctx.font = '600 10px Inter, sans-serif';
      const tw = ctx.measureText(label).width;
      const bx = x + 6, by = chartArea.top + 8;
      ctx.fillStyle = 'rgba(245,158,11,0.18)';
      ctx.beginPath();
      ctx.roundRect(bx - 4, by - 11, tw + 10, 16, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(245,158,11,0.95)';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 1, by + 1);
      ctx.restore();
    }
  };

  // 9. Main equity chart (Monte Carlo bands + deterministic)
  const projCanvas = document.getElementById('chartProjection');
  charts.projection = new Chart(projCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        // p90 band top (no border, just for fill reference)
        { data: p90, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false,
          backgroundColor: 'transparent', borderColor: 'transparent' },
        // p10 band bottom — fills up to p90
        { data: p10, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0,
          fill: '-1', backgroundColor: 'rgba(124,58,237,0.17)', borderColor: 'transparent' },
        // p50 median (dashed)
        { label: 'Médiane MC', data: p50, borderColor: 'rgba(180,155,255,0.82)',
          backgroundColor: 'transparent', pointHoverRadius: 0,
          borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, fill: false },
        // Deterministic curve
        { label: 'Courbe attendue', data: detCurve, borderColor: '#10b981',
          backgroundColor: 'transparent', pointHoverRadius: 0,
          borderWidth: 2.5, pointRadius: 0, fill: false,
          tension: 0.35, cubicInterpolationMode: 'monotone' },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true },
      hover: { mode: 'nearest', intersect: true },
      plugins: {
        legend: {
          labels: { color: chartLegend(), font: { family: 'Inter', size: 11 },
            filter: item => item.datasetIndex >= 2 }
        },
        tooltip: { enabled: false }
      },
      scales: {
        x: { ticks: { color: chartTick(), font: { family: 'Inter', size: 10 }, maxTicksLimit: 21,
              callback: v => labels[v] || undefined }, grid: { display: false }, border: { display: false } },
        y: { type: 'logarithmic', ticks: { color: chartTick(), font: { family: 'Inter', size: 10 },
              maxTicksLimit: 6, callback: v => fmt(v) }, grid: { display: false }, border: { display: false } }
      }
    },
    plugins: [projectionCrosshairPlugin, phaseBreakPlugin]
  });

  // Crosshair + tooltip for projection chart (avec lerp) + sync bar chart
  (function(){
    const projTooltip = document.getElementById('chartProjectionTooltip');
    const LERP = 0.06;
    function _clearBarSync() {
      const bt = document.getElementById('chartProjMonthlyTooltip');
      if (bt) bt.style.display = 'none';
    }
    function _syncBar(nxt) {
      const barIdx = Math.round(nxt) - 1;
      if (!charts.projMonthly || barIdx < 0 || barIdx >= monthlyDelta.length) return;
      charts.projMonthly._syncIdx = barIdx;
      const bt = document.getElementById('chartProjMonthlyTooltip');
      if (bt) {
        const v = monthlyDelta[barIdx];
        bt.innerHTML = `<div style="font-size:14px;font-weight:800;color:${v >= 0 ? '#a78bfa' : '#f87171'}">${v >= 0 ? '+' : ''}${fmt(v)}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">${fullLabels[barIdx + 1]}</div>`;
        const bMeta = charts.projMonthly.getDatasetMeta(0);
        const bx = bMeta?.data[barIdx]?.x;
        const bEl = document.getElementById('chartProjMonthly');
        if (bx != null && bEl && charts.projMonthly.chartArea) {
          const tw = bt.offsetWidth || 140;
          const left = bx + 14 + tw > bEl.offsetWidth ? bx - tw - 14 : bx + 14;
          bt.style.left = left + 'px'; bt.style.top = (charts.projMonthly.chartArea.top + 10) + 'px'; bt.style.display = 'block';
        }
      }
      charts.projMonthly.update('none');
    }
    function _projTick(chart, pts) {
      const tgt = chart._revealTarget;
      if (tgt === null) {
        chart._revealX = null; chart._revealIdxF = null; chart._revealAnimId = null;
        chart.update('none'); if (projTooltip) projTooltip.style.display = 'none';
        _clearBarSync(); return;
      }
      const cur = chart._revealIdxF ?? tgt;
      const nxt = cur + (tgt - cur) * LERP;
      chart._revealIdxF = nxt;
      chart._revealX = bezierPointAt(pts, nxt).x;
      chart.update('none');
      if (projTooltip) {
        const ci = Math.round(nxt);
        const val = detCurve[ci]; const lbl = fullLabels[ci];
        projTooltip.innerHTML = `<div style="font-size:14px;font-weight:800;color:#10b981">${fmt(val)}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">${lbl}</div>`;
        const tw = projTooltip.offsetWidth || 140;
        const rect = projCanvas.getBoundingClientRect();
        const left = chart._revealX + 14 + tw > rect.width ? chart._revealX - tw - 14 : chart._revealX + 14;
        projTooltip.style.left = left + 'px'; projTooltip.style.top = (chart.chartArea.top + 10) + 'px'; projTooltip.style.display = 'block';
      }
      _syncBar(nxt);
      if (Math.abs(nxt - tgt) > 0.02) {
        chart._revealAnimId = requestAnimationFrame(() => _projTick(chart, pts));
      } else {
        chart._revealIdxF = tgt; chart._revealX = pts[Math.min(Math.round(tgt), pts.length-1)].x;
        chart._revealAnimId = null; chart.update('none');
      }
    }
    projCanvas._projTick = _projTick; // exposé pour reverse sync depuis bar chart
    // Supprimer les anciens listeners avant d'en ajouter de nouveaux
    if (projCanvas._projMouseMove)  projCanvas.removeEventListener('mousemove',  projCanvas._projMouseMove);
    if (projCanvas._projMouseLeave) projCanvas.removeEventListener('mouseleave', projCanvas._projMouseLeave);
    projCanvas._projMouseMove = e => {
      const chart = charts.projection; if (!chart) return;
      const rect = projCanvas.getBoundingClientRect(); const mx = (e.clientX - rect.left) * (chart.width / rect.width);
      const { chartArea } = chart;
      if (!chartArea || mx < chartArea.left || mx > chartArea.right) return;
      const detMeta = chart.getDatasetMeta(chart.data.datasets.length - 1);
      const pts = detMeta ? detMeta.data : [];
      if (!pts.length) return;
      let ci = 0, cd = Infinity;
      pts.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < cd) { cd = d; ci = i; } });
      chart._revealTarget = ci;
      if (!chart._revealAnimId)
        chart._revealAnimId = requestAnimationFrame(() => _projTick(chart, pts));
    };
    projCanvas._projMouseLeave = () => {
      if (projTooltip) projTooltip.style.display = 'none';
      _clearBarSync();
    };
    projCanvas.addEventListener('mousemove',  projCanvas._projMouseMove);
    projCanvas.addEventListener('mouseleave', projCanvas._projMouseLeave);
    if(projCanvas._docLeave) document.removeEventListener('mousemove',projCanvas._docLeave);
    projCanvas._docLeave=e=>{
      const r=projCanvas.getBoundingClientRect();
      if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) {
        if(projTooltip) projTooltip.style.display='none';
        _clearBarSync();
      }
    };
    document.addEventListener('mousemove',projCanvas._docLeave);
  })();

  // 10. Monthly delta bar chart
  const deltaLabels = Array.from({ length: months }, (_, i) => {
    const m = i + 1;
    if (m % 12 === 0) return `${m / 12}a`;
    return '';
  });

  // Plugin rupture Phase 2 pour le bar chart
  const phaseBreakBarPlugin = {
    id: 'phaseBreakBar',
    afterDraw(chart) {
      if (!phase2Active || transitionMonth <= 0 || transitionMonth >= months) return;
      const { ctx, chartArea } = chart;
      const meta = chart.getDatasetMeta(0);
      const barIdx = transitionMonth - 1; // dernier bar de la phase 1
      if (barIdx < 0 || barIdx >= meta.data.length) return;
      const bar = meta.data[barIdx];
      const x = bar.x + (bar.width || 0) / 2;
      if (x <= chartArea.left || x >= chartArea.right) return;
      ctx.save();
      // Zone Phase 2
      ctx.fillStyle = 'rgba(245,158,11,0.05)';
      ctx.fillRect(x, chartArea.top, chartArea.right - x, chartArea.bottom - chartArea.top);
      // Ligne tiretée
      ctx.strokeStyle = 'rgba(245,158,11,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
    }
  };

  charts.projMonthly = new Chart(document.getElementById('chartProjMonthly'), {
    type: 'bar',
    data: {
      labels: deltaLabels,
      datasets: [{
        data: monthlyDelta,
        backgroundColor: monthlyDelta.map(v => v >= 0 ? 'rgba(124,58,237,0.65)' : 'rgba(239,68,68,0.5)'),
        borderRadius: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 28 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: { ticks: { color: chartTick(), font: { family: 'Inter', size: 9 }, maxTicksLimit: 20,
              callback: (v, i) => deltaLabels[i] || undefined }, grid: { display: false }, border: { display: false } },
        y: { type: 'logarithmic', ticks: { color: chartTick(), font: { family: 'Inter', size: 10 }, maxTicksLimit: 5, callback: v => fmt(v) }, grid: { display: false }, border: { display: false } }
      }
    },
    plugins: [barSyncPlugin, phaseBreakBarPlugin]
  });

  // Sync chartArea.left : aligne le bar chart sur le line chart
  requestAnimationFrame(() => {
    const pLeft = charts.projection?.chartArea?.left;
    const bLeft = charts.projMonthly?.chartArea?.left;
    if (pLeft != null && bLeft != null && Math.abs(pLeft - bLeft) >= 1) {
      charts.projMonthly.options.layout.padding.left =
        Math.max(0, (charts.projMonthly.options.layout.padding.left || 0) + (pLeft - bLeft));
      charts.projMonthly.update('none');
    }
  });

  // Bar chart hover — reverse sync vers projection chart
  {
    const barCanvas = document.getElementById('chartProjMonthly');
    const barTooltip = document.getElementById('chartProjMonthlyTooltip');
    if (barCanvas._barMouseMove)  barCanvas.removeEventListener('mousemove',  barCanvas._barMouseMove);
    if (barCanvas._barMouseLeave) barCanvas.removeEventListener('mouseleave', barCanvas._barMouseLeave);
    barCanvas._barMouseMove = e => {
      const chart = charts.projMonthly; if (!chart) return;
      const rect = barCanvas.getBoundingClientRect(); const mx = (e.clientX - rect.left) * (chart.width / rect.width);
      const { chartArea } = chart; if (!chartArea || mx < chartArea.left || mx > chartArea.right) return;
      const meta = chart.getDatasetMeta(0);
      let ci = 0, cd = Infinity;
      meta.data.forEach((b, i) => { const d = Math.abs(b.x - mx); if (d < cd) { cd = d; ci = i; } });
      chart._syncIdx = ci;
      if (barTooltip && monthlyDelta[ci] != null) {
        const v = monthlyDelta[ci];
        barTooltip.innerHTML = `<div style="font-size:14px;font-weight:800;color:${v >= 0 ? '#a78bfa' : '#f87171'}">${v >= 0 ? '+' : ''}${fmt(v)}</div><div style="font-size:11px;color:var(--text2);margin-top:3px">${fullLabels[ci + 1]}</div>`;
        const bx = meta.data[ci]?.x;
        if (bx != null) {
          const tw = barTooltip.offsetWidth || 140;
          const left = bx + 14 + tw > barCanvas.offsetWidth ? bx - tw - 14 : bx + 14;
          barTooltip.style.left = left + 'px'; barTooltip.style.top = (chart.chartArea.top + 10) + 'px'; barTooltip.style.display = 'block';
        }
      }
      chart.update('none');
      // Reverse sync → projection chart
      const projChart = charts.projection;
      if (projChart && projCanvas._projTick) {
        projChart._revealTarget = ci + 1;
        if (!projChart._revealAnimId) {
          const pts = projChart.getDatasetMeta(projChart.data.datasets.length - 1).data;
          projChart._revealAnimId = requestAnimationFrame(() => projCanvas._projTick(projChart, pts));
        }
      }
    };
    barCanvas._barMouseLeave = () => { if (barTooltip) barTooltip.style.display = 'none'; };
    barCanvas.addEventListener('mousemove',  barCanvas._barMouseMove);
    barCanvas.addEventListener('mouseleave', barCanvas._barMouseLeave);
    if (barCanvas._docLeave) document.removeEventListener('mousemove', barCanvas._docLeave);
    barCanvas._docLeave = e => {
      const r = barCanvas.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        if (barTooltip) barTooltip.style.display = 'none';
    };
    document.addEventListener('mousemove', barCanvas._docLeave);
  }
}

function clearPortfolio(){if(!confirm('Effacer tout l\'historique?')) return;portfolioPoints=[];savePortfolio();renderPortfolioChart();updatePortfolioPill();}

// ── Portfolio modal ─────────────────────────────────────────────────────────
function openPortfolioModal() {
  renderPortfolioModalTable();
  document.getElementById('portfolioModal').classList.add('open');
}
function closePortfolioModal() {
  document.getElementById('portfolioModal').classList.remove('open');
}
function renderPortfolioModalTable() {
  const body = document.getElementById('portfolioModalBody');
  if (!portfolioPoints.length) {
    body.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--text2)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:40px;height:40px;margin:0 auto 12px;opacity:0.35;display:block"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      <p style="font-size:13px">Aucun point enregistré</p>
    </div>`;
    return;
  }
  const sorted = [...portfolioPoints].reverse(); // newest first for display
  body.innerHTML = `
    <div style="max-height:420px;overflow-y:auto;border-radius:12px;border:1px solid var(--border2)">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--bg3)">
            <th style="padding:10px 14px;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--text2);font-weight:700;text-align:left;border-bottom:1px solid var(--border2)">#</th>
            <th style="padding:10px 14px;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--text2);font-weight:700;text-align:left;border-bottom:1px solid var(--border2)">Date</th>
            <th style="padding:10px 14px;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;color:var(--text2);font-weight:700;text-align:right;border-bottom:1px solid var(--border2)">Valeur ($)</th>
            <th style="padding:10px 14px;border-bottom:1px solid var(--border2)"></th>
          </tr>
        </thead>
        <tbody id="portfolioModalRows">
          ${sorted.map((pt, i) => portfolioModalRow(pt, i, sorted.length)).join('')}
        </tbody>
      </table>
    </div>`;
}
function portfolioModalRow(pt, i, total) {
  const realIdx = portfolioPoints.findIndex(p => p.date === pt.date);
  return `<tr id="pmrow_${realIdx}" style="border-bottom:1px solid rgba(255,255,255,0.04)">
    <td style="padding:10px 14px;font-size:11px;color:var(--text2)">${total - i}</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:600;color:var(--text)">${pt.date}</td>
    <td style="padding:10px 14px;font-size:13px;font-weight:700;color:var(--accent2);text-align:right">${pt.value.toLocaleString('fr-FR', {minimumFractionDigits:2,maximumFractionDigits:2})} $</td>
    <td style="padding:10px 14px;text-align:right;white-space:nowrap">
      <button onclick="startEditPortfolioRow(${realIdx})" style="background:rgba(124,58,237,0.1);border:1px solid rgba(124,58,237,0.25);color:#a78bfa;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;transition:all .2s;margin-right:6px"
        onmouseover="this.style.background='rgba(124,58,237,0.22)'" onmouseout="this.style.background='rgba(124,58,237,0.1)'">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:3px;vertical-align:middle"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Éditer
      </button>
      <button onclick="deletePortfolioRow(${realIdx})" style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);color:#f87171;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;transition:all .2s"
        onmouseover="this.style.background='rgba(239,68,68,0.18)'" onmouseout="this.style.background='rgba(239,68,68,0.08)'">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:3px;vertical-align:middle"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
        Suppr.
      </button>
    </td>
  </tr>`;
}
function startEditPortfolioRow(idx) {
  const pt = portfolioPoints[idx];
  const tr = document.getElementById('pmrow_' + idx);
  if (!tr) return;
  tr.innerHTML = `
    <td style="padding:8px 10px;font-size:11px;color:var(--text2)">${portfolioPoints.length - idx}</td>
    <td style="padding:8px 10px">
      <input id="pmedit_date_${idx}" type="date" value="${pt.date}"
        style="background:rgba(255,255,255,0.05);border:1px solid rgba(124,58,237,0.35);border-radius:8px;padding:6px 10px;font-size:12px;color:var(--text);width:130px"/>
    </td>
    <td style="padding:8px 10px;text-align:right">
      <input id="pmedit_val_${idx}" type="number" step="any" value="${pt.value}"
        style="background:rgba(255,255,255,0.05);border:1px solid rgba(124,58,237,0.35);border-radius:8px;padding:6px 10px;font-size:12px;color:var(--text);width:110px;text-align:right"/>
    </td>
    <td style="padding:8px 10px;text-align:right;white-space:nowrap">
      <button onclick="savePortfolioRow(${idx})" style="background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);color:#34d399;border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer;margin-right:6px"
        onmouseover="this.style.background='rgba(16,185,129,0.22)'" onmouseout="this.style.background='rgba(16,185,129,0.1)'">
        ✓ Sauver
      </button>
      <button onclick="renderPortfolioModalTable()" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:var(--text2);border-radius:7px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer"
        onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
        Annuler
      </button>
    </td>`;
  document.getElementById('pmedit_val_' + idx)?.focus();
}
function savePortfolioRow(idx) {
  const newDate = document.getElementById('pmedit_date_' + idx)?.value;
  const newVal  = parseFloat(document.getElementById('pmedit_val_'  + idx)?.value);
  if (!newDate || isNaN(newVal)) return;
  // Remove old, check for date collision (except same index)
  const oldDate = portfolioPoints[idx].date;
  portfolioPoints.splice(idx, 1);
  portfolioPoints = portfolioPoints.filter(p => p.date !== newDate);
  portfolioPoints.push({ date: newDate, value: newVal });
  portfolioPoints.sort((a, b) => a.date.localeCompare(b.date));
  savePortfolio(); renderPortfolioChart(); updatePortfolioPill();
  renderPortfolioModalTable();
}
function deletePortfolioRow(idx) {
  portfolioPoints.splice(idx, 1);
  savePortfolio(); renderPortfolioChart(); updatePortfolioPill();
  renderPortfolioModalTable();
}
function renderPortfolioChart() {
  if(charts.portfolio){
    if(charts.portfolio._revealAnimId){ cancelAnimationFrame(charts.portfolio._revealAnimId); charts.portfolio._revealAnimId=null; }
    charts.portfolio.destroy();delete charts.portfolio;
  }
  const empty=document.getElementById('portfolioEmpty');
  const canvas=document.getElementById('chartPortfolio');
  const tooltip=document.getElementById('chartPortfolioTooltip');
  if(!portfolioPoints.length){canvas.style.display='none';empty.style.display='block';if(tooltip)tooltip.style.display='none';return;}
  canvas.style.display='block';empty.style.display='none';
  const labels=portfolioPoints.map(p=>p.date), values=portfolioPoints.map(p=>p.value);
  const isUp=values[values.length-1]>=values[0]; const color=isUp?'#10b981':'#ef4444';
  _portfolioRevealColor = color;
  // Axe X : même traitement que l'Equity Curve (dates courtes « 14 aoû », année
  // au changement d'année, nb de ticks bridé) pour éviter le chevauchement.
  const MOIS = ['jan','fév','mar','avr','mai','juin','juil','aoû','sep','oct','nov','déc'];
  const portOpts = { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{enabled:false}},
    scales:{
      x:{display:true, grid:{display:false}, border:{display:false},
        ticks:{
          color:chartTick(), font:{family:'Inter',size:11}, maxTicksLimit:8, autoSkip:true,
          callback:function(val,index,ticks){
            const label=this.getLabelForValue(val);
            if(!label) return '';
            const d=new Date(String(label).split(' ')[0]);
            if(isNaN(d)) return label;
            if(index>0 && ticks[index-1]){
              const prev=new Date((this.getLabelForValue(ticks[index-1].value)||'').split(' ')[0]);
              if(!isNaN(prev) && prev.getFullYear()!==d.getFullYear()) return String(d.getFullYear());
            }
            return `${d.getDate()} ${MOIS[d.getMonth()]}`;
          }
        }
      },
      y:{ticks:{color:chartTick(),font:{family:'Inter',size:11},callback:v=>v.toLocaleString('fr-FR')+'$'}, grid:{display:false}, border:{display:false}}
    }
  };
  charts.portfolio=new Chart(canvas,{type:'line',data:{labels,datasets:[{data:values,borderColor:isLight()?'rgba(30,30,58,0.22)':'rgba(255,255,255,0.22)',backgroundColor:'transparent',fill:false,tension:0.4,cubicInterpolationMode:'monotone',pointRadius:0,pointHoverRadius:0,borderWidth:2}]},options:portOpts,plugins:[portfolioRevealPlugin]});

  const LERP = 0.06;
  function _portRevealTick(chart, pts) {
    const tgt = chart._revealTarget;
    if (tgt === null) {
      chart._revealIdx=null; chart._revealIdxF=null; chart._revealX=null; chart._revealY=null; chart._revealAnimId=null;
      chart.update('none');
      if(tooltip) tooltip.style.display='none';
      return;
    }
    const cur = chart._revealIdxF ?? tgt;
    const nxt = cur + (tgt - cur) * LERP;
    chart._revealIdxF = nxt; chart._revealIdx = Math.round(nxt);
    const{x:_px,y:_py}=bezierPointAt(pts,nxt); chart._revealX=_px; chart._revealY=_py;
    chart.update('none');
    if(tooltip) {
      const ci=chart._revealIdx; const val=values[ci]; const lbl=labels[ci];
      tooltip.innerHTML=`<div style="font-size:15px;font-weight:800;color:var(--text)">${val.toLocaleString('fr-FR')} $</div><div style="font-size:11px;color:var(--text2);margin-top:3px">${lbl}</div>`;
      const rx=chart._revealX; const tw=tooltip.offsetWidth||140;
      const rect=canvas.getBoundingClientRect();
      const left=rx+14+tw>rect.width?rx-tw-14:rx+14;
      tooltip.style.left=left+'px'; tooltip.style.top=(chart.chartArea.top+10)+'px'; tooltip.style.display='block';
    }
    if(Math.abs(nxt-tgt)>0.02){
      chart._revealAnimId=requestAnimationFrame(()=>_portRevealTick(chart,pts));
    } else {
      const snapIdx=Math.round(tgt); chart._revealIdxF=snapIdx; chart._revealIdx=snapIdx;
      const snapPt=pts[Math.min(snapIdx,pts.length-1)];
      chart._revealX=snapPt.x; chart._revealY=snapPt.y; chart._revealAnimId=null;
      chart.update('none');
    }
  }

  // Nettoyage des anciens listeners avant d'en ajouter de nouveaux
  if (canvas._portMousemove)  canvas.removeEventListener('mousemove',  canvas._portMousemove);
  if (canvas._portMouseleave) canvas.removeEventListener('mouseleave', canvas._portMouseleave);
  if (canvas._docLeave)       document.removeEventListener('mousemove', canvas._docLeave);

  canvas._portMousemove = e => {
    const chart=charts.portfolio; if(!chart) return;
    // Mode privé : pas d'infobulle au survol (elle révélerait la valeur masquée)
    if(_pnlHidden){ if(tooltip) tooltip.style.display='none'; return; }
    const rect=canvas.getBoundingClientRect(); const mx=(e.clientX-rect.left)*(chart.width/rect.width);
    const {chartArea}=chart;
    if(!chartArea||mx<chartArea.left||mx>chartArea.right) return;
    const pts=chart.getDatasetMeta(0).data;
    let ci=0,cd=Infinity; pts.forEach((p,i)=>{const d=Math.abs(p.x-mx);if(d<cd){cd=d;ci=i;}});
    chart._revealTarget=ci;
    if(!chart._revealAnimId) chart._revealAnimId=requestAnimationFrame(()=>_portRevealTick(chart,pts));
  };

  canvas._portMouseleave = () => { if(tooltip) tooltip.style.display='none'; };

  canvas._docLeave = e => {
    const r=canvas.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)
      if(tooltip) tooltip.style.display='none';
  };

  canvas.addEventListener('mousemove',  canvas._portMousemove);
  canvas.addEventListener('mouseleave', canvas._portMouseleave);
  document.addEventListener('mousemove', canvas._docLeave);
}

// ═══════════════════════════════════════════════════════
// FEATURE 1 — Calculateur de taille de position
// ═══════════════════════════════════════════════════════
let _calcValues = { entry: null, qty: null, tp: null, sl: null };

// Toggle "Pas de TP" — pour un trailing stop géré manuellement. L'ordre placé
// sur Hyperliquid n'aura alors qu'Entrée + Stop Loss (pas de Take Profit lié).
let _noTp = localStorage.getItem('tjournal_no_tp') === '1';
function toggleNoTp() {
  _noTp = !_noTp;
  localStorage.setItem('tjournal_no_tp', _noTp ? '1' : '0');
  const btn = document.getElementById('btn-no-tp');
  if (btn) btn.classList.toggle('active', _noTp);
  const rrInput = document.getElementById('f_rr');
  if (rrInput) rrInput.disabled = _noTp;
  calcPosition();
  calcPnl();
}
(function() {
  const btn = document.getElementById('btn-no-tp');
  if (_noTp && btn) btn.classList.add('active');
  const rrInput = document.getElementById('f_rr');
  if (rrInput) rrInput.disabled = _noTp;
})();

function calcPosition() {
  const capital    = parseFloat(document.getElementById('calc_capital').value);
  const riskTarget = parseFloat(document.getElementById('calc_risk_target').value) || 1;
  const entry      = parseFloat(document.getElementById('f_buy').value);
  const sl         = parseFloat(document.getElementById('f_sl').value);
  const dir        = (document.getElementById('f_dir')?.value || 'LONG').toUpperCase();

  const setBtnsDisabled = (d) => {
    ['btn_place_order','btn_simulate','btn_pending'].forEach(id => {
      const b = document.getElementById(id); if (b) b.disabled = d;
    });
    ['calc_copy_entry','calc_copy_qty','calc_copy_tp','calc_copy_sl'].forEach(id => {
      const b = document.getElementById(id);
      if (!b) return;
      b.disabled = d;
      if (d && b._resetTimer) {
        clearTimeout(b._resetTimer); b._resetTimer = null;
        b.textContent = b.dataset.label || b.textContent;
        b.style.background = b.style.borderColor = b.style.color = '';
      }
    });
    const panel = document.getElementById('calc_results_panel');
    const ph    = document.getElementById('calc_placeholder');
    if (panel) panel.style.display = d ? 'none' : 'block';
    if (ph)    ph.style.display    = d ? 'block' : 'none';
  };

  if (!capital || !entry || !sl || isNaN(entry) || isNaN(sl) || entry === sl) {
    _calcValues = { entry: null, qty: null, tp: null, sl: null };
    setBtnsDisabled(true);
    const pl = document.getElementById('prev_leverage');
    if (pl) { pl.innerHTML = '– <span style="font-size:10px">(capital requis)</span>'; pl.style.color = 'var(--text2)'; }
    return;
  }

  // Distance SL en % du prix d'entrée
  const rr          = parseFloat(document.getElementById('f_rr').value) || 1.4;
  const riskPct     = Math.abs((entry - sl) / entry) * 100;
  const slDist      = Math.abs(entry - sl);
  // Pas de TP (trailing stop) : sortie gérée manuellement, aucun prix cible fixe
  const tp          = _noTp ? null : (dir === 'SHORT' ? entry - rr * slDist : entry + rr * slDist);

  // Position exacte nécessaire pour atteindre riskTarget%
  const exactPos        = capital * (riskTarget / riskPct);
  const leverage_needed = exactPos / capital;

  // Levier disponible : 1, 2 ou 3
  // Levier = arrondi au-dessus vers l'entier supérieur (pas de cap)
  // Cap = capital × L × 0.95 (jamais engager plus de 95% de la capacité du levier)
  const L = Math.max(1, Math.ceil(leverage_needed));
  const positionDollars = Math.min(exactPos, capital * L * 0.95);

  const qty        = positionDollars / entry;
  const marginPct  = (positionDollars / L / capital * 100).toFixed(1);

  // Frais réels aller-retour — chaque leg sur son propre notionnel
  // Entrée (market / taker) : notionnel = qty × entry
  // Sortie au TP (limite / maker) : notionnel = qty × tp — sans TP, cette
  // sortie est inconnue à l'avance (trailing stop), donc pas comptée ici.
  const TAKER = 0.00045, MAKER = 0.00015;
  const feeEntry  = TAKER * qty * entry;
  const feeTpExit = tp !== null ? MAKER * qty * tp : 0;
  const fees_usdt = feeEntry + feeTpExit;

  // Gain potentiel au TP — non calculable sans prix de sortie fixe
  const gainDollars    = tp !== null ? qty * rr * slDist : null;
  const feePct_of_gain = (gainDollars !== null && gainDollars > 0) ? (fees_usdt / gainDollars * 100) : 0;

  const realRiskPct = positionDollars / capital * riskPct;
  const riskDollars = capital * realRiskPct / 100;
  const gainNet   = gainDollars !== null ? gainDollars - fees_usdt : null;
  const rrNet     = (gainNet !== null && riskDollars > 0) ? gainNet / riskDollars : null;
  const pnlPctEst = (gainNet !== null && positionDollars > 0) ? gainNet * L / positionDollars * 100 : null;
  _calcValues = { entry, qty, tp, sl, leverage: L, realRisk: +realRiskPct.toFixed(3), gainNet, rrNet, pnlPctEst };
  setBtnsDisabled(false);

  // ── Tiles ────────────────────────────────────────────────────────────
  const decPr  = smartDecimals(entry);
  const qtyDec = entry > 20000 ? 5 : entry > 1000 ? 4 : 2;
  const qtyStr = (Math.trunc(qty * Math.pow(10, qtyDec)) / Math.pow(10, qtyDec)).toFixed(qtyDec);
  const setEl  = (id, html, isHTML) => { const e = document.getElementById(id); if (e) { if (isHTML) e.innerHTML = html; else e.textContent = html; } };
  setEl('calc_disp_entry', entry.toFixed(decPr));
  setEl('calc_disp_sl',    sl.toFixed(decPr));
  setEl('calc_disp_tp',    tp !== null ? tp.toFixed(decPr) : '–');
  setEl('calc_disp_qty',   qtyStr);
  setEl('calc_tp_lbl',     tp !== null ? ('TP ' + rr + 'R') : 'TP (aucun)');
  const copyTpBtn = document.getElementById('calc_copy_tp');
  if (copyTpBtn) copyTpBtn.disabled = (tp === null);

  // ── 3 encarts KPI (moitié gauche) ───────────────────────────────────
  const _rskV = '-$' + riskDollars.toFixed(2);
  let kpiHtml =
    '<div class="calc-kpi-card">' +
      '<div class="calc-kpi-lbl">Risque</div>' +
      '<div class="calc-kpi-val" style="color:var(--red)"><span data-pnl-px data-v="'+_rskV+'" data-p="0">'+_rskV+'</span></div>' +
    '</div>';
  if (gainNet !== null) {
    const rrColor = rrNet >= rr * 0.95 ? 'var(--green)' : 'var(--yellow)';
    const _gainV = '+$' + gainNet.toFixed(2);
    kpiHtml +=
      '<div class="calc-kpi-card">' +
        '<div class="calc-kpi-lbl">Gain au TP</div>' +
        '<div class="calc-kpi-val" style="color:var(--green)"><span data-pnl-px data-v="'+_gainV+'" data-p="1">'+_gainV+'</span></div>' +
        '<div class="calc-kpi-sub">net de frais</div>' +
      '</div>' +
      '<div class="calc-kpi-card">' +
        '<div class="calc-kpi-lbl">RR net</div>' +
        '<div class="calc-kpi-val" style="color:' + rrColor + '">' + rrNet.toFixed(2) + 'R</div>' +
      '</div>';
  } else {
    kpiHtml +=
      '<div class="calc-kpi-card" style="grid-column:span 2">' +
        '<div class="calc-kpi-lbl">Sans TP</div>' +
        '<div class="calc-kpi-sub" style="margin-top:4px">Trailing stop — sortie gérée manuellement, gain/RR non estimables à l\'avance</div>' +
      '</div>';
  }
  setEl('calc_kpi_panel', kpiHtml, true);

  // ── Info position (moitié droite) ────────────────────────────────────
  const levTag = L > 1
    ? '<span style="color:var(--yellow);font-weight:700"> ×' + L + '</span>'
    : '<span style="color:var(--green);font-weight:700"> ×1</span>';
  const feesLabel = gainDollars !== null
    ? ' <span style="font-size:11px">(' + feePct_of_gain.toFixed(2) + '% du gain)</span>'
    : ' <span style="font-size:11px">(entrée seule — sortie TP non prévue)</span>';
  setEl('calc_summary',
    '<div class="calc-info-main"><span>$' + positionDollars.toFixed(2) + '</span>' + levTag + '</div>' +
    '<div class="calc-info-row">' + qtyStr + ' u · ' + marginPct + '% capital</div>' +
    '<div class="calc-info-row">SL dist ' + riskPct.toFixed(2) + '%</div>' +
    '<div class="calc-info-row">Frais <span style="color:var(--yellow);font-weight:700">$' + fees_usdt.toFixed(4) + '</span>' +
    feesLabel + '</div>' +
    (L > 1 ? '<div class="calc-info-warn">⚠ Levier ×' + L + ' — risque réel ' + realRiskPct.toFixed(2) + '%</div>' : ''),
    true);

  // ── Levier dans le formulaire (prev_leverage) ────────────────────────
  const pl = document.getElementById('prev_leverage');
  if (pl) {
    if (L === 1) {
      pl.innerHTML = '<span style="font-weight:700">×1</span> <span style="font-size:10px;color:var(--text2)">— sans levier</span>';
      pl.style.color = 'var(--green)';
    } else {
      pl.innerHTML = '<span style="font-weight:700">×' + L + '</span> <span style="font-size:10px;color:var(--text2)">— risque réel <strong style="color:var(--yellow)">' + realRiskPct.toFixed(2) + '%</strong> du capital</span>';
      pl.style.color = 'var(--yellow)';
    }
  }
}

function copyCalcValue(key, btnId) {
  const val = _calcValues[key];
  if (val == null) return;
  const e = _calcValues.entry || 0;
  const text = (key === 'qty'
    ? (() => {
        const dec = e > 20000 ? 5 : e > 1000 ? 4 : 2;
        return (Math.trunc(val * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec);
      })()
    : (() => {
        return val.toFixed(smartDecimals(e));
      })()
  ).replace('.', ',');
  const btn = document.getElementById(btnId);
  if (!btn) return;
  // label stocké en data-label pour éviter de capturer un état intermédiaire (✓)
  const label = btn.dataset.label || btn.textContent.trim();
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓';
    btn.style.background = 'rgba(16,185,129,0.2)';
    btn.style.borderColor = 'rgba(16,185,129,0.4)';
    btn.style.color = 'var(--green)';
    // clearTimeout évite le bug si on clique 2x vite
    clearTimeout(btn._resetTimer);
    btn._resetTimer = setTimeout(() => {
      btn.textContent = label;
      btn.style.background = '';
      btn.style.borderColor = '';
      btn.style.color = '';
    }, 1200);
  });
}
/* ── BINANCE IMPORT ─────────────────────────────────── */
function toggleBinanceImport(titleEl) {
  titleEl.classList.toggle('open');
  titleEl.nextElementSibling.classList.toggle('open');
}

function parseBinancePaste() {
  const raw = document.getElementById('binance_paste').value;
  const fb  = document.getElementById('binance_feedback');
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 6) { fb.innerHTML = ''; return; }

  // Format : 4 lignes par ordre
  // L0 : "2026-04-16 15:50:26"
  // L1 : "SOL/USDC"
  // L2 : "Acheter" / "Vendre"
  // L3 : "85.45\t6.669\t0.00633555 SOL\tTaker\t569.86605 USDC\t≈ 569.87 USDT"
  const dateRe = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  // Découpe en blocs à chaque ligne de date
  const blocks = [];
  let cur = [];
  for (const l of lines) {
    if (dateRe.test(l) && cur.length > 0) { blocks.push(cur); cur = []; }
    cur.push(l);
  }
  if (cur.length > 0) blocks.push(cur);

  if (blocks.length < 2) {
    fb.innerHTML = '<span style="color:var(--red)">Format non reconnu — colle les 2 ordres exécutés depuis Binance</span>';
    return;
  }

  // Extrait un nombre depuis une chaîne ("569.86605 USDC" → 569.86605)
  const parseNum = s => {
    if (!s) return null;
    const m = s.match(/[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  };

  const orders = blocks.map(b => {
    const fields = (b[3] || '').split('\t').map(s => s.trim());
    return {
      datetime : b[0],           // "2026-04-16 15:50:26"
      pair     : b[1] || '',     // "SOL/USDC"
      side     : b[2] || '',     // "Acheter" / "Vendre"
      price    : parseFloat(fields[0]) || null,
      qty      : parseFloat(fields[1]) || null,
      total    : parseNum(fields[4]),  // "569.86605 USDC" → 569.86605
    };
  });

  const buy  = orders.find(o => o.side === 'Acheter');
  const sell = orders.find(o => o.side === 'Vendre');

  if (!buy) {
    fb.innerHTML = '<span style="color:var(--red)">Ordre d\'achat introuvable</span>';
    return;
  }

  // Date & heures (format "2026-04-16 15:50:26")
  const [buyDate, buyTime] = buy.datetime.split(' ');

  const ticker = buy.pair.split('/')[0];

  const set = (id, val) => {
    if (val === null || val === undefined) return;
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  set('f_ticker',     ticker);
  syncTickerChips();   // reflète le ticker importé dans le menu déroulant
  set('f_date',       buyDate);
  set('f_time',       buyTime.slice(0, 5));   // HH:MM
  set('f_buy',        buy.price);
  if (buy.total  !== null) set('f_amount_in',  buy.total);

  if (sell) {
    set('f_sell', sell.price);
    if (sell.total !== null) set('f_amount_out', sell.total);
    // Heure de sortie depuis la date de la vente
    const [, sellTime] = sell.datetime.split(' ');
    if (sellTime) set('f_time_end', sellTime.slice(0, 5));
  }

  // Direction : LONG (Acheter → LONG, à étendre si SHORT un jour)
  const dirEl = document.getElementById('f_dir');
  if (dirEl) dirEl.value = 'LONG';

  // Recalculs
  if (typeof calcDuration  === 'function') calcDuration();
  if (typeof calcRisk      === 'function') calcRisk();
  if (typeof calcPnl       === 'function') calcPnl();
  if (typeof calcPosition  === 'function') calcPosition();

  // Feedback
  let pnlStr = '';
  if (sell && buy.total && sell.total) {
    const pnl = sell.total - buy.total;
    pnlStr = pnl >= 0
      ? ` — <span style="color:var(--green)">+$${pnl.toFixed(2)}</span>`
      : ` — <span style="color:var(--red)">-$${Math.abs(pnl).toFixed(2)}</span>`;
  }
  const sellStr = sell ? ` → sortie <strong>${sell.price}</strong>` : ' <span style="color:var(--yellow)">(pas de sortie détectée)</span>';
  fb.innerHTML = `<span style="color:var(--text2)">Détecté :</span> <strong>${ticker}</strong> LONG — entrée <strong>${buy.price}</strong>${sellStr}${pnlStr}<br><span style="color:var(--yellow);font-size:11px">⚠ SL non disponible dans ce format — à renseigner manuellement</span>`;
}

function parseCustomPaste() {
  const raw = document.getElementById('custom_paste').value;
  const fb  = document.getElementById('custom_feedback');
  if (!raw.trim()) { fb.innerHTML = ''; return; }

  const dateRe  = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}/;
  const parseN  = s => {
    if (!s) return null;
    const m = String(s).replace(/\s/g,'').replace(',','.').match(/-?[\d.]+/);
    return m ? parseFloat(m[0]) : null;
  };

  // Éclater toutes les lignes ET tous les segments séparés par des tabs
  const tokens = [];
  for (const line of raw.split('\n')) {
    for (const part of line.split('\t')) {
      const t = part.trim();
      if (t) tokens.push(t);
    }
  }

  // Regrouper en blocs à chaque token qui correspond à une date
  const blocks = [];
  let cur = null;
  for (const tok of tokens) {
    if (dateRe.test(tok)) { if (cur) blocks.push(cur); cur = [tok]; }
    else if (cur) cur.push(tok);
  }
  if (cur) blocks.push(cur);

  if (blocks.length < 2) {
    fb.innerHTML = '<span style="color:var(--red)">Format non reconnu — colle une paire Open/Close</span>';
    return;
  }

  const parseBlock = b => {
    // b[0]=datetime  b[1]=ticker  b[2]="Open Long"  b[3]=price
    // b[4]=qty+unit  b[5]=amount USDC  b[6]=fee USDC  b[7]=pnl USDC
    const [datePart, timePart=''] = b[0].split(' ');
    const [dd='', mm='', yyyy=''] = datePart.split('/');
    return {
      date  : `${yyyy}-${mm}-${dd}`,
      time  : timePart.slice(0, 5),
      ticker: (b[1] || '').toUpperCase(),
      action: (b[2] || '').toLowerCase(),
      isOpen: (b[2] || '').toLowerCase().includes('open'),
      isLong: (b[2] || '').toLowerCase().includes('long'),
      price : parseN(b[3]),
      qty   : parseN(b[4]),
      amount: parseN(b[5]),
      fee   : parseN(b[6]),
      pnl   : parseN(b[7]),
    };
  };

  const orders    = blocks.map(parseBlock);
  const openOrder = orders.find(o => o.isOpen);
  const closeOrder= orders.find(o => !o.isOpen);

  if (!openOrder) {
    fb.innerHTML = '<span style="color:var(--red)">Ordre d\'ouverture introuvable</span>';
    return;
  }

  const set = (id, val) => {
    if (val == null) return;
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  const dir = openOrder.isLong ? 'LONG' : 'SHORT';
  set('f_ticker',    openOrder.ticker);
  set('f_date',      openOrder.date);
  set('f_time',      openOrder.time);
  set('f_buy',       openOrder.price);
  if (openOrder.amount != null) set('f_amount_in', openOrder.amount);

  const dirEl = document.getElementById('f_dir');
  if (dirEl) dirEl.value = dir;
  const dirDisp = document.getElementById('f_dir_display');
  if (dirDisp) { dirDisp.textContent = dir === 'LONG' ? '▲ LONG' : '▼ SHORT'; dirDisp.style.color = dir === 'LONG' ? 'var(--green)' : 'var(--red)'; }

  // P&L net Hyperliquid = pnl du close (frais close déjà inclus) − frais open
  const closePnl = closeOrder ? (closeOrder.pnl || 0) : 0;
  const openFee  = openOrder.fee || 0;
  const netPnl   = closePnl - openFee;

  if (closeOrder) {
    set('f_sell',     closeOrder.price);
    set('f_time_end', closeOrder.time);
    // Ajuster f_amount_out pour que la formule P&L du formulaire donne exactement le P&L net Hyperliquid
    // SHORT : P&L = amtIn − amtOut  →  amtOut = amtIn − netPnl
    // LONG  : P&L = amtOut − amtIn  →  amtOut = amtIn + netPnl
    if (openOrder.amount != null) {
      const adjAmtOut = dir === 'SHORT'
        ? openOrder.amount - netPnl
        : openOrder.amount + netPnl;
      set('f_amount_out', +adjAmtOut.toFixed(2));
    } else if (closeOrder.amount != null) {
      set('f_amount_out', closeOrder.amount);
    }
  }

  if (typeof calcDuration === 'function') calcDuration();
  if (typeof calcRisk     === 'function') calcRisk();
  if (typeof calcPnl      === 'function') calcPnl();
  if (typeof calcPosition === 'function') calcPosition();
  const pnlStr = netPnl >= 0
    ? `<span style="color:var(--green)">+$${netPnl.toFixed(2)}</span>`
    : `<span style="color:var(--red)">−$${Math.abs(netPnl).toFixed(2)}</span>`;
  const exitStr = closeOrder ? ` → sortie <strong>${closeOrder.price}</strong>` : '';
  fb.innerHTML  =
    `<span style="color:var(--text2)">Détecté :</span> <strong>${openOrder.ticker}</strong> ${dir} — entrée <strong>${openOrder.price}</strong>${exitStr} — P&L net : ${pnlStr}` +
    `<br><span style="color:var(--yellow);font-size:11px">⚠ SL non disponible dans ce format — à renseigner manuellement</span>`;
}

function getCurrentPortfolioCapital() {
  // Retourne le dernier point de portefeuille, ou null
  if (portfolioPoints && portfolioPoints.length)
    return portfolioPoints[portfolioPoints.length - 1].value;
  return null;
}
async function syncCalcCapitalFromPortfolio() {
  const btn = document.querySelector('[onclick="syncCalcCapitalFromPortfolio()"]');
  const el  = document.getElementById('calc_capital');
  if (!el) return;
  if (btn) btn.textContent = '⟳';
  try {
    const resp = await fetch('http://127.0.0.1:8000/balance');
    const data = await resp.json();
    if (data.ok && data.balance != null) {
      el.value = data.balance.toFixed(2);
      localStorage.removeItem('tjournal_calc_capital');
      calcPosition();
      // Met aussi à jour le header portefeuille
      const hdr = document.getElementById('hdrPortfolio');
      if (hdr) { hdr.textContent = '$' + data.balance.toFixed(2); }
      if (btn) btn.textContent = '↺ Portefeuille';
    } else {
      // Fallback : dernier point portfolio local
      const cap = getCurrentPortfolioCapital();
      if (cap != null) { el.value = cap; calcPosition(); }
      if (btn) btn.textContent = '↺ Portefeuille';
    }
  } catch {
    // Bot non joignable : fallback local
    const cap = getCurrentPortfolioCapital();
    if (cap != null) { el.value = cap; calcPosition(); }
    if (btn) btn.textContent = '↺ Hors-ligne';
  }
}
async function fillMarketPrice() {
  const ticker = (document.getElementById('f_ticker')?.value || '').toUpperCase().trim();
  const btn = document.getElementById('btn-market-price');
  const el  = document.getElementById('f_buy');
  if (!el) return;
  if (!ticker) {
    if (btn) { btn.textContent = '! Ticker ?'; setTimeout(() => { btn.textContent = '⚡ Market'; }, 1500); }
    return;
  }
  if (btn) { btn.textContent = '⟳'; btn.style.opacity = '0.6'; btn.disabled = true; }
  try {
    const resp = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
      signal: AbortSignal.timeout(4000)
    });
    const data = await resp.json();
    const price = data[ticker];
    if (price != null) {
      el.value = parseFloat(price).toFixed(2);
      calcRisk(); calcPnl();
      if (btn) { btn.textContent = '✓ ' + parseFloat(price).toFixed(1); btn.style.opacity = '1'; btn.disabled = false; setTimeout(() => { btn.textContent = '⚡ Market'; }, 2000); }
    } else {
      if (btn) { btn.textContent = '⚡ Market'; btn.style.opacity = '1'; btn.disabled = false; }
    }
  } catch {
    if (btn) { btn.textContent = '⚡ Market'; btn.style.opacity = '1'; btn.disabled = false; }
  }
}

async function syncPortfolioValue() {
  const btn = document.getElementById('btn_sync_portfolio');
  const el  = document.getElementById('p_value');
  if (!el) return;
  if (btn) { btn.textContent = '⟳'; btn.style.opacity = '0.6'; }
  try {
    const resp = await fetch('http://127.0.0.1:8000/balance');
    const data = await resp.json();
    if (data.ok && data.balance != null) {
      el.value = data.balance.toFixed(2);
      if (btn) { btn.textContent = '↺ Live'; btn.style.opacity = '1'; }
    } else {
      const cap = getCurrentPortfolioCapital();
      if (cap != null) el.value = cap;
      if (btn) { btn.textContent = '↺ Live'; btn.style.opacity = '1'; }
    }
  } catch {
    const cap = getCurrentPortfolioCapital();
    if (cap != null) el.value = cap;
    if (btn) { btn.textContent = '↺ Hors-ligne'; btn.style.opacity = '1'; }
  }
}

function saveCalcCapital() {
  const v = document.getElementById('calc_capital').value;
  if (v) localStorage.setItem('tjournal_calc_capital', v);
}
function loadCalcCapital() {
  const el = document.getElementById('calc_capital');
  if (!el) return;
  // Priorité : override manuel → capital portefeuille → vide
  const manual = localStorage.getItem('tjournal_calc_capital');
  if (manual) { el.value = manual; }
  else {
    const cap = getCurrentPortfolioCapital();
    if (cap != null) el.value = cap;
  }
  calcPosition();
}

// ═══════════════════════════════════════════════════════
// FEATURE 2 — Max Drawdown + Drawdown actuel
// ═══════════════════════════════════════════════════════
function renderDrawdown() {
  const maxddEl  = document.getElementById('ana_maxdd');
  const curddEl  = document.getElementById('ana_curdd');
  const maxddSub = document.getElementById('ana_maxdd_sub');
  const curddSub = document.getElementById('ana_curdd_sub');
  if (!maxddEl || !curddEl) return;
  if (!trades.length) {
    maxddEl.textContent = '–'; curddEl.textContent = '–';
    maxddEl.className = 'kpi-value neu'; curddEl.className = 'kpi-value neu';
    return;
  }
  const useDollar = trades.some(t => t.pnlDollar !== null);
  const pVal = t => useDollar ? (t.pnlDollar ?? 0) : (t.pnlPct ?? 0);
  const sorted = trades
    .filter(t => !t._isComment && !t.isIdea && !t.isPaper && (t.pnlDollar !== null || t.pnlPct !== null))
    .sort((a,b) => new Date(a.date+'T'+(a.time||'00:00')) - new Date(b.date+'T'+(b.time||'00:00')));
  let cum = 0, maxDD = 0, maxPeak = 0, maxValley = 0;
  const curve = sorted.map(t => { cum += pVal(t); return cum; });
  // Max drawdown — runPeak part de 0 pour capturer les pertes dès le premier trade
  let runPeak = 0;
  for (let i = 0; i < curve.length; i++) {
    if (curve[i] > runPeak) runPeak = curve[i];
    const ddAbs = runPeak - curve[i];
    // En % du pic si pic > 0 ; en valeur absolue si on n'a jamais été positif
    const dd = runPeak > 0 ? (ddAbs / runPeak * 100) : ddAbs;
    if (dd > maxDD) { maxDD = dd; maxPeak = runPeak; maxValley = curve[i]; }
  }
  // Current drawdown (depuis le dernier pic)
  const last = curve[curve.length - 1];
  let latestPeak = Math.max(...curve);
  let curDD = latestPeak > 0 ? (latestPeak - last) / latestPeak * 100 : 0;
  if (curDD < 0) curDD = 0;
  const pUnit = useDollar ? '$' : '%';
  maxddEl.innerHTML   = _pxSpan(maxDD > 0 ? '-' + maxDD.toFixed(2) + '%' : '0%', !(maxDD > 0));
  maxddEl.className   = 'kpi-value ' + (maxDD > 0 ? 'neg' : 'pos');
  if (maxDD > 0) maxddSub.innerHTML = _pxSpan(`Pic: ${maxPeak.toFixed(2)}${pUnit} → Creux: ${maxValley.toFixed(2)}${pUnit}`, false);
  else maxddSub.textContent = 'aucun drawdown';
  curddEl.innerHTML   = _pxSpan(curDD > 0 ? '-' + curDD.toFixed(2) + '%' : '0%', !(curDD > 0));
  curddEl.className   = 'kpi-value ' + (curDD > 0 ? 'neg' : 'pos');
  curddSub.innerHTML  = _pxSpan(`Depuis le pic: ${latestPeak.toFixed(2)}${pUnit}`, true);
}

// ═══════════════════════════════════════════════════════
// FEATURE 5 — Indicateur de série en cours
// ═══════════════════════════════════════════════════════
function renderStreak() {
  const badge = document.getElementById('streakBadge');
  if (!badge) return;
  // Seuls les trades réellement pris (non-idées) comptent dans la série
  const taken = trades.filter(t => !t._isComment && !t.isIdea && (t.pnlDollar !== null || t.pnlPct !== null));
  if (!taken.length) { badge.textContent = '—'; badge.className = 'streak-badge none'; return; }
  const sorted = [...taken].sort((a,b) => new Date(b.date+'T'+(b.time||'00:00')) - new Date(a.date+'T'+(a.time||'00:00')));
  const first = sorted[0];
  const isWin = v => v >= 0;
  const pVal  = t => t.pnlDollar ?? t.pnlPct ?? 0;
  const startWin = isWin(pVal(first));
  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (isWin(pVal(sorted[i])) === startWin) streak++;
    else break;
  }
  if (startWin) {
    badge.textContent = '🔥 ' + streak + 'W';
    badge.className = 'streak-badge win';
  } else {
    badge.textContent = '❄️ ' + streak + 'L';
    badge.className = 'streak-badge loss';
  }
}

// ═══════════════════════════════════════════════════════
// FEATURE 3 — Tableau hebdo / mensuel
// ═══════════════════════════════════════════════════════
let _periodMode = 'week';
function switchPeriodTable(mode) {
  _periodMode = mode;
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('periodBtn' + (mode==='week'?'Week':'Month')).classList.add('active');
  renderPeriodTable();
}
function getWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay() === 0 ? 7 : d.getDay();
  const monday = new Date(d); monday.setDate(d.getDate() - day + 1);
  return monday.toISOString().slice(0,10);
}
function getMonthKey(dateStr) { return dateStr.slice(0,7); }
function renderPeriodTable() {
  const tbody = document.getElementById('periodTableBody');
  const lbl   = document.getElementById('periodColLabel');
  if (!tbody) return;
  if (!trades.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text2);font-size:12px">Aucune donnée</td></tr>';
    return;
  }
  lbl.textContent = _periodMode === 'week' ? 'Semaine (lundi)' : 'Mois';
  const useDollar = trades.some(t => t.pnlDollar !== null);
  const pVal = t => useDollar ? (t.pnlDollar ?? 0) : (t.pnlPct ?? 0);
  const pUnit = useDollar ? '$' : '%';
  const groups = {};
  trades.filter(t => !t._isComment && !t.isIdea && !t.isPaper && (t.pnlDollar !== null || t.pnlPct !== null)).forEach(t => {
    const key = _periodMode === 'week' ? getWeekKey(t.date) : getMonthKey(t.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  // Best/worst day per period
  const rows = Object.entries(groups).sort((a,b) => b[0].localeCompare(a[0])).map(([key, grp]) => {
    const activeGrp = grp;
    const wins = activeGrp.filter(t => (t.pnlDollar ?? t.pnlPct ?? 0) >= 0).length;
    const wr   = activeGrp.length ? (wins / activeGrp.length * 100).toFixed(1) : '–';
    const total = activeGrp.reduce((s,t) => s + pVal(t), 0);
    // Best/worst day (only taken trades)
    const byDay = {};
    activeGrp.forEach(t => { byDay[t.date] = (byDay[t.date] || 0) + pVal(t); });
    const days = Object.entries(byDay);
    const best  = days.length ? [...days].sort((a,b) => b[1]-a[1])[0] : null;
    const worst = days.length ? [...days].sort((a,b) => a[1]-b[1])[0] : null;
    const label = _periodMode === 'week' ? 'Sem. du ' + key : key;
    const pnlCls = total >= 0 ? 'pos' : 'neg';
    const fmtBest  = best  && best[1]  > 0 ? _pxSpan('+'+best[1].toFixed(2)+pUnit, true)+' ('+best[0]+')' : '–';
    const fmtWorst = worst && worst[1] < 0 ? _pxSpan(worst[1].toFixed(2)+pUnit, false)+' ('+worst[0]+')'  : '–';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
      <td style="padding:9px 12px;font-size:12px;font-weight:600;color:var(--text)">${label}</td>
      <td style="padding:9px 12px;font-size:12px;text-align:right;color:var(--text2)">${activeGrp.length}</td>
      <td style="padding:9px 12px;font-size:12px;text-align:right;color:${wr>=50?'var(--green)':'var(--red)'}">${activeGrp.length?_pxSpan(wr+'%', wr>=50):'–'}</td>
      <td style="padding:9px 12px;font-size:12px;text-align:right;font-weight:700" class="${activeGrp.length?pnlCls:'neu'}">${activeGrp.length?_pxSpan((total>=0?'+':'')+total.toFixed(2)+pUnit, total>=0):'–'}</td>
      <td style="padding:9px 12px;font-size:12px;text-align:right;color:var(--green)">${fmtBest}</td>
      <td style="padding:9px 12px;font-size:12px;text-align:right;color:var(--red)">${fmtWorst}</td>
    </tr>`;
  });
  tbody.innerHTML = rows.join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text2);font-size:12px">Aucune donnée</td></tr>';
}

// ═══════════════════════════════════════════════════════
// FEATURE 6 — Heatmap calendrier (version améliorée)
// ═══════════════════════════════════════════════════════
// Override renderCalendar to add heatmap intensity
const _origRenderCalendar = renderCalendar;
window.renderCalendar = renderCalendar = function() {
  const MONTHS=['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const monthKey = calYear + '-' + String(calMonth+1).padStart(2,'0');
  const monthTrades = activeTrades().filter(t => t.date && t.date.startsWith(monthKey));
  const calTitleEl = document.getElementById('calTitle');
  if (monthTrades.length) {
    const wins = monthTrades.filter(t => (t.pnlDollar ?? t.pnlPct ?? 0) >= 0).length;
    const wr   = (wins / monthTrades.length * 100).toFixed(0);
    const wrColor = wr >= 50 ? 'var(--green)' : 'var(--red)';
    calTitleEl.innerHTML = `${MONTHS[calMonth]} ${calYear} <span style="font-size:12px;font-weight:600;color:${wrColor};margin-left:8px;opacity:0.9"><span data-pnl-px data-v="${wr}%" data-p="${wr>=50?1:0}">${wr}%</span> WR</span>`;
  } else {
    calTitleEl.textContent = MONTHS[calMonth] + ' ' + calYear;
  }
  const grid=document.getElementById('calGrid'); grid.innerHTML='';
  let offset=new Date(calYear,calMonth,1).getDay()-1; if(offset<0) offset=6;
  const dIM=new Date(calYear,calMonth+1,0).getDate();
  const today=new Date();
  const byDate={};
  trades.forEach(t=>{ if(t._isComment) return; if(!byDate[t.date]) byDate[t.date]=[]; byDate[t.date].push(t); });

  // Compute min/max pnl for the month (taken trades only)
  let maxPos = 0, maxNeg = 0;
  for(let d=1;d<=dIM;d++){
    const ds=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const taken=(byDate[ds]||[]).filter(t=>!t.isIdea&&(t.pnlDollar!=null||t.pnlPct!=null));
    if(!taken.length) continue;
    const useDollar=taken.some(t=>t.pnlDollar!=null);
    const pnl=taken.reduce((s,t)=>s+(useDollar?(t.pnlDollar??0):(t.pnlPct??0)),0);
    if(pnl>0 && pnl>maxPos) maxPos=pnl;
    if(pnl<0 && Math.abs(pnl)>maxNeg) maxNeg=Math.abs(pnl);
  }

  for(let i=0;i<offset;i++) grid.insertAdjacentHTML('beforeend','<div class="cal-day empty"></div>');
  for(let d=1;d<=dIM;d++){
    const ds=calYear+'-'+String(calMonth+1).padStart(2,'0')+'-'+String(d).padStart(2,'0');
    const dt=byDate[ds]||[];
    const taken=dt.filter(t=>!t.isIdea&&(t.pnlDollar!=null||t.pnlPct!=null));
    const ideas=dt.filter(t=>!!t.isIdea);
    const isT=today.getFullYear()===calYear&&today.getMonth()===calMonth&&today.getDate()===d;
    let bgStyle='';
    let cls='cal-day'+(isT?' today':'');
    if(dt.length){
      const takenCnt=taken.length?`${taken.length}T`:'';
      const ideaCnt=ideas.length?`${ideas.length}💡`:'';
      const cntStr=`<div class="cal-count">${[takenCnt,ideaCnt].filter(Boolean).join(' ')}</div>`;
      if(taken.length){
        const useDollar=taken.some(t=>t.pnlDollar!=null);
        const pnl=taken.reduce((s,t)=>s+(useDollar?(t.pnlDollar??0):(t.pnlPct??0)),0);
        const _hmpV=`${pnl>=0?'+':''}${pnl.toFixed(0)}${useDollar?'$':'%'}`;
        const _hmpI=useDollar?`<span data-pnl-px data-v="${_hmpV}" data-p="${pnl>=0?1:0}">${_hmpV}</span>`:_hmpV;
        const pnlStr=`<div class="cal-pnl ${pnl>=0?'pos':'neg'}">${_hmpI}</div>`;
        if(pnl>=0){
          const intensity = maxPos>0 ? 0.08 + (pnl/maxPos)*0.47 : 0.15;
          bgStyle=`background:rgba(16,185,129,${intensity.toFixed(2)});border-color:rgba(16,185,129,${(intensity+0.1).toFixed(2)})`;
        } else {
          const intensity = maxNeg>0 ? 0.08 + (Math.abs(pnl)/maxNeg)*0.47 : 0.15;
          bgStyle=`background:rgba(239,68,68,${intensity.toFixed(2)});border-color:rgba(239,68,68,${(intensity+0.1).toFixed(2)})`;
        }
        grid.insertAdjacentHTML('beforeend',`<div class="${cls}" style="${bgStyle};cursor:pointer" onclick="showDayTrades('${ds}')"><span class="cal-day-num">${d}</span>${pnlStr}${cntStr}</div>`);
      } else {
        // Ideas only — neutral grey
        grid.insertAdjacentHTML('beforeend',`<div class="${cls} neutral-day" style="cursor:pointer" onclick="showDayTrades('${ds}')"><span class="cal-day-num">${d}</span>${cntStr}</div>`);
      }
    } else {
      grid.insertAdjacentHTML('beforeend',`<div class="${cls}" style="cursor:default"><span class="cal-day-num">${d}</span></div>`);
    }
  }
};

// ─── VUE MENSUELLE (année) ────────────────────────────
function renderCalendarMonths() {
  const MONTHS_SHORT = ['Jan','Fév','Mar','Avr','Mai','Juin','Juil','Août','Sep','Oct','Nov','Déc'];
  document.getElementById('calTitle').textContent = calYear;
  document.getElementById('calDayLabels').style.display = 'none';
  document.getElementById('calGrid').style.display = 'none';
  const monthGrid = document.getElementById('calMonthGrid');
  monthGrid.style.display = 'grid';
  monthGrid.className = 'cal-month-grid';
  monthGrid.innerHTML = '';
  document.getElementById('calViewToggle').textContent = 'Jours';

  // Heatmap min/max
  let maxPos = 0, maxNeg = 0;
  for (let m = 0; m < 12; m++) {
    const key = calYear + '-' + String(m+1).padStart(2,'0');
    const taken = trades.filter(t => !t._isComment && !t.isIdea && t.date && t.date.startsWith(key) && (t.pnlDollar != null || t.pnlPct != null));
    if (!taken.length) continue;
    const useDollar = taken.some(t => t.pnlDollar != null);
    const pnl = taken.reduce((s,t) => s + (useDollar ? (t.pnlDollar ?? 0) : (t.pnlPct ?? 0)), 0);
    if (pnl > 0 && pnl > maxPos) maxPos = pnl;
    if (pnl < 0 && Math.abs(pnl) > maxNeg) maxNeg = Math.abs(pnl);
  }

  const today = new Date();
  for (let m = 0; m < 12; m++) {
    const key = calYear + '-' + String(m+1).padStart(2,'0');
    const allMonth = trades.filter(t => !t._isComment && t.date && t.date.startsWith(key));
    const taken = allMonth.filter(t => !t.isIdea && (t.pnlDollar != null || t.pnlPct != null));
    const isCurrent = today.getFullYear() === calYear && today.getMonth() === m;
    const todayOutline = isCurrent ? 'outline:2px solid rgba(124,58,237,0.5);outline-offset:-2px;' : '';

    let bgStyle = '', pnlHtml = '', cntHtml = '', cls = 'cal-mcell';
    if (taken.length) {
      const useDollar = taken.some(t => t.pnlDollar != null);
      const pnl = taken.reduce((s,t) => s + (useDollar ? (t.pnlDollar ?? 0) : (t.pnlPct ?? 0)), 0);
      const sign = pnl >= 0 ? '+' : '';
      const _mcPnlV=`${sign}${pnl.toFixed(0)}${useDollar?'$':'%'}`;
      const _mcPnlI=useDollar?`<span data-pnl-px data-v="${_mcPnlV}" data-p="${pnl>=0?1:0}">${_mcPnlV}</span>`:_mcPnlV;
      pnlHtml = `<div class="cal-mpnl ${pnl>=0?'pos':'neg'}">${_mcPnlI}</div>`;
      cntHtml = `<div class="cal-mcnt">${taken.length}T</div>`;
      if (pnl >= 0) {
        const i = maxPos > 0 ? 0.08 + (pnl/maxPos)*0.47 : 0.15;
        bgStyle = `background:rgba(16,185,129,${i.toFixed(2)});border-color:rgba(16,185,129,${(i+0.1).toFixed(2)})`;
      } else {
        const i = maxNeg > 0 ? 0.08 + (Math.abs(pnl)/maxNeg)*0.47 : 0.15;
        bgStyle = `background:rgba(239,68,68,${i.toFixed(2)});border-color:rgba(239,68,68,${(i+0.1).toFixed(2)})`;
      }
    } else {
      cls += ' no-trades';
    }
    const clickable = taken.length > 0 || allMonth.length > 0;
    const onclick = clickable ? `onclick="calGoToMonth(${m})"` : '';
    monthGrid.insertAdjacentHTML('beforeend',
      `<div class="${cls}" style="${bgStyle};${todayOutline}" ${onclick}>
        <div class="cal-mname">${MONTHS_SHORT[m]}</div>
        ${pnlHtml}${cntHtml}
      </div>`);
  }
}

function toggleCalView() {
  if (calViewMode === 'days') {
    calViewMode = 'months';
    renderCalendarMonths();
  } else {
    calViewMode = 'days';
    document.getElementById('calMonthGrid').style.display = 'none';
    document.getElementById('calDayLabels').style.display = '';
    document.getElementById('calGrid').style.display = '';
    document.getElementById('calViewToggle').textContent = 'Mois';
    (window.renderCalendar || renderCalendar)();
  }
}

function calGoToMonth(m) {
  calMonth = m;
  calViewMode = 'days';
  document.getElementById('calMonthGrid').style.display = 'none';
  document.getElementById('calDayLabels').style.display = '';
  document.getElementById('calGrid').style.display = '';
  document.getElementById('calViewToggle').textContent = 'Mois';
  (window.renderCalendar || renderCalendar)();
}

// ─── RACCOURCIS CLAVIER ────────────────────────────────
document.addEventListener('keydown', function(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input','textarea','select'].includes(tag)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch(e.key) {
    case 'n': case 'N':
      switchTab('journal');
      setTimeout(() => { const el = document.getElementById('f_ticker'); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); el.focus(); } }, 250);
      break;
    case 'a': case 'A': switchTab('dashboard'); break;
    case 'z': case 'Z': switchTab('journal');   break;
    case 'e': case 'E': switchTab('analytics'); break;
    case 'r': case 'R':
      if (window.parent !== window) window.parent.postMessage({ type: 'toggle_app' }, '*');
      break;
    case 'p': case 'P':
      if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'polymarket' }, '*');
      break;
    case 'b': case 'B':
      if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'budget' }, '*');
      break;
    case 't': case 'T':
      if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'trading' }, '*');
      break;
    case 'l': case 'L':
      if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'tdl' }, '*');
      break;
    case 'Escape':
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      document.querySelectorAll('.img-zoom-overlay.open').forEach(m => m.classList.remove('open'));
      break;
  }
});

// ═══════════════════════════════════════════════════════
// FEATURE 8 — Validation à l'entrée du trade
// ═══════════════════════════════════════════════════════
function showFormError(msg) {
  const el = document.getElementById('formError');
  el.textContent = msg; el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}
function hideFormError() { const el = document.getElementById('formError'); if(el) el.style.display = 'none'; }

// ═══════════════════════════════════════════════════════
// FEATURE 9 — Import Binance
// ═══════════════════════════════════════════════════════
let _binanceParsed = [];
function handleBinanceDrop(e) {
  e.preventDefault(); document.getElementById('binanceDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0]; if(!file) return;
  parseBinanceFile(file);
}
function handleBinanceFile(input) {
  const file = input.files[0]; if(!file) return;
  parseBinanceFile(file);
  input.value = '';
}
async function parseBinanceFile(file) {
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  if (!isCsv) {
    try { await loadXLSX(); } catch(err) { alert('Erreur de chargement du lecteur Excel : ' + err.message); return; }
  }
  const reader = new FileReader();
  reader.onload = e => {
    let rows = [];
    try {
      if (isCsv) {
        const text = e.target.result;
        const lines = text.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g,''));
        rows = lines.slice(1).map(l => {
          const cols = l.split(',').map(c => c.trim().replace(/"/g,''));
          const obj = {};
          headers.forEach((h,i) => obj[h] = cols[i] || '');
          return obj;
        });
      } else {
        const wb = XLSX.read(e.target.result, {type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, {defval:''});
      }
      const parsed = matchBinanceFIFO(rows);
      _binanceParsed = parsed;
      showBinancePreview(parsed);
    } catch(err) {
      alert('Erreur lors de la lecture du fichier : ' + err.message);
    }
  };
  if (isCsv) reader.readAsText(file);
  else reader.readAsArrayBuffer(file);
}
function normalizeHeader(h) { return (h||'').toString().toLowerCase().replace(/[\s()\-_]/g,''); }
function findCol(row, ...names) {
  const keys = Object.keys(row);
  for (const name of names) {
    const norm = name.toLowerCase().replace(/[\s()\-_]/g,'');
    const found = keys.find(k => normalizeHeader(k) === norm || normalizeHeader(k).includes(norm));
    if (found) return row[found];
  }
  return '';
}
function matchBinanceFIFO(rows) {
  // Group by pair, separate BUY and SELL
  const byPair = {};
  rows.forEach(row => {
    const pair = (findCol(row,'Pair','Symbol','Market') || '').toString().trim().toUpperCase();
    const type = (findCol(row,'Type','Side','OrderType') || '').toString().trim().toUpperCase();
    const dateRaw = findCol(row,'Date(UTC)','Date','Time','Date(UTC+0)') || '';
    const price  = parseFloat(findCol(row,'Price','Filled Price','AvgPrice')) || 0;
    const amount = parseFloat(findCol(row,'Amount','Quantity','Qty','Filled')) || 0;
    const total  = parseFloat(findCol(row,'Total','Cost','QuoteQty')) || 0;
    const fee    = parseFloat(findCol(row,'Fee','Commission','TradeFee')) || 0;
    const feeCoin= (findCol(row,'Fee Coin','FeeCurrency','CommissionAsset') || '').toString().trim().toUpperCase();
    if (!pair || !type || !price) return;
    if (!byPair[pair]) byPair[pair] = {buys:[], sells:[]};
    const entry = { date: dateRaw, price, amount, total, fee, feeCoin };
    if (type.includes('BUY')) byPair[pair].buys.push(entry);
    else if (type.includes('SELL')) byPair[pair].sells.push(entry);
  });
  const result = [];
  Object.entries(byPair).forEach(([pair, {buys, sells}]) => {
    // Sort chronologically
    const sortRows = arr => arr.sort((a,b) => new Date(a.date) - new Date(b.date));
    sortRows(buys); sortRows(sells);
    // FIFO match
    const usedBuys = new Set();
    sells.forEach(sell => {
      const buy = buys.find((_,i) => !usedBuys.has(i));
      if (!buy) return;
      usedBuys.add(buys.indexOf(buy));
      const baseAsset = pair.replace(/USDT$|USDC$|BTC$|ETH$|BNB$/,'');
      // Fee in quote or base
      let buyFeeUSDC = 0, sellFeeUSDC = 0;
      const quoteCoin = pair.endsWith('USDT') ? 'USDT' : pair.endsWith('USDC') ? 'USDC' : '';
      if (buy.feeCoin === quoteCoin || !buy.feeCoin)  buyFeeUSDC = buy.fee;
      else buyFeeUSDC = buy.fee * buy.price; // fee in base, convert
      if (sell.feeCoin === quoteCoin || !sell.feeCoin) sellFeeUSDC = sell.fee;
      else sellFeeUSDC = sell.fee * sell.price;
      const pnl = (sell.total - sellFeeUSDC) - (buy.total + buyFeeUSDC);
      // Parse date/time
      const sellDate = sell.date.toString().slice(0,10);
      const sellTime = sell.date.toString().length > 10 ? sell.date.toString().slice(11,16) : '';
      result.push({
        ticker: baseAsset,
        date: sellDate,
        time: sellTime,
        dir: 'LONG',
        buy: buy.price,
        sell: sell.price,
        amtIn: +buy.total.toFixed(2),
        amtOut: +sell.total.toFixed(2),
        pnlDollar: +pnl.toFixed(2),
        pnlPct: buy.total > 0 ? +(pnl / buy.total * 100).toFixed(3) : null,
        _buyDate: buy.date,
      });
    });
  });
  return result.sort((a,b) => new Date(a.date+'T'+(a.time||'00:00')) - new Date(b.date+'T'+(b.time||'00:00')));
}
function showBinancePreview(parsed) {
  const area  = document.getElementById('binancePreviewArea');
  const label = document.getElementById('binancePreviewLabel');
  const head  = document.getElementById('binancePreviewHead');
  const body  = document.getElementById('binancePreviewBody');
  const btn   = document.getElementById('binanceImportBtn');
  const warn  = document.getElementById('binanceDupWarn');
  if (!parsed.length) { alert('Aucun trade trouvé dans le fichier (vérifiez les colonnes).'); return; }
  // Check duplicates
  let dupCount = 0;
  parsed.forEach(p => {
    if (trades.some(t => t.date === p.date && t.ticker === p.ticker && t.buy === p.buy)) dupCount++;
  });
  label.textContent = `${parsed.length} trade(s) parsé(s)${dupCount ? ' — ' + dupCount + ' doublon(s) détecté(s)' : ''}`;
  btn.textContent = `Importer ${parsed.length - dupCount} trade(s)`;
  warn.style.display = dupCount ? 'inline' : 'none';
  warn.textContent = dupCount ? `${dupCount} doublon(s) seront ignorés` : '';
  head.innerHTML = '<th style="padding:6px 10px;text-align:left;font-size:10px;color:var(--text2);border-bottom:1px solid var(--border2);white-space:nowrap">Date</th><th style="padding:6px 10px;text-align:left;font-size:10px;color:var(--text2);border-bottom:1px solid var(--border2)">Ticker</th><th style="padding:6px 10px;text-align:left;font-size:10px;color:var(--text2);border-bottom:1px solid var(--border2)">Entry</th><th style="padding:6px 10px;text-align:left;font-size:10px;color:var(--text2);border-bottom:1px solid var(--border2)">Exit</th><th style="padding:6px 10px;text-align:right;font-size:10px;color:var(--text2);border-bottom:1px solid var(--border2)">P&L $</th>';
  body.innerHTML = parsed.map(p => {
    const isDup = trades.some(t => t.date === p.date && t.ticker === p.ticker && t.buy === p.buy);
    const cls = p.pnlDollar >= 0 ? 'pos' : 'neg';
    return `<tr style="${isDup?'opacity:0.4':''};border-bottom:1px solid rgba(255,255,255,0.03)">
      <td style="padding:6px 10px;font-size:11px;color:var(--text2)">${p.date} ${p.time}</td>
      <td style="padding:6px 10px;font-size:11px;font-weight:700;color:var(--text)">${p.ticker}${isDup?' <span style="color:var(--yellow);font-size:9px">(dup)</span>':''}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text)">${p.buy.toFixed(4)}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text)">${p.sell.toFixed(4)}</td>
      <td style="padding:6px 10px;font-size:11px;text-align:right;font-weight:700" class="${cls}">${p.pnlDollar>=0?'+':''}${p.pnlDollar.toFixed(2)}$</td>
    </tr>`;
  }).join('');
  area.style.display = 'block';
}
function importBinanceTrades() {
  let added = 0;
  _binanceParsed.forEach(p => {
    if (trades.some(t => t.date === p.date && t.ticker === p.ticker && t.buy === p.buy)) return;
    const trade = {
      id: Date.now() + Math.random(),
      ticker: p.ticker,
      date: p.date,
      time: p.time,
      timeEnd: '',
      dur: null,
      dir: 'LONG',
      buy: p.buy,
      sl: null,
      sell: p.sell,
      amtIn: p.amtIn,
      amtOut: p.amtOut,
      pnlDollar: p.pnlDollar,
      pnlPct: p.pnlPct,
      risk: 0,
      rrTarget: null,
      rrReal: null,
      lowBr: 'N',
      highBr: 'N',
      img5: '',
      img15: '',
      note: 'Import Binance',
    };
    trades.unshift(trade);
    added++;
  });
  save(); renderTable(); resetBinanceImport();
  alert(`${added} trade(s) importé(s) avec succès.`);
}
function resetBinanceImport() {
  _binanceParsed = [];
  document.getElementById('binancePreviewArea').style.display = 'none';
  document.getElementById('binanceFileInput').value = '';
}

// ═══════════════════════════════════════════════════════
// FEATURE 10 — Analyse par session
// ═══════════════════════════════════════════════════════
function getSession(timeStr) {
  if (!timeStr) return 'after';
  const [h] = timeStr.split(':').map(Number);
  if (h >= 0  && h < 8)  return 'asian';
  if (h >= 8  && h < 13) return 'london';
  if (h >= 13 && h < 22) return 'ny';
  return 'after';
}
function renderSessionAnalysis() {
  const sessions = {
    asian:  { label:'Asian',     trades:[], color:'rgba(99,102,241,0.8)' },
    london: { label:'London',    trades:[], color:'rgba(6,182,212,0.8)' },
    ny:     { label:'New York',  trades:[], color:'rgba(245,158,11,0.8)' },
    after:  { label:'After Hrs', trades:[], color:'rgba(100,116,139,0.8)' },
  };
  const useDollar = trades.some(t => t.pnlDollar !== null);
  const pVal = t => useDollar ? (t.pnlDollar ?? 0) : (t.pnlPct ?? 0);
  const pUnit = useDollar ? '$' : '%';
  trades.forEach(t => {
    if (t._isComment || t.isIdea || t.isPaper || (t.pnlDollar === null && t.pnlPct === null)) return;
    const s = getSession(t.time);
    sessions[s].trades.push(t);
  });
  ['asian','london','ny','after'].forEach(key => {
    const s = sessions[key];
    const pnlEl  = document.getElementById('sess_' + key + '_pnl');
    const subEl  = document.getElementById('sess_' + key + '_sub');
    if (!pnlEl) return;
    if (!s.trades.length) {
      pnlEl.textContent = '–'; pnlEl.className = 'kpi-value neu';
      if(subEl) subEl.textContent = '0 trades';
      return;
    }
    const total = s.trades.reduce((sum,t) => sum + pVal(t), 0);
    const wins  = s.trades.filter(t => (t.pnlDollar ?? t.pnlPct ?? 0) >= 0).length;
    const wr    = (wins / s.trades.length * 100).toFixed(1);
    const _sessV = (total>=0?'+':'') + total.toFixed(2) + pUnit;
    pnlEl.innerHTML = `<span data-pnl-px data-v="${_sessV}" data-p="${total>=0?1:0}">${_sessV}</span>`;
    pnlEl.className   = 'kpi-value ' + (total>=0?'pos':'neg');
    if(subEl) subEl.innerHTML = `${s.trades.length} trades · WR <span data-pnl-px data-v="${wr}%" data-p="${wr>=50?1:0}">${wr}%</span>`;
  });
  // Charts
  const keys = ['asian','london','ny','after'];
  const labels = keys.map(k => sessions[k].label);
  const counts = keys.map(k => sessions[k].trades.length);
  const pnls   = keys.map(k => sessions[k].trades.reduce((s,t)=>s+pVal(t),0));
  const colors = keys.map(k => sessions[k].color);
  // Donut
  if (charts.session) { charts.session.destroy(); delete charts.session; }
  const cv1 = document.getElementById('chartSession');
  if (cv1 && counts.some(c=>c>0)) {
    charts.session = new Chart(cv1, {
      type:'doughnut',
      data:{labels, datasets:[{data:counts, backgroundColor:colors, borderColor:chartGrid(), borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:chartLegend(),font:{family:'Inter',size:12}}},tooltip:{enabled:!_pnlHidden}}}
    });
  }
  // Bar P&L
  if (charts.sessionPnl) { charts.sessionPnl.destroy(); delete charts.sessionPnl; }
  const cv2 = document.getElementById('chartSessionPnl');
  if (cv2) {
    charts.sessionPnl = new Chart(cv2, {
      type:'bar',
      data:{labels, datasets:[{data:pnls, backgroundColor:pnls.map(v=>v>=0?'rgba(16,185,129,0.75)':'rgba(239,68,68,0.75)'), borderRadius:6}]},
      options:chartOpts(pUnit)
    });
  }
}

// ═══════════════════════════════════════════════════════
// HOOK: Override renderDashKPIs to also call new features
// ═══════════════════════════════════════════════════════
const _origRenderDashKPIs = renderDashKPIs;
window.renderDashKPIs = renderDashKPIs = function() {
  _origRenderDashKPIs();
  renderStreak();
};

// ═══════════════════════════════════════════════════════
// HOOK: Override renderAnalytics to also render new tabs
// ═══════════════════════════════════════════════════════
const _origRenderAnalytics = renderAnalytics;
window.renderAnalytics = renderAnalytics = function() {
  _origRenderAnalytics();
  renderDrawdown();
  renderPeriodTable();
  renderSessionAnalysis();
};

// ═══════════════════════════════════════════════════════
// HOOK: Override saveTrade (was called via onclick="saveTrade()")
// to add validation. We intercept the actual save function.
// ═══════════════════════════════════════════════════════
const _origSaveTrade = saveTrade;
// We re-define saveTrade to inject validation
window.saveTrade = function() {
  hideFormError();
  const entry = parseFloat(document.getElementById('f_buy').value);
  const sl    = parseFloat(document.getElementById('f_sl').value);
  const tp    = parseFloat(document.getElementById('f_sell').value);
  const dir   = document.getElementById('f_dir').value;
  if (!isNaN(entry) && entry && !isNaN(sl) && sl) {
    if (dir === 'LONG'  && sl >= entry) { showFormError('Direction LONG : le Stop Loss doit être inférieur au prix d\'entrée.'); return; }
    if (dir === 'SHORT' && sl <= entry) { showFormError('Direction SHORT : le Stop Loss doit être supérieur au prix d\'entrée.'); return; }
  }
  _origSaveTrade();
};

// ═══════════════════════════════════════════════════════
// HOOK: calcPnl override to also trigger calcPosition
// ═══════════════════════════════════════════════════════
const _origCalcPnl = calcPnl;
window.calcPnl = calcPnl = function() {
  _origCalcPnl();
  calcPosition();
};
const _origCalcRisk = calcRisk;
window.calcRisk = calcRisk = function() {
  _origCalcRisk();
  calcPosition();
};

// ═══════════════════════════════════════════════════════
// INIT new features on page load
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  loadCalcCapital();
});
// Also run after trades are loaded (after the existing init block)
setTimeout(() => {
  loadCalcCapital();
}, 100);


// ══════════════════════════════════════════════════════
// ── Mode Simplifié ─────────────────────────────────────────────────────────
function toggleSimplifiedMode() {
  const panel = document.getElementById('jpanel-trader');
  const btn   = document.getElementById('btn-simplified');
  const on    = panel.classList.toggle('simplified-mode');
  btn.textContent = on ? '≡ Complet' : '◇ Simplifié';
  btn.classList.toggle('active', on);
  localStorage.setItem('tjournal_simplified', on ? '1' : '0');
}
(function initSimplified() {
  if (localStorage.getItem('tjournal_simplified') === '1') {
    const panel = document.getElementById('jpanel-trader');
    const btn   = document.getElementById('btn-simplified');
    if (panel) panel.classList.add('simplified-mode');
    if (btn)   { btn.textContent = '≡ Complet'; btn.classList.add('active'); }
  }
})();

// JOURNAL — sous-onglets Trader / Historique
// ══════════════════════════════════════════════════════
function switchJournalTab(name) {
  document.querySelectorAll('.journal-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.journal-subbtn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById('jpanel-' + name);
  const btn   = document.getElementById('jbtn-'   + name);
  if (panel) panel.classList.add('active');
  if (btn)   btn.classList.add('active');
  try { localStorage.setItem('journal_subtab', name); } catch(e) {}
  // Auto-fetch du capital Hyperliquid quand on ouvre le sous-onglet Trader
  if (name === 'trader') syncCalcCapitalFromPortfolio();
}
// Restaurer le dernier sous-onglet
(function() {
  const last = localStorage.getItem('journal_subtab') || 'trader';
  document.addEventListener('DOMContentLoaded', () => switchJournalTab(last));
})();

// ══════════════════════════════════════════════════════
// SUPPRIMER LES CAPTURES D'ÉCRAN via le launcher (port 8001)
// ══════════════════════════════════════════════════════
async function relancerBot(btn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.style.color = '#f59e0b';
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:bf-spin 0.7s linear infinite"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.84"/></svg>';
  try {
    await fetch('http://127.0.0.1:8001/restart', { method: 'POST', signal: AbortSignal.timeout(6000) });
    btn.style.color = '#4ade80';
  } catch(e) {
    btn.style.color = '#f87171';
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.style.color = '';
    btn.innerHTML = orig;
  }, 3000);
}

async function deleteScreenshots() {
  const btn      = document.getElementById('btn_del_screens');
  const feedback = document.getElementById('del_screens_feedback');
  if (!confirm('Vider le dossier Screenshots ?')) return;
  btn.disabled = true;
  feedback.style.color = 'var(--text2)';
  feedback.textContent = '⏳…';
  try {
    const r = await fetch('http://127.0.0.1:8000/delete_screenshots', { method: 'POST', signal: AbortSignal.timeout(3000) });
    const d = await r.json();
    if (d.ok) {
      feedback.style.color = '#4ade80';
      feedback.textContent = `✓ ${d.deleted} supprimé${d.deleted > 1 ? 's' : ''}`;
    } else {
      feedback.style.color = '#f87171';
      feedback.textContent = '✗ ' + (d.error || 'Erreur');
    }
  } catch {
    feedback.style.color = '#f87171';
    feedback.textContent = '✗ Lance le launcher d\'abord';
  }
  btn.disabled = false;
  setTimeout(() => { feedback.textContent = ''; }, 4000);
}

// ANNULER TOUS LES ORDRES via l'API locale (bot.py port 8000)
// ══════════════════════════════════════════════════════
async function cancelAllOrders() {
  const btn      = document.getElementById('btn_cancel_all');
  const feedback = document.getElementById('cancel_orders_feedback');
  btn.disabled = true;
  feedback.style.color = 'var(--text2)';
  feedback.textContent = '⏳ Annulation en cours…';
  try {
    const r = await fetch('http://127.0.0.1:8000/cancel', { method: 'POST' });
    const d = await r.json();
    if (d.ok) {
      feedback.style.color = '#4ade80';
      const parts = [];
      if (d.cancelled > 0) parts.push(`${d.cancelled} ordre(s) annulé(s)`);
      if (d.closed    > 0) parts.push(`${d.closed} position(s) fermée(s)`);
      feedback.textContent = parts.length > 0 ? '✓ ' + parts.join(' · ') : '✓ Rien à annuler';
    } else {
      feedback.style.color = '#f87171';
      feedback.textContent = '✗ Erreur : ' + (d.error || 'Inconnue');
    }
  } catch {
    feedback.style.color = '#f87171';
    feedback.textContent = '✗ Bot hors ligne (port 8000)';
  }
  btn.disabled = false;
}

// PLACER UN ORDRE via l'API locale (bot.py port 8000)
// ══════════════════════════════════════════════════════
async function placeOrderFromCalc(dryRun = false) {
  const ticker = (document.getElementById('f_ticker')?.value || '').trim().toUpperCase();
  const dir    = document.getElementById('f_dir')?.value || 'LONG';
  const { entry, qty, tp, sl, leverage } = _calcValues;

  const feedback  = document.getElementById('place_order_feedback');
  const btn       = document.getElementById(dryRun ? 'btn_simulate' : 'btn_place_order');
  const endpoint  = dryRun ? 'simulate' : 'order';

  if (!ticker) {
    feedback.textContent = 'Renseigne le ticker (BTC, ETH…)';
    feedback.style.color = 'var(--red)';
    return;
  }
  if (!entry || !qty || !sl || (!_noTp && !tp)) {
    feedback.textContent = 'Remplis Entry et SL pour calculer la position.';
    feedback.style.color = 'var(--red)';
    return;
  }

  btn.disabled = true;
  feedback.textContent = dryRun ? 'Vérification…' : 'Envoi en cours…';
  feedback.style.color = 'var(--text2)';

  const payload = {
    ticker, direction: dir,
    entry, sl, tp: tp ?? null,
    qty: parseFloat(qty.toFixed(6)),
    leverage,
  };

  try {
    const resp = await fetch(`http://127.0.0.1:8000/${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await resp.json();
    if (data.ok) {
      if (dryRun) {
        const r = data.recap;
        const tpStr = r.tp != null ? r.tp : 'Aucun (trailing)';
        feedback.innerHTML =
          `<strong style="color:var(--accent2)">[TEST — aucun ordre placé]</strong><br>` +
          `${r.ticker} ${r.direction} — Entry ${r.entry} | SL ${r.sl} | TP ${tpStr}<br>` +
          `Qty ${r.qty} coins · Position $${r.position_usd} · ×${r.leverage}`;
        feedback.style.color = 'var(--text)';
      } else {
        const tpStr = tp != null ? tp.toFixed(2) : 'Aucun (trailing)';
        feedback.textContent = `✓ Ordre placé — ${ticker} ${dir} ${qty.toFixed(4)} @ ${entry} | SL ${sl} | TP ${tpStr} | ×${leverage}`;
        feedback.style.color = 'var(--green)';
      }
    } else {
      feedback.textContent = `✗ Erreur : ${data.error}`;
      feedback.style.color = 'var(--red)';
    }
  } catch (e) {
    feedback.textContent = '✗ Serveur non joignable — vérifie que bot.py tourne (port 8000)';
    feedback.style.color = 'var(--red)';
  }

  setTimeout(() => { btn.disabled = false; }, 3000);
}

// ── Envoyer un trade "en attente" sur Telegram ────────────────────────────
async function sendPendingTrade() {
  const ticker = (document.getElementById('f_ticker')?.value || '').trim().toUpperCase();
  const dir    = document.getElementById('f_dir')?.value || 'LONG';
  const { entry, qty, tp, sl, leverage, realRisk } = _calcValues;
  const feedback = document.getElementById('place_order_feedback');
  const btn      = document.getElementById('btn_pending');

  if (!ticker) {
    feedback.textContent = 'Renseigne le ticker (BTC, ETH…)';
    feedback.style.color = 'var(--red)';
    return;
  }
  if (!entry || !qty || !sl || (!_noTp && !tp)) {
    feedback.textContent = 'Remplis Entry et SL pour calculer la position.';
    feedback.style.color = 'var(--red)';
    return;
  }

  btn.disabled    = true;
  btn.textContent = '⏳ Envoi…';
  feedback.textContent = '';

  const payload = {
    ticker,
    direction:    dir,
    entry,
    sl,
    tp: tp ?? null,
    qty:          parseFloat(qty.toFixed(6)),
    leverage,
    risk_pct:     realRisk || 0,
    position_usd: parseFloat((qty * entry).toFixed(2)),
  };

  try {
    const resp = await fetch('http://127.0.0.1:8000/pending_trade', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const data = await resp.json();
    if (data.ok) {
      feedback.textContent = '✓ Trade envoyé sur Telegram — réponds depuis l\'app pour le placer.';
      feedback.style.color = '#fbbf24';
    } else {
      feedback.textContent = '✗ ' + (data.error || 'Erreur inconnue');
      feedback.style.color = 'var(--red)';
    }
  } catch (e) {
    feedback.textContent = '✗ Bot hors-ligne — vérifie que bot.py tourne (port 8000)';
    feedback.style.color = 'var(--red)';
  }

  btn.disabled    = false;
  btn.textContent = '📤 En attente';
  setTimeout(() => { if (feedback) feedback.textContent = ''; }, 5000);
}

// ══════════════════════════════════════════════════════
// BOT CONTROL — Launcher (port 8001)
// ══════════════════════════════════════════════════════

const LAUNCHER_URL = 'http://127.0.0.1:8001';
let _botRunning    = null;   // null = inconnu, true/false = état connu
let _botTransition = false;  // true pendant démarrage/arrêt → bloque le polling de fond

function _setBotUI(running, loading = false) {
  _botRunning = loading ? _botRunning : running;

  const dots    = document.querySelectorAll('.bot-status-dot');
  const starts  = document.querySelectorAll('[id^="bc-start-"]');
  const stops   = document.querySelectorAll('[id^="bc-stop-"]');
  const labels  = document.querySelectorAll('[id^="bc-label-"]');

  // status dot
  dots.forEach(d => {
    d.className = 'bot-status-dot' + (loading ? ' loading' : running ? ' online' : ' offline');
  });
  // buttons
  starts.forEach(b => { b.disabled = loading || running === true; });
  stops.forEach(b  => { b.disabled = loading || running === false; });
  // labels
  labels.forEach(l => {
    l.textContent = loading ? 'Connexion…' : running ? 'En ligne' : 'Hors ligne';
    l.style.color = loading ? 'var(--yellow)' : running ? 'var(--green)' : 'var(--red)';
  });
  // journal card + mini dash card — glow & state classes
  const stateClass = loading ? ' loading' : running ? ' online' : ' offline';
  ['journal', 'dash'].forEach(id => {
    const glow = document.getElementById(`bc-glow-${id}`);
    const card = document.getElementById(`bc-card-${id}`);
    if (glow) glow.className = 'bot-card-glow' + stateClass;
    if (card) {
      card.classList.toggle('is-online',  !loading && running === true);
      card.classList.toggle('is-offline', !loading && running === false);
    }
  });
}

async function _checkBotStatus() {
  if (_botTransition) return;   // ne pas écraser l'état pendant démarrage/arrêt
  try {
    const r = await fetch(`${LAUNCHER_URL}/status`,
      { signal: AbortSignal.timeout(1200) });
    const d = await r.json();
    _setBotUI(d.running);
  } catch {
    _setBotUI(false);
  }
}

async function _pollUntil(condition, maxTries, intervalMs) {
  /** Poll silencieusement. Résout avec true si condition atteinte, false si timeout. */
  return new Promise(resolve => {
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      try {
        const r = await fetch(`${LAUNCHER_URL}/status`,
          { signal: AbortSignal.timeout(1200) });
        const d = await r.json();
        if (condition(d.running) || tries >= maxTries) {
          clearInterval(timer);
          resolve(d.running);
        }
        // sinon : on attend la prochaine tick, l'UI reste en "Connexion…"
      } catch {
        if (tries >= maxTries) { clearInterval(timer); resolve(false); }
      }
    }, intervalMs);
  });
}

async function botStart() {
  _botTransition = true;
  _setBotUI(null, true);
  try {
    await fetch(`${LAUNCHER_URL}/start`, { method: 'POST',
      signal: AbortSignal.timeout(4000) });
  } catch { /* launcher hors ligne */ }
  // Rester en "Connexion…" jusqu'à ce que le bot réponde — max 45 s
  const running = await _pollUntil(s => s === true, 60, 500);
  _botTransition = false;
  _setBotUI(running);
}

async function botStop() {
  _botTransition = true;
  _setBotUI(null, true);
  try {
    await fetch(`${LAUNCHER_URL}/stop`, { method: 'POST',
      signal: AbortSignal.timeout(4000) });
  } catch { /* launcher hors ligne */ }
  // Attendre l'arrêt effectif — max 8 s
  const running = await _pollUntil(s => s === false, 8, 1000);
  _botTransition = false;
  _setBotUI(running);
}

// Vérification initiale + polling toutes les 8 s
_checkBotStatus();
setInterval(_checkBotStatus, 8000);

// ══════════════════════════════════════════════════════
// HYPERLIQUID — Import du dernier trade fermé
// ══════════════════════════════════════════════════════

async function importLastHLTrade() {
  const btn    = document.getElementById('btn_hl_import');
  const label  = document.getElementById('bf_last_import');

  if (btn) { btn.disabled = true; btn.querySelector('.dot-live').style.animation = 'none'; }
  if (label) label.textContent = '…';

  try {
    const resp = await fetch('http://127.0.0.1:8000/hl/trades?days=30');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'Erreur inconnue');

    const list = data.trades || [];
    if (!list.length) throw new Error('Aucun trade fermé trouvé sur les 30 derniers jours');

    // Prendre le plus récent non encore importé
    const existIds = new Set(trades.map(x => x.hl_id).filter(Boolean));
    const t = list.find(x => !existIds.has(x.hl_id));
    if (!t) {
      if (label) label.textContent = '✓ Tous les trades récents sont déjà importés';
      return;
    }

    // ── Pré-remplir le formulaire ────────────────────────────────────────────
    const set = (id, val) => {
      if (val == null || val === '') return;
      const el = document.getElementById(id);
      if (el) el.value = val;
    };

    set('f_ticker',      t.ticker);
    syncTickerChips();   // reflète le ticker importé dans le menu déroulant
    set('f_date',        t.date);
    set('f_time',        t.time);
    set('f_time_end',    t.timeEnd);
    set('f_buy',         t.buy);
    set('f_sell',        t.sell);
    set('f_hl_id',       t.hl_id);
    set('f_amount_in',   t.amtIn);    // notionnel entrée (calculé depuis les fills)
    set('f_amount_out',  t.amtOut);   // notionnel sortie (PnL fees inclus)
    if (t.sl    != null) set('f_sl',  t.sl);   // SL depuis l'historique des ordres
    if (t.rrTarget != null) set('f_rr', t.rrTarget); // RR calculé depuis TP/SL

    // Direction
    const dirEl   = document.getElementById('f_dir');
    const dirDisp = document.getElementById('f_dir_display');
    if (dirEl)   dirEl.value       = t.dir;
    if (dirDisp) {
      dirDisp.textContent  = t.dir === 'LONG' ? '▲ LONG' : '▼ SHORT';
      dirDisp.style.color  = t.dir === 'LONG' ? 'var(--green)' : 'var(--red)';
    }

    // Propage le levier HL dans _calcValues avant recalcul du P&L%
    if (t.leverage && t.leverage > 1) {
      _calcValues = Object.assign({}, _calcValues, { leverage: t.leverage });
    }

    // Recalculs
    if (typeof calcDuration === 'function') calcDuration();
    if (typeof calcRisk     === 'function') calcRisk();
    if (typeof calcPnl      === 'function') calcPnl();

    // Feedback
    const sign   = t.pnlDollar >= 0 ? '+' : '';
    const dateD  = t.date ? t.date.split('-').reverse().join('/') : '';
    const slInfo = t.sl != null ? ` SL ${t.sl}` : ' (SL non trouvé)';
    const rrInfo = t.rrTarget != null ? ` RR ${t.rrTarget}` : '';
    if (label) label.textContent =
      `✓ ${t.ticker} ${t.dir} ${dateD} — ${sign}${t.pnlDollar.toFixed(2)} $${slInfo}${rrInfo} · Ajoute les screenshots`;

    // Scroll + focus sur f_sl si SL manquant, sinon sur f_sell
    switchJournalTab('trader');
    const focusId = t.sl == null ? 'f_sl' : 'f_sell';
    const focusEl = document.getElementById(focusId);
    if (focusEl) { focusEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); focusEl.focus(); }

  } catch (err) {
    if (label) label.style.color = 'var(--red)';
    if (label) label.textContent = `⚠ ${err.message}`;
    setTimeout(() => { if (label) { label.textContent = ''; label.style.color = ''; } }, 6000);
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('.dot-live').style.animation = ''; }
  }
}

// Reçoit les changements d'onglet depuis le hub
window.addEventListener('message', function(e) {
  if (!e.data) return;
  if (e.data.type === 'switch_tab') { switchTab(e.data.tab); return; }
});

