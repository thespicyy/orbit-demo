// ═══════════════════════════════════════════════════════════
//  NEXUS Budget — v1.0
// ═══════════════════════════════════════════════════════════

const LS_BUDGET    = 'nx_budget';
const LS_CATS      = 'nx_cats';
const LS_COMPTES   = 'nx_comptes';
const LS_TAB       = 'nx_tab';
const LS_THEME     = 'nx_theme';
const LS_LAST_CAT  = 'nx_last_cat';
const LS_TOMBSTONE = 'nx_tombstone';

// ── IDs & Tombstone ──────────────────────────────────────
// Chaque dépense reçoit un ID unique. Les suppressions sont
// mémorisées pour ne jamais réimporter un item supprimé.
function _genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
let _tombstone = new Set(JSON.parse(localStorage.getItem(LS_TOMBSTONE) || '[]'));
function _tombstoneAdd(id) { if (id) { _tombstone.add(id); localStorage.setItem(LS_TOMBSTONE, JSON.stringify([..._tombstone])); } }

const COLOR_MAP = {
  purple:'#7c3aed', teal:'#06b6d4', green:'#10b981',
  yellow:'#f59e0b', red:'#ef4444', orange:'#f97316'
};

const DEFAULT_CATS = [
  { id:'loyer',   name:'Loyer & Charges',    emoji:'🏠', budget:900,  color:'purple' },
  { id:'food',    name:'Alimentation',        emoji:'🛒', budget:400,  color:'teal'   },
  { id:'transp',  name:'Transport & Voiture', emoji:'🚗', budget:250,  color:'yellow' },
  { id:'abos',    name:'Abonnements',         emoji:'📱', budget:100,  color:'orange' },
  { id:'sante',   name:'Santé',               emoji:'🏥', budget:80,   color:'red'    },
  { id:'loisirs', name:'Loisirs & Sorties',   emoji:'🎬', budget:200,  color:'teal'   },
  { id:'habits',  name:'Vêtements',           emoji:'👕', budget:100,  color:'purple' },
  { id:'divers',  name:'Divers',              emoji:'💰', budget:150,  color:'green'  },
];

// ─── STATE ───────────────────────────────────────────────
let state = {
  budget:    {},
  cats:      [],
  comptes:   [],
  ops:       [],
  prices:    {},
  snapshots: [],
  eurRate:   null,
  eurRateTs: null,
};
let activeFilter  = 'tous';
let editingId     = null;
let cryptoDevise  = 'USD';
let charts = {};
let currentMonth = todayYM();
let editingCatId   = null;
let editingCompteId = null;

// ─── UTILS ───────────────────────────────────────────────
function todayYM() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
}
function fmtYM(ym) {
  const [y, m] = ym.split('-');
  const MOIS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  return MOIS[parseInt(m)-1] + ' ' + y;
}
function fmtEur(v, d=0) {
  if (v == null || isNaN(v)) return '—';
  return new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
}
function fmtUsd(v, d=0) {
  if (v == null || isNaN(v)) return '—';
  return new Intl.NumberFormat('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v) + ' $';
}
function fmtActif(v, compte) {
  if (compte === 'crypto' && cryptoDevise === 'USD' && state.eurRate)
    return v == null || isNaN(v) ? '—' : fmtUsd(v / state.eurRate);
  return fmtEur(v);
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return '—';
  return v.toFixed(1) + ' %';
}
function clamp(v,mn,mx){ return Math.max(mn,Math.min(mx,v)); }

// LS keys patrimoine (mêmes que l'ancien fichier pour récupérer les données)
const LS_OPS   = 'nexus_ops';
const LS_PRICE = 'nexus_prices';
const LS_SNAPS = 'nexus_snaps';

const COMPTE_COLOR = { crypto:'#f59e0b', pea:'#06b6d4', cto:'#10b981' };
const COMPTE_LABEL = { crypto:'Crypto', pea:'PEA', cto:'CTO' };

// ─── BOT API SYNC ─────────────────────────────────────────
const BOT_API = 'http://127.0.0.1:8000';

/**
 * Synchronise le budget avec le bot local (port 8000).
 * 1. Push l'état localStorage → API (inclut les éventuelles modifs offline)
 * 2. Pull le résultat (inclut les dépenses ajoutées via Telegram)
 * Silencieux si le bot est hors-ligne.
 */
function syncBotBudget(retries) {
  if (retries === undefined) retries = 4;
  (async function() {
    try {
      const localEmpty = !state.cats || state.cats.length === 0;

      // ── 1. Pull des items Telegram ───────────────────────────────────────
      // On tire UNIQUEMENT les items (jamais cats/salaire/budgets).
      // Dédup par ID + tombstone : un item supprimé ne reviendra jamais.
      const r = await fetch(BOT_API + '/budget/data', { signal: AbortSignal.timeout(2500) });
      const d = await r.json();
      if (!d.ok || !d.data) return;

      if (localEmpty) {
        // Première ouverture : restaurer tout depuis le bot
        if (d.data.cats   && d.data.cats.length)                state.cats   = d.data.cats;
        if (d.data.budget && Object.keys(d.data.budget).length) state.budget = d.data.budget;
        save(); renderAll();
        // Puis push pour que le bot ait nos IDs/tombstones
        await fetch(BOT_API + '/budget/sync', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ cats: state.cats, budget: state.budget }),
          signal: AbortSignal.timeout(2500),
        });
        return;
      }

      let changed = false;
      if (d.data.budget) {
        for (const [ym, botMd] of Object.entries(d.data.budget)) {
          if (!botMd.items) continue;
          const loc = state.budget[ym];
          if (!loc) continue;
          for (const [catId, botItems] of Object.entries(botMd.items)) {
            // Items Telegram du bot (assigner un ID si manquant = migration)
            const tgBot = (botItems || [])
              .filter(i => i.source === 'telegram')
              .map(i => i.id ? i : { ...i, id: _genId() });
            // Filtrer les tombstonés
            const tgNew = tgBot.filter(i => !_tombstone.has(i.id));
            // IDs déjà connus localement
            const locIds = new Set(((loc.items || {})[catId] || []).map(i => i.id));
            // Nouveaux IDs = pas encore dans le local
            const toAdd = tgNew.filter(i => !locIds.has(i.id));
            if (toAdd.length === 0) continue;
            // Ajouter les nouveaux items + update incrémentale des cats
            if (!loc.items)       loc.items = {};
            if (!loc.items[catId]) loc.items[catId] = [];
            loc.items[catId].push(...toAdd);
            if (!loc.cats) loc.cats = {};
            const addedAmt = toAdd.reduce((s, i) => s + i.amount, 0);
            loc.cats[catId] = Math.round(((loc.cats[catId] || 0) + addedAmt) * 100) / 100;
            changed = true;
          }
        }
      }
      if (changed) { save(); renderAll(); }

      // ── 2. Push : envoyer l'état local au bot ───────────────────────────
      await fetch(BOT_API + '/budget/sync', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ cats: state.cats, budget: state.budget }),
        signal: AbortSignal.timeout(2500),
      });
    } catch {
      if (retries > 0) { setTimeout(function() { syncBotBudget(retries - 1); }, 4000); }
    }
  })();
}

// ─── STORAGE ─────────────────────────────────────────
function save() {
  try {
    localStorage.setItem(LS_BUDGET,   JSON.stringify(state.budget));
    localStorage.setItem(LS_CATS,     JSON.stringify(state.cats));
    localStorage.setItem(LS_COMPTES,  JSON.stringify(state.comptes));
    localStorage.setItem(LS_OPS,      JSON.stringify(state.ops));
    localStorage.setItem(LS_PRICE,    JSON.stringify(state.prices));
    localStorage.setItem(LS_SNAPS,    JSON.stringify(state.snapshots));
    if (state.lastAddedCat) localStorage.setItem(LS_LAST_CAT, state.lastAddedCat);
  } catch(e) { console.error('Save error', e); }
}
function load() {
  try {
    const b = localStorage.getItem(LS_BUDGET);
    const c = localStorage.getItem(LS_CATS);
    const k = localStorage.getItem(LS_COMPTES);
    const o = localStorage.getItem(LS_OPS);
    const p = localStorage.getItem(LS_PRICE);
    const s = localStorage.getItem(LS_SNAPS);
    if (b) state.budget    = JSON.parse(b);
    if (c) state.cats      = JSON.parse(c);
    if (k) state.comptes   = JSON.parse(k);
    if (o) state.ops       = JSON.parse(o);
    if (p) state.prices    = JSON.parse(p);
    if (s) state.snapshots = JSON.parse(s);
    const lc = localStorage.getItem(LS_LAST_CAT);
    if (lc) state.lastAddedCat = lc;
    if (!state.cats.length) state.cats = JSON.parse(JSON.stringify(DEFAULT_CATS));
  } catch(e) { console.error('Load error', e); state.cats = JSON.parse(JSON.stringify(DEFAULT_CATS)); }
}

// ─── MONTH DATA ──────────────────────────────────────────
function getMonthData(ym) {
  if (!state.budget[ym]) state.budget[ym] = { salaire: 0, cats: {} };
  return state.budget[ym];
}
function setDepense(ym, catId, val) {
  const md = getMonthData(ym);
  md.cats[catId] = isNaN(val) ? 0 : Math.max(0, val);
  save();
  renderAll();
}
function setBudgetCat(ym, catId, val) {
  // Override budget for this month only — not stored in cats definition
  const md = getMonthData(ym);
  if (!md.budgets) md.budgets = {};
  md.budgets[catId] = isNaN(val) ? 0 : Math.max(0, val);
  save();
  renderAll();
}
function getCatBudget(ym, cat) {
  const md = getMonthData(ym);
  // Override explicite pour ce mois → priorité absolue
  if (md.budgets && md.budgets[cat.id] != null) return md.budgets[cat.id];
  // Héritage : remonte les mois précédents pour trouver le dernier override défini
  const prevMonths = Object.keys(state.budget)
    .filter(m => m < ym)
    .sort()
    .reverse();
  for (const m of prevMonths) {
    const pb = (state.budget[m] || {}).budgets || {};
    if (pb[cat.id] != null) return pb[cat.id];
  }
  // Fallback : budget par défaut de la catégorie
  return cat.budget;
}
function calcMonth(ym) {
  const md = getMonthData(ym);
  const depCats = state.cats.filter(c => (c.type || 'depense') === 'depense');
  const revCats = state.cats.filter(c => c.type === 'revenu');
  const invCats = state.cats.filter(c => c.type === 'investissement');
  // calcDepTotal si des items existent (inclut récurrents) ; md.cats en fallback (données bot sans items)
  const catVal = (c) => {
    const hasItems = (md.items?.[c.id] || []).length > 0 || getRecurringItems(c.id, ym).length > 0;
    return hasItems ? calcDepTotal(ym, c.id) : (md.cats[c.id] ?? 0);
  };
  const totalBudget  = depCats.reduce((s, c) => s + getCatBudget(ym, c), 0);
  const totalDeps    = depCats.reduce((s, c) => s + catVal(c), 0);
  const totalRevenus = revCats.reduce((s, c) => s + catVal(c), 0);
  const totalInvest  = invCats.reduce((s, c) => s + catVal(c), 0);
  const revenuTotal  = (md.salaire || 0) + totalRevenus;
  const epargne      = revenuTotal - totalDeps - totalInvest;
  const taux         = revenuTotal > 0 ? (epargne / revenuTotal * 100) : null;
  const tauxTotal    = revenuTotal > 0 ? ((epargne + totalInvest) / revenuTotal * 100) : null;
  return { salaire: md.salaire || 0, totalBudget, totalDeps, totalRevenus, totalInvest, revenuTotal, epargne, taux, tauxTotal };
}

// ─── NAVIGATION ──────────────────────────────────────────
function prevMonth() {
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(y, m-2, 1);
  currentMonth = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  renderAll();
}
function nextMonth() {
  const [y, m] = currentMonth.split('-').map(Number);
  const d = new Date(y, m, 1);
  currentMonth = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  renderAll();
}

// ─── SALARY ──────────────────────────────────────────────
function onSalaireChange() {
  const v = parseFloat(document.getElementById('salaireInput').value) || 0;
  getMonthData(currentMonth).salaire = v;
  save();
  renderBudgetSummary();
  renderDashboard();
  updateHeader();
}

// ─── RENDER: BUDGET TAB ──────────────────────────────────
function renderBudget() {
  document.getElementById('monthLabel').textContent = fmtYM(currentMonth);
  const md = getMonthData(currentMonth);
  document.getElementById('salaireInput').value = md.salaire || '';
  renderCatGrid();
  renderBudgetSummary();
}

function renderCatGrid() {
  const md   = getMonthData(currentMonth);
  const grid = document.getElementById('catGrid');
  if (!state.cats.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><svg viewBox="0 0 24 24"><path d="M9 14l-4-4 4-4"/><path d="M5 10h11a4 4 0 0 1 0 8h-1"/></svg><p>Aucune catégorie</p></div>';
    return;
  }
  grid.innerHTML = state.cats.map(cat => {
    const isRevenu  = cat.type === 'revenu';
    const isInvest  = cat.type === 'investissement';
    const budget  = getCatBudget(currentMonth, cat);
    const _md     = getMonthData(currentMonth);
    const _hasItems = (_md.items?.[cat.id] || []).length > 0 || getRecurringItems(cat.id, currentMonth).length > 0;
    const depense = _hasItems ? calcDepTotal(currentMonth, cat.id) : (_md.cats[cat.id] ?? 0);
    const pct     = budget > 0 ? clamp(depense / budget * 100, 0, 100) : (depense > 0 ? 100 : 0);
    const over    = !isRevenu && !isInvest && budget > 0 && depense > budget;
    const color   = isRevenu ? 'var(--green)' : isInvest ? 'var(--accent2)' : pct >= 100 ? 'var(--red)' : pct >= 75 ? 'var(--yellow)' : pct >= 50 ? 'var(--orange)' : 'var(--green)';
    const reste   = budget - depense;
    const cardStyle = isRevenu ? 'border-color:rgba(16,185,129,0.25);background:rgba(16,185,129,0.04);'
                    : isInvest ? 'border-color:rgba(6,182,212,0.25);background:rgba(6,182,212,0.04);' : '';
    const isLatest = state.lastAddedCat === cat.id;
    return `
      <div class="cat-card${isLatest ? ' latest-expense' : ''}" id="cat-card-${cat.id}" style="${cardStyle}">
        <div class="cat-header">
          <div class="cat-emoji">${cat.emoji}</div>
          <div class="cat-name">${cat.name}</div>
          <div class="cat-actions">
            <button class="cat-btn" onclick="openCatModal('${cat.id}')" title="Modifier">
              <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </div>
        </div>
        <div class="cat-inputs">
          <div class="cat-input-group">
            <label>Budget alloué €</label>
            <input type="number" value="${budget||''}" placeholder="0" min="0" step="10"
              onchange="setBudgetCat('${currentMonth}','${cat.id}',parseFloat(this.value)||0)"
              title="Budget alloué pour ${cat.name}"/>
          </div>
          <div class="cat-input-group">
            <label>${isRevenu ? 'Reçu €' : 'Dépensé €'}</label>
            <button onclick="openDepsModal('${cat.id}')" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:11px;color:var(--text);padding:6px 10px;font-family:'Inter',sans-serif;font-size:13px;font-weight:700;cursor:pointer;width:100%;text-align:left;transition:all .2s;display:flex;align-items:center;justify-content:space-between;gap:6px;"
              onmouseover="this.style.borderColor='rgba(124,58,237,0.6)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.09)'">
              <span>${depense > 0 ? fmtEur(depense) : '—'}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;opacity:0.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>
        <div class="pbar-wrap">
          <div class="pbar-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <div class="cat-bar-row">
          <span class="cat-pct" style="color:${color}">${budget>0?pct.toFixed(0)+'%':'—'}</span>
          <span class="cat-reste" style="color:${over?'var(--red)':''}">${over?'Dépassement '+fmtEur(Math.abs(reste)):'Reste '+fmtEur(reste)}</span>
        </div>
        ${(()=>{
          const recurring = getRecurringItems(cat.id, currentMonth).map(i => ({...i, _rec:true}));
          const monthly   = getItems(currentMonth, cat.id);
          const items = [...recurring, ...monthly];
          if (!items.length) return '';
          const rows = items.map(i => `<div class="tt-row">
            <span class="tt-label">${i._rec ? '🔁 ' : ''}${i.label || '—'}</span>
            <span class="tt-amount" style="color:${i.amount<0?'var(--green)':''}">${i.amount<0?'−':''}${fmtEur(Math.abs(i.amount))}</span>
          </div>`).join('');
          return `<div class="cat-tooltip">${rows}</div>`;
        })()}
      </div>`;
  }).join('');
}

function setDepenseInput(catId, input) {
  const val = parseFloat(input.value) || 0;
  const md = getMonthData(currentMonth);
  md.cats[catId] = val;
  save();
  renderBudgetSummary();
  updateHeader();
  // Update just this card's bar without full re-render
  const cat = state.cats.find(c => c.id === catId);
  if (!cat) return;
  const card   = document.getElementById('cat-card-'+catId);
  if (!card) return;
  const budget = getCatBudget(currentMonth, cat);
  const pct    = budget > 0 ? clamp(val / budget * 100, 0, 100) : (val > 0 ? 100 : 0);
  const over   = budget > 0 && val > budget;
  const color  = pct >= 100 ? 'var(--red)' : pct >= 75 ? 'var(--yellow)' : pct >= 50 ? 'var(--orange)' : 'var(--green)';
  const reste  = budget - val;
  card.querySelector('.pbar-fill').style.width = pct + '%';
  card.querySelector('.pbar-fill').style.background = color;
  card.querySelector('.cat-pct').textContent = budget > 0 ? pct.toFixed(0)+'%' : '—';
  card.querySelector('.cat-pct').style.color = color;
  card.querySelector('.cat-reste').textContent = over ? 'Dépassement '+fmtEur(Math.abs(reste)) : 'Reste '+fmtEur(reste);
  card.querySelector('.cat-reste').style.color = over ? 'var(--red)' : '';
}

function renderBudgetSummary() {
  const { salaire, totalBudget, totalDeps, totalRevenus, totalInvest, revenuTotal, epargne, taux, tauxTotal } = calcMonth(currentMonth);
  // Savings card
  const sEl = document.getElementById('savingsAmt');
  sEl.textContent = salaire > 0 || totalDeps > 0 ? fmtEur(epargne) : '—';
  sEl.className = 'savings-big' + (epargne < 0 ? ' neg' : '');
  document.getElementById('savingsRate').textContent =
    tauxTotal != null ? `Taux d'épargne : ${fmtPct(tauxTotal)}` : `Taux d'épargne : —`;
  // Summary
  const over  = totalDeps > totalBudget;
  const totalRec = calcRecurringTotal(currentMonth);
  const items = [
    ['Salaire net', fmtEur(salaire), ''],
    ...(totalRevenus > 0 ? [['Revenus complémentaires', fmtEur(totalRevenus), 'pos']] : []),
    ...(totalRevenus > 0 ? [['Revenu total', fmtEur(revenuTotal), '', true]] : []),
    ...(totalRec > 0 ? [['🔁 Charges fixes', fmtEur(totalRec), 'neg']] : []),
    ['Total dépensé', fmtEur(totalDeps), 'neg'],
    ...(totalInvest > 0 ? [['Investi ce mois', fmtEur(totalInvest), 'pos']] : []),
    ['Budget restant', `${fmtEur(totalBudget - totalDeps)} / ${fmtEur(totalBudget)}`, totalBudget - totalDeps < 0 ? 'neg' : 'pos'],
  ];
  document.getElementById('budgetSummary').innerHTML = items.map(([l,v,c,highlight])=> highlight
    ? `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;margin:4px 0;border-radius:9px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);">
        <span style="font-size:12px;font-weight:600;color:var(--green);">${l}</span>
        <span style="font-size:15px;font-weight:800;color:var(--green);">${v}</span>
       </div>`
    : `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);">
        <span style="font-size:12px;color:var(--text2);">${l}</span>
        <span style="font-size:13px;font-weight:700;" class="${c}">${v}</span>
       </div>`).join('');
  // Projections
  const annEpargne = epargne * 12;
  const totalLiq   = state.comptes.reduce((s, c) => s + (c.solde || 0), 0);
  const couverture = totalDeps > 0 ? (totalLiq / totalDeps).toFixed(1) : '—';
  const lastDeps = getLastExpenses(currentMonth, 3);
  const lastDepsHtml = lastDeps.length ? `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);">
      <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:var(--text2);text-transform:uppercase;margin-bottom:8px;">Dernières dépenses</div>
      ${lastDeps.map((item, i) => {
        const op = [1, 0.45, 0.12][i] ?? 0.1;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;opacity:${op};">
          <div style="display:flex;flex-direction:column;gap:1px;min-width:0;">
            <span style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:130px;">${item.label || '—'}</span>
            <span style="font-size:10px;color:var(--text2);">${item.catName}</span>
          </div>
          <span style="font-size:12px;font-weight:700;color:var(--red);flex-shrink:0;">−${fmtEur(item.amount)}</span>
        </div>`;
      }).join('')}
    </div>` : '';
  document.getElementById('projections').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;color:var(--text2);">Épargne projetée / an</span>
      <span style="font-size:13px;font-weight:700;" class="${annEpargne>=0?'pos':'neg'}">${salaire>0?fmtEur(annEpargne):'—'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;color:var(--text2);">Couverture fonds d'urgence</span>
      <span style="font-size:13px;font-weight:700;">${typeof couverture==='string'?'—':couverture+' mois'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:12px;color:var(--text2);">Dépenses fixes / an</span>
      <span style="font-size:13px;font-weight:700;">${fmtEur(totalDeps*12)}</span>
    </div>
    ${lastDepsHtml}`;
  // History
  renderHistory();
}

function renderHistory() {
  const months = Object.keys(state.budget).sort().reverse().slice(0, 12);
  const tbody = document.getElementById('historyTbody');
  if (!months.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><p>Aucun historique</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = months.map(ym => {
    const { salaire, totalDeps, epargne, taux } = calcMonth(ym);
    const totalRec = calcRecurringTotal(ym);
    const isCurrentMonth = ym === currentMonth;
    return `<tr style="${isCurrentMonth?'background:rgba(124,58,237,0.08);':''}">
      <td style="font-weight:${isCurrentMonth?'700':'500'}">${fmtYM(ym)}</td>
      <td class="right">${fmtEur(salaire)}</td>
      <td class="right" style="color:var(--text3)">${totalRec > 0 ? fmtEur(totalRec) : '—'}</td>
      <td class="right">${fmtEur(totalDeps)}</td>
      <td class="right ${epargne>=0?'pos':'neg'}">${fmtEur(epargne)}</td>
      <td class="right ${taux!=null&&taux>=0?'pos':'neg'}">${taux!=null?fmtPct(taux):'—'}</td>
    </tr>`;
  }).join('');
}

// ─── RENDER: COMPTES ─────────────────────────────────────
function renderComptes() {
  const list = document.getElementById('compteList');
  const TYPE_LABELS = { courant:'Compte courant', epargne:'Épargne', pea:'PEA', cto:'CTO', crypto:'Crypto', autre:'Autre' };
  if (!state.comptes.length) {
    list.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg><p>Aucun compte</p><span style="font-size:12px;color:var(--text3);">Ajoutez vos comptes pour suivre vos liquidités</span></div>';
  } else {
    list.innerHTML = state.comptes.map(c => `
      <div class="compte-row">
        <div class="compte-dot" style="background:${c.couleur};box-shadow:0 0 8px ${c.couleur}66;"></div>
        <div class="compte-info">
          <div class="compte-name">${c.nom}</div>
          <div class="compte-type">${TYPE_LABELS[c.type]||c.type}</div>
        </div>
        <div class="compte-solde ${c.solde<0?'neg':''}">${fmtEur(c.solde,2)}</div>
        <div class="compte-actions">
          <button class="cat-btn" onclick="openCompteModal('${c.id}')">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      </div>`).join('');
  }
  // Patrimoine calculé depuis les positions
  const positions = getPositions();
  const totals    = getTotals(positions);
  const byC       = totals.byCompte;

  // Section investissements calculés
  const investSection = document.getElementById('investSection');
  if (investSection) {
    if (positions.length) {
      investSection.innerHTML = `
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">
          <div style="font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text2);margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
            <span>Investissements (calculés)</span>
            <button class="btn btn-ghost btn-xs" onclick="switchTab('actifs')">Voir détail →</button>
          </div>
          <div class="invest-cards">
            <div class="invest-card crypto">
              <div class="invest-card-label">Crypto</div>
              <div class="invest-card-value">${fmtEur(byC.crypto.val,0)}</div>
              <div class="invest-card-sub ${(byC.crypto.val-byC.crypto.inv)>=0?'pos':'neg'}">${(byC.crypto.val-byC.crypto.inv)>=0?'+':''}${fmtEur(byC.crypto.val-byC.crypto.inv,0)}</div>
            </div>
            <div class="invest-card pea">
              <div class="invest-card-label">PEA</div>
              <div class="invest-card-value">${fmtEur(byC.pea.val,0)}</div>
              <div class="invest-card-sub ${(byC.pea.val-byC.pea.inv)>=0?'pos':'neg'}">${(byC.pea.val-byC.pea.inv)>=0?'+':''}${fmtEur(byC.pea.val-byC.pea.inv,0)}</div>
            </div>
            <div class="invest-card cto">
              <div class="invest-card-label">CTO</div>
              <div class="invest-card-value">${fmtEur(byC.cto.val,0)}</div>
              <div class="invest-card-sub ${(byC.cto.val-byC.cto.inv)>=0?'pos':'neg'}">${(byC.cto.val-byC.cto.inv)>=0?'+':''}${fmtEur(byC.cto.val-byC.cto.inv,0)}</div>
            </div>
          </div>
        </div>`;
    } else {
      investSection.innerHTML = `<div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:var(--text2);">Aucune position — ajoutez des opérations dans l'onglet <button class="btn btn-ghost btn-xs" onclick="switchTab('ops')">Opérations</button></div>`;
    }
  }

  // KPIs
  const totalLiq    = state.comptes.reduce((s,c) => s + (c.solde||0), 0);
  const totalEp     = state.comptes.filter(c=>c.type==='epargne').reduce((s,c)=>s+(c.solde||0),0);
  const totalCourant= state.comptes.filter(c=>c.type==='courant').reduce((s,c)=>s+(c.solde||0),0);
  const totalPatrim = totals.total;
  const pv = totals.plusValue;
  const kpis = [
    { label:'Patrimoine total',  value: fmtEur(totalLiq+totalPatrim,0), sub: 'Liquidités + investissements', color:'purple' },
    { label:'Investissements',   value: fmtEur(totalPatrim,0), sub: (pv>=0?'+':'')+fmtEur(pv,0)+' plus-value', color:'orange', subClass: pv>=0?'pos':'neg' },
    { label:'Total liquidités',  value: fmtEur(totalLiq,0), sub: state.comptes.length+' compte'+(state.comptes.length!==1?'s':''), color:'teal' },
    { label:'Compte courant',    value: fmtEur(totalCourant,0), sub: 'Disponible immédiatement', color:'green' },
  ];
  document.getElementById('compteKpis').innerHTML = kpis.map(k=>`
    <div class="kpi-card ${k.color}" style="padding:16px;">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub ${k.subClass||''}">${k.sub}</div>
    </div>`).join('');
  renderChartComptes();
}

// ─── RENDER: DASHBOARD ───────────────────────────────────
function renderDashboard() {
  const { salaire, totalDeps, epargne, taux, tauxTotal, totalRevenus, totalInvest, revenuTotal } = calcMonth(currentMonth);
  const totalLiq  = state.comptes.reduce((s,c) => s + (c.solde||0), 0);
  const { score, label, color: scCol, details } = calcHealthScore();
  // KPI grid
  const revenuLabel = totalRevenus > 0 ? 'Revenus totaux' : 'Salaire net';
  const revenuSub = totalRevenus > 0
    ? `Salaire net ${fmtEur(salaire)} · ${fmtYM(currentMonth)}`
    : fmtYM(currentMonth);
  const revenuValue = totalRevenus > 0 ? fmtEur(revenuTotal) : (salaire > 0 ? fmtEur(salaire) : '—');
  const kpis = [
    { label: revenuLabel, value: revenuValue, sub: revenuSub, color:'purple',
      icon:'<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
    { label:'Dépenses du mois', value: totalDeps>0?fmtEur(totalDeps):'—', sub: revenuTotal>0&&totalDeps>0?fmtPct(totalDeps/revenuTotal*100)+' du revenu':'', color:'yellow',
      icon:'<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>' },
    { label:'Épargne ce mois', value: salaire>0||totalDeps>0?fmtEur(epargne + totalInvest):'—',
      sub: tauxTotal!=null ? (totalInvest>0 ? `Liquide ${fmtEur(epargne)} · Investi ${fmtEur(totalInvest)}` : 'Taux : '+fmtPct(tauxTotal)) : '',
      color: (epargne+totalInvest)>=0?'green':'red',
      icon:'<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>' },
    { label:'Liquidités totales', value: fmtEur(totalLiq), sub: state.comptes.length+' compte'+(state.comptes.length!==1?'s':''), color:'teal',
      icon:'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>' },
  ];
  document.getElementById('kpiGrid').innerHTML = kpis.map(k => `
    <div class="kpi-card ${k.color}">
      <div class="kpi-icon ${k.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${k.icon}</svg></div>
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');
  // Score
  document.getElementById('scoreNum').textContent = score > 0 ? score : '—';
  document.getElementById('scoreNum').style.color = scCol;
  document.getElementById('scoreLabel').textContent = label;
  document.getElementById('scoreDetails').innerHTML = details.map(d => `
    <div class="score-row">
      <div class="pbar-wrap" style="flex:1;height:5px;"><div class="pbar-fill" style="width:${d.pct}%;background:${d.color};"></div></div>
      <span class="slbl">${d.label}</span>
      <span class="sval" style="color:${d.color};">${d.pts} pts</span>
    </div>`).join('');
  renderChartDeps();
  renderChartEvol();
  renderScoreRing(score, scCol);
}

// ─── HEALTH SCORE ────────────────────────────────────────
function calcHealthScore() {
  const { salaire, totalDeps, epargne, taux, tauxTotal } = calcMonth(currentMonth);
  const totalLiq = state.comptes.reduce((s,c)=>s+(c.solde||0),0);
  let pts = 0; const details = [];
  // 1. Taux d'épargne (40 pts)
  let epPts = 0;
  if (tauxTotal != null) {
    if (tauxTotal > 30) epPts = 40; else if (tauxTotal > 20) epPts = 30;
    else if (tauxTotal > 10) epPts = 20; else if (tauxTotal > 5) epPts = 10;
    else if (tauxTotal > 0) epPts = 5;
  }
  pts += epPts;
  details.push({ label: "Taux d'épargne ("+(tauxTotal!=null?fmtPct(tauxTotal):'—')+")", pts: epPts, pct: epPts/40*100, color: epPts>=30?'#10b981':epPts>=15?'#f59e0b':'#ef4444' });
  // 2. Fonds d'urgence (30 pts)
  let fuPts = 0;
  if (totalDeps > 0 && totalLiq > 0) {
    const mois = totalLiq / totalDeps;
    if (mois >= 6) fuPts = 30; else if (mois >= 3) fuPts = 22;
    else if (mois >= 2) fuPts = 15; else if (mois >= 1) fuPts = 8;
    else fuPts = 3;
  }
  pts += fuPts;
  const moisCouv = totalDeps > 0 ? (totalLiq / totalDeps).toFixed(1) : '—';
  details.push({ label: 'Fonds urgence ('+moisCouv+' mois)', pts: fuPts, pct: fuPts/30*100, color: fuPts>=22?'#10b981':fuPts>=10?'#f59e0b':'#ef4444' });
  // 3. Discipline budget (30 pts)
  const md = getMonthData(currentMonth);
  const catsWithBudget = state.cats.filter(c => getCatBudget(currentMonth, c) > 0);
  let dbPts = 30;
  if (catsWithBudget.length > 0) {
    const overCount = catsWithBudget.filter(c => (md.cats[c.id]||0) > getCatBudget(currentMonth, c)).length;
    dbPts = Math.max(0, 30 - overCount * 8);
  } else dbPts = 0;
  pts += dbPts;
  details.push({ label: 'Discipline budget', pts: dbPts, pct: dbPts/30*100, color: dbPts>=22?'#10b981':dbPts>=10?'#f59e0b':'#ef4444' });

  const score = pts;
  let label = '—', color = '#64748b';
  if (score >= 90) { label = 'Excellent'; color = '#10b981'; }
  else if (score >= 75) { label = 'Sain'; color = '#06b6d4'; }
  else if (score >= 55) { label = 'Stable'; color = '#f59e0b'; }
  else if (score >= 35) { label = 'Fragile'; color = '#f97316'; }
  else if (score > 0)   { label = 'Précaire'; color = '#ef4444'; }
  return { score, label, color, details };
}

// ─── CHARTS ──────────────────────────────────────────────
function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
function chartTick()  { return isLight() ? '#6b7280' : '#64748b'; }
function chartGrid()  { return isLight() ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)'; }
function destroyChart(k) { if (charts[k]) { charts[k].destroy(); charts[k] = null; } }

function renderChartDeps() {
  destroyChart('deps');
  const md = getMonthData(currentMonth);
  const cats = state.cats.filter(c => (md.cats[c.id]||0) > 0);
  const canvas = document.getElementById('chartDeps');
  if (!cats.length) {
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = '';
  charts.deps = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: cats.map(c => c.name),
      datasets: [{ data: cats.map(c => md.cats[c.id]||0),
        backgroundColor: cats.map(c => COLOR_MAP[c.color]||'#7c3aed'),
        borderColor: 'rgba(0,0,0,0.3)', borderWidth: 2,
        hoverOffset: 8, borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 }, cutout: '60%',
      plugins: {
        legend: { display: true, position: 'right',
          labels: { color: chartTick(), font: { family:'Inter', size:11 }, padding: 10, usePointStyle: true, pointStyleWidth: 8 }
        },
        tooltip: {
          backgroundColor: isLight()?'rgba(255,255,255,0.97)':'rgba(13,13,39,0.96)',
          borderColor: isLight()?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.12)', borderWidth:1,
          titleColor: isLight()?'#1e1e3a':'#e2e8f0', bodyColor: chartTick(), padding:10, cornerRadius:8,
          callbacks: { label: ctx => ' '+ctx.label+': '+fmtEur(ctx.raw,2) }
        }
      }
    }
  });
}

function renderChartEvol() {
  destroyChart('evol');
  const months = Object.keys(state.budget).sort().slice(-12);
  if (months.length < 1) return;
  const labels    = months.map(fmtYM);
  const salaires  = months.map(m => calcMonth(m).salaire);
  const revenus   = months.map(m => calcMonth(m).totalRevenus);
  const deps      = months.map(m => calcMonth(m).totalDeps);
  const epargnes  = months.map(m => calcMonth(m).epargne);
  const canvas = document.getElementById('chartEvol');
  const ctx = canvas.getContext('2d');
  const gradE = ctx.createLinearGradient(0,0,0,200);
  gradE.addColorStop(0,'rgba(16,185,129,0.3)'); gradE.addColorStop(1,'rgba(16,185,129,0)');
  charts.evol = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Salaire net', data: salaires, backgroundColor:'rgba(124,58,237,0.45)', borderColor:'#7c3aed', borderWidth:1, borderRadius:0, borderSkipped:false, stack:'revenus' },
        { label:'Revenus budget', data: revenus, backgroundColor:'rgba(6,182,212,0.45)', borderColor:'#06b6d4', borderWidth:1, borderRadius:6, borderSkipped:false, stack:'revenus' },
        { label:'Dépenses', data: deps, backgroundColor:'rgba(245,158,11,0.35)', borderColor:'#f59e0b', borderWidth:1, borderRadius:6, borderSkipped:false, stack:'deps' },
        { label:'Épargne', type:'line', data: epargnes, borderColor:'#10b981', backgroundColor: gradE,
          fill:true, tension:0.4, pointRadius:3, pointBackgroundColor:'#10b981', borderWidth:2, yAxisID:'y' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      plugins: {
        legend: { display: true, position: 'top',
          labels: { color: chartTick(), font: { family:'Inter', size:11 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 }
        },
        tooltip: {
          mode:'index', intersect:false,
          backgroundColor: isLight()?'rgba(255,255,255,0.97)':'rgba(13,13,39,0.96)',
          borderColor: isLight()?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.12)', borderWidth:1,
          titleColor: isLight()?'#1e1e3a':'#e2e8f0', bodyColor: chartTick(), padding:10, cornerRadius:8,
          callbacks: { label: ctx => ' '+ctx.dataset.label+': '+fmtEur(ctx.raw) }
        }
      },
      scales: {
        x: { stacked: true, grid:{ color: chartGrid() }, border:{display:false}, ticks:{ color: chartTick(), font:{family:'Inter',size:10} } },
        y: { stacked: true, grid:{ color: chartGrid() }, border:{display:false}, ticks:{ color: chartTick(), font:{family:'Inter',size:10}, callback: v => fmtEur(v,0) } }
      }
    }
  });
}

function renderChartComptes() {
  destroyChart('comptes');
  const canvas = document.getElementById('chartComptes');

  // Comptes manuels
  const manuals = state.comptes.filter(c => (c.solde||0) > 0);
  // Positions patrimoine
  const byC = getTotals(getPositions()).byCompte;
  const investments = [
    { nom:'Crypto', val: byC.crypto.val, couleur: COMPTE_COLOR.crypto },
    { nom:'PEA',    val: byC.pea.val,    couleur: COMPTE_COLOR.pea    },
    { nom:'CTO',    val: byC.cto.val,    couleur: COMPTE_COLOR.cto    },
  ].filter(i => i.val > 0);

  const all = [
    ...manuals.map(c => ({ nom: c.nom, val: c.solde||0, couleur: c.couleur })),
    ...investments,
  ];

  if (!all.length) { canvas.style.display = 'none'; return; }
  canvas.style.display = '';
  charts.comptes = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: all.map(c => c.nom),
      datasets: [{ data: all.map(c => c.val),
        backgroundColor: all.map(c => c.couleur),
        borderColor: 'rgba(0,0,0,0.3)', borderWidth: 2,
        hoverOffset: 8, borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 }, cutout:'60%',
      plugins: {
        legend: { display: true, position:'bottom',
          labels: { color: chartTick(), font:{family:'Inter',size:11}, padding:10, usePointStyle:true, pointStyleWidth:8 }
        },
        tooltip: {
          backgroundColor: isLight()?'rgba(255,255,255,0.97)':'rgba(13,13,39,0.96)',
          borderColor: isLight()?'rgba(0,0,0,0.1)':'rgba(255,255,255,0.12)', borderWidth:1,
          titleColor: isLight()?'#1e1e3a':'#e2e8f0', bodyColor: chartTick(), padding:10, cornerRadius:8,
          callbacks: { label: ctx => ' '+ctx.label+': '+fmtEur(ctx.raw,2) }
        }
      }
    }
  });
}

function renderScoreRing(score, color) {
  const canvas = document.getElementById('chartScore');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,140,140);
  const cx=70, cy=70, r=54, sw=10;
  // BG arc
  ctx.beginPath(); ctx.arc(cx,cy,r, -Math.PI*0.75, Math.PI*0.75);
  ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.lineWidth=sw; ctx.lineCap='round'; ctx.stroke();
  if (score > 0) {
    // Fill arc
    const endAngle = -Math.PI*0.75 + (Math.PI*1.5) * (score/100);
    ctx.beginPath(); ctx.arc(cx,cy,r, -Math.PI*0.75, endAngle);
    ctx.strokeStyle=color; ctx.lineWidth=sw; ctx.lineCap='round'; ctx.stroke();
  }
}

// ─── PATRIMOINE: DATA ────────────────────────────────────
function getPositions() {
  const map = {};
  for (const op of state.ops) {
    if (!op.actif) continue;
    const key = op.actif + '|' + op.compte;
    if (!map[key]) map[key] = { actif:op.actif, compte:op.compte, ops:[], firstDate:op.date };
    const pos = map[key];
    if (op.date < pos.firstDate) pos.firstDate = op.date;
    pos.ops.push(op);
    if (op.type==='conversion' && op.actifCible) {
      const keyT = op.actifCible + '|' + op.compte;
      if (!map[keyT]) map[keyT] = { actif:op.actifCible, compte:op.compte, ops:[], firstDate:op.date };
      if (op.date < map[keyT].firstDate) map[keyT].firstDate = op.date;
      map[keyT].ops.push(op);
    }
  }
  const byRecent = (a,b) => b.date.localeCompare(a.date) || b.id - a.id;
  const positions = [];
  for (const pos of Object.values(map)) {
    const isActions = pos.compte==='pea'||pos.compte==='cto';
    const achats = pos.ops.filter(o=>(o.type==='achat'&&(o.montant||0)>0)||(o.type==='conversion'&&o.actifCible===pos.actif&&(o.montant||0)>0));
    const ventes = pos.ops.filter(o=>o.type==='vente'||(o.type==='conversion'&&o.actif===pos.actif));
    if (isActions) {
      const last = [...achats].sort(byRecent)[0];
      pos.investi = last ? (last.montant||0) : 0;
    } else {
      pos.investi = Math.max(0, achats.reduce((s,o)=>s+(o.montant||0),0) - ventes.reduce((s,o)=>s+(o.montant||0),0));
    }
    const withVal = pos.ops.filter(o=>o.valeurCapital!=null&&o.type!=='conversion').sort(byRecent);
    pos.valeurCapital = withVal.length ? withVal[0].valeurCapital : 0;
    // Source d'une conversion : si la valorisation précède la conversion, scaler proportionnellement
    if (pos.valeurCapital > 0) {
      const convOut = pos.ops.filter(o=>o.type==='conversion'&&o.actif===pos.actif);
      if (convOut.length) {
        const lastConvDate = convOut.reduce((m,o)=>o.date>m?o.date:m,'');
        const lastValDate  = withVal.length ? withVal[0].date : '';
        if (!lastValDate || lastConvDate >= lastValDate) {
          const totalA = pos.ops.filter(o=>o.type==='achat'&&(o.montant||0)>0).reduce((s,o)=>s+(o.montant||0),0);
          const totalS = pos.ops.filter(o=>o.type==='vente'||(o.type==='conversion'&&o.actif===pos.actif)).reduce((s,o)=>s+(o.montant||0),0);
          if (totalA > 0) pos.valeurCapital = +(pos.valeurCapital * Math.max(0,(totalA-totalS)/totalA)).toFixed(2);
          // Conversion ≥99% de la valeur enregistrée → position fermée
          const origVal = withVal.length ? withVal[0].valeurCapital : 0;
          const totalConv = convOut.reduce((s,o)=>s+(o.montant||0),0);
          if (origVal > 0 && totalConv >= origVal * 0.99) { pos.investi = 0; pos.valeurCapital = 0; }
        }
      }
    }
    // Cible d'une conversion sans snapshot → valeur initiale = montant de la conversion
    if (pos.valeurCapital === 0 && withVal.length === 0) {
      const convIn = pos.ops.filter(o=>o.type==='conversion'&&o.actifCible===pos.actif).sort(byRecent);
      if (convIn.length) pos.valeurCapital = convIn[0].montant || 0;
    }
    if (pos.investi>0||pos.valeurCapital>0) positions.push(pos);
  }
  const totalVal = positions.reduce((s,p)=>s+p.valeurCapital,0);
  for (const pos of positions) {
    pos.plusValue  = pos.valeurCapital - pos.investi;
    pos.perf       = pos.investi>0 ? (pos.plusValue/pos.investi*100) : 0;
    pos.allocation = totalVal>0 ? (pos.valeurCapital/totalVal*100) : 0;
    pos.cagr       = calcCagr(pos.investi, pos.valeurCapital, pos.firstDate);
  }
  return positions.sort((a,b)=>b.valeurCapital-a.valeurCapital);
}
function getTotals(positions) {
  const byC = { crypto:{val:0,inv:0}, pea:{val:0,inv:0}, cto:{val:0,inv:0} };
  for (const p of positions) { if(byC[p.compte]){ byC[p.compte].val+=p.valeurCapital; byC[p.compte].inv+=p.investi; } }
  const total   = positions.reduce((s,p)=>s+p.valeurCapital,0);
  const investi = positions.reduce((s,p)=>s+p.investi,0);
  return { total, investi, plusValue:total-investi, perf:investi>0?((total-investi)/investi*100):0, byCompte:byC };
}
function getMonthlyContribs() {
  const map={};
  for (const op of state.ops) { if(op.type!=='achat') continue; const m=op.date.slice(0,7); map[m]=(map[m]||0)+(op.montant||0); }
  return Object.entries(map).sort(([a],[b])=>a.localeCompare(b));
}
function calcCagr(investi, valeur, firstDate) {
  if (!firstDate||!investi||investi<=0||!valeur||valeur<=0) return null;
  const years = (Date.now()-new Date(firstDate).getTime())/(365.25*24*3600*1000);
  if (years<1/12) return null;
  return (Math.pow(valeur/investi,1/years)-1)*100;
}
function fmtCagr(v) { return v==null?'—':(v>=0?'+':'')+v.toFixed(1)+'%/an'; }
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function setText(id,txt){ const el=document.getElementById(id); if(el) el.textContent=txt; }
function compteTag(c){ return `<span class="tag tag-${c}">${COMPTE_LABEL[c]||c}</span>`; }
function typeTag(t){
  const labels={achat:'Achat',vente:'Vente',valorisation:'Valorisation',conversion:'Conversion'};
  const cls={achat:'achat',vente:'vente',valorisation:'depot',conversion:'conversion'};
  return `<span class="tag tag-${cls[t]||'depot'}">${labels[t]||t}</span>`;
}

// ─── PATRIMOINE: RENDER ───────────────────────────────────
function toggleCryptoDevise() {
  cryptoDevise = cryptoDevise === 'USD' ? 'EUR' : 'USD';
  const btn = document.getElementById('btn-crypto-devise');
  if (btn) btn.textContent = 'Crypto : ' + (cryptoDevise === 'USD' ? '$ USD' : '€ EUR');
  if (cryptoDevise === 'USD' && !state.eurRate) fetchEurRate().then(renderActifs); else renderActifs();
}
function renderActifs() {
  let positions = getPositions();
  if (activeFilter!=='tous') positions = positions.filter(p=>p.compte===activeFilter);
  setText('actifCount', positions.length+' position(s)');
  if (cryptoDevise === 'USD' && !state.eurRate) { fetchEurRate().then(renderActifs); }
  const tbody = document.getElementById('actifTbody');
  if (!positions.length) {
    tbody.innerHTML='<tr><td colspan="9"><div class="empty-state"><svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg><p>Aucune position</p></div></td></tr>'; return;
  }
  tbody.innerHTML = positions.map(p => {
    const noVal=!p.valeurCapital;
    return `<tr>
      <td><strong>${p.actif}</strong></td>
      <td>${compteTag(p.compte)}</td>
      <td class="right">${fmtActif(p.investi,p.compte)}</td>
      <td class="right" style="font-weight:700">${noVal?'<span style="color:var(--yellow);font-size:10px">À maj</span>':fmtActif(p.valeurCapital,p.compte)}</td>
      <td class="right ${noVal?'neu':p.plusValue>=0?'pos':'neg'}" style="font-weight:600">${noVal?'—':(p.plusValue>=0?'+':'')+fmtActif(p.plusValue,p.compte)}</td>
      <td class="right ${noVal?'neu':p.perf>=0?'pos':'neg'}" style="font-weight:600">${noVal?'—':fmtPct(p.perf)}</td>
      <td class="right ${p.cagr!=null?p.cagr>=0?'pos':'neg':'neu'}" style="font-size:11px">${fmtCagr(p.cagr)}</td>
      <td class="right">
        <div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">
          <span style="font-size:11px;color:var(--text2)">${p.allocation.toFixed(1)}%</span>
          <div style="width:40px;height:4px;border-radius:2px;background:rgba(255,255,255,0.08);">
            <div style="width:${Math.min(p.allocation,100).toFixed(1)}%;height:100%;border-radius:2px;background:${COMPTE_COLOR[p.compte]||'#7c3aed'};"></div>
          </div>
        </div>
      </td>
      <td><button class="btn btn-ghost btn-xs" onclick="quickEditPrice('${p.actif}','${p.compte}')">Maj valeur</button></td>
    </tr>`;
  }).join('');
  // Stats
  const all = getPositions(); const totals = getTotals(all);
  setText('statOpsCount',   state.ops.length);
  setText('statActifsCount',new Set(all.map(p=>p.actif)).size);
  setText('statInvesti',    fmtEur(totals.investi,0));
  setText('statSnaps',      state.snapshots.length);
  setText('opsCount',       state.ops.length+' opération(s)');
}
function filterActifs(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderActifs();
}
function renderOps() {
  const tbody = document.getElementById('opsTbody');
  setText('opsCount', state.ops.length+' opération(s)');
  const ops = [...state.ops].sort((a,b)=>b.date.localeCompare(a.date));
  if (!ops.length) { tbody.innerHTML='<tr><td colspan="8"><div class="empty-state"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><p>Aucune opération</p></div></td></tr>'; return; }
  tbody.innerHTML = ops.map(op => `<tr>
    <td style="color:var(--text3)">${op.date}</td>
    <td>${compteTag(op.compte)}</td>
    <td>${typeTag(op.type)}</td>
    <td style="font-weight:700">${op.type==='conversion'?`${op.actif||'?'} → ${op.actifCible||'?'}`:(op.actif||'—')}</td>
    <td class="right" style="font-weight:600">${op.montant?fmtEur(op.montant):'—'}</td>
    <td class="right">${op.valeurCapital!=null?fmtEur(op.valeurCapital):'—'}</td>
    <td style="color:var(--text2);max-width:140px;overflow:hidden;text-overflow:ellipsis">${op.note||'—'}</td>
    <td style="white-space:nowrap;">
      <button class="btn btn-ghost btn-xs" onclick="editOp(${op.id})">✏</button>
      <button class="btn btn-danger btn-xs" style="margin-left:4px" onclick="deleteOp(${op.id})">✕</button>
    </td>
  </tr>`).join('');
}

// ─── PATRIMOINE: FORM ────────────────────────────────────
function onCompteChange() {
  const isActions = ['pea','cto'].includes(document.getElementById('f_compte').value);
  document.getElementById('fg_montant_simple').style.display = isActions?'none':'';
  document.getElementById('fg_quantite').style.display       = isActions?'':'none';
  document.getElementById('fg_prix_unit').style.display      = isActions?'':'none';
  document.getElementById('fg_montant_calc').style.display   = isActions?'':'none';
}
function onTypeChange() {
  const isConv = document.getElementById('f_type').value === 'conversion';
  document.getElementById('fg_actif_cible').style.display = isConv ? '' : 'none';
  document.getElementById('fg_conv_amount').style.display = isConv ? '' : 'none';
  document.getElementById('fg_valeur_capital').style.display = isConv ? 'none' : '';
  if (isConv) {
    document.getElementById('fg_montant_simple').style.display = 'none';
    document.getElementById('fg_quantite').style.display = 'none';
    document.getElementById('fg_prix_unit').style.display = 'none';
    document.getElementById('fg_montant_calc').style.display = 'none';
    updateConvAmounts();
  } else {
    onCompteChange();
  }
}
function getConvBase() {
  const actif = document.getElementById('f_actif').value.trim().toUpperCase();
  const compte = document.getElementById('f_compte').value;
  if (!actif) return null;
  const pos = getPositions().find(p => p.actif === actif && p.compte === compte);
  if (!pos) return null;
  return pos.valeurCapital > 0 ? pos.valeurCapital : (pos.investi > 0 ? pos.investi : null);
}
function updateConvAmounts() {
  const base = getConvBase();
  const hint = document.getElementById('conv_base_hint');
  if (base != null && hint) {
    const actif = document.getElementById('f_actif').value.trim().toUpperCase();
    const compte = document.getElementById('f_compte').value;
    const pos = getPositions().find(p => p.actif === actif && p.compte === compte);
    const isVal = pos && pos.valeurCapital > 0;
    hint.style.display = '';
    hint.textContent = `Base : ${fmtEur(base)} (${isVal ? 'valeur actuelle' : 'montant investi'})`;
    const pct = parseFloat(document.getElementById('f_conv_pct').value);
    if (!isNaN(pct)) document.getElementById('f_conv_eur').value = (pct / 100 * base).toFixed(2);
  } else if (hint) {
    hint.style.display = 'none';
    hint.textContent = '';
  }
}
function onConvPctChange() {
  const pct = parseFloat(document.getElementById('f_conv_pct').value);
  const base = getConvBase();
  if (!isNaN(pct) && base != null)
    document.getElementById('f_conv_eur').value = (pct / 100 * base).toFixed(2);
}
function onConvEurChange() {
  const eur = parseFloat(document.getElementById('f_conv_eur').value);
  const base = getConvBase();
  if (!isNaN(eur) && base != null && base > 0)
    document.getElementById('f_conv_pct').value = (eur / base * 100).toFixed(1);
}
function calcMontantQtyPrix() {
  const q=parseFloat(document.getElementById('f_quantite').value);
  const p=parseFloat(document.getElementById('f_prix_unit').value);
  const el=document.getElementById('montant_calc_preview');
  if (!isNaN(q)&&!isNaN(p)&&q>0&&p>0){ el.textContent=fmtEur(q*p); el.style.color='var(--accent2)'; }
  else { el.textContent='—'; el.style.color='var(--text2)'; }
}
function saveOp() {
  const date=document.getElementById('f_date').value;
  const compte=document.getElementById('f_compte').value;
  const type=document.getElementById('f_type').value;
  const actif=document.getElementById('f_actif').value.trim().toUpperCase();
  const actifCible=type==='conversion'?(document.getElementById('f_actif_cible')?.value.trim().toUpperCase()||''):null;
  const valeur=parseFloat(document.getElementById('f_valeur').value);
  const devise=document.getElementById('f_devise').value;
  const note=document.getElementById('f_note').value.trim();
  const isActions=['pea','cto'].includes(compte);
  if (!date||!actif) { alert('Date et actif requis.'); return; }
  if (type==='conversion'&&!actifCible) { alert('Actif cible requis pour une conversion.'); return; }
  let montant;
  if (isActions) {
    const q=parseFloat(document.getElementById('f_quantite').value);
    const p=parseFloat(document.getElementById('f_prix_unit').value);
    if (isNaN(q)||q<=0||isNaN(p)||p<=0) { alert('Quantité et prix requis.'); return; }
    montant=q*p;
  } else if (type==='conversion') {
    montant=parseFloat(document.getElementById('f_conv_eur').value);
    if (isNaN(montant)||montant<=0) { alert('Montant converti invalide.'); return; }
  } else {
    montant=parseFloat(document.getElementById('f_montant').value);
    if (isNaN(montant)||montant<0) { alert('Montant invalide.'); return; }
  }
  const valeurCapital = !isNaN(valeur)&&valeur>=0 ? +(convertToEur(valeur,devise)).toFixed(2) : null;
  const op = { id:editingId||Date.now(), date, compte, actif, actifCible:actifCible||null, type, note, montant:+montant.toFixed(2),
    quantite:isActions?parseFloat(document.getElementById('f_quantite').value):null,
    prixUnit:isActions?parseFloat(document.getElementById('f_prix_unit').value):null,
    valeurCapital, devise, valeurBrute:!isNaN(valeur)&&valeur>=0?+valeur.toFixed(2):null };
  if (editingId) { const i=state.ops.findIndex(o=>o.id===editingId); if(i>-1) state.ops[i]=op; }
  else state.ops.unshift(op);
  save(); resetForm(); renderAll();
}
function resetForm() {
  editingId=null;
  ['f_actif','f_actif_cible','f_conv_pct','f_conv_eur','f_montant','f_quantite','f_prix_unit','f_valeur','f_note'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('fg_actif_cible').style.display='none';
  document.getElementById('fg_conv_amount').style.display='none';
  document.getElementById('fg_valeur_capital').style.display='';
  const hint=document.getElementById('conv_base_hint'); if(hint){hint.style.display='none';hint.textContent='';}
  document.getElementById('montant_calc_preview').textContent='—';
  document.getElementById('montant_calc_preview').style.color='var(--text2)';
  document.getElementById('f_devise').value='EUR';
  document.getElementById('f_type').value='achat';
  document.getElementById('f_compte').value='crypto';
  document.getElementById('rateHintForm').style.display='none';
  document.getElementById('formTitle').textContent='Nouvelle opération';
  document.getElementById('btnSaveLabel').textContent='Enregistrer';
  document.getElementById('editingBadge').style.display='none';
  document.getElementById('f_date').value=new Date().toISOString().slice(0,10);
  onCompteChange();
}
function editOp(id) {
  const op=state.ops.find(o=>o.id===id); if(!op) return;
  editingId=id; switchTab('ops');
  document.getElementById('f_date').value=op.date;
  document.getElementById('f_compte').value=op.compte;
  document.getElementById('f_type').value=op.type;
  document.getElementById('f_actif').value=op.actif||'';
  document.getElementById('f_actif_cible').value=op.actifCible||'';
  document.getElementById('fg_actif_cible').style.display=op.type==='conversion'?'':'none';
  document.getElementById('fg_conv_amount').style.display=op.type==='conversion'?'':'none';
  document.getElementById('fg_valeur_capital').style.display=op.type==='conversion'?'none':'';
  if (op.type==='conversion') {
    document.getElementById('f_conv_eur').value=op.montant??'';
    updateConvAmounts();
    const base=getConvBase();
    if (base>0) document.getElementById('f_conv_pct').value=(op.montant/base*100).toFixed(1);
  }
  document.getElementById('f_note').value=op.note||'';
  document.getElementById('f_valeur').value=op.valeurBrute!=null?op.valeurBrute:(op.valeurCapital!=null?op.valeurCapital:'');
  document.getElementById('f_devise').value=op.devise||'EUR';
  onCompteChange();
  if (['pea','cto'].includes(op.compte)) {
    document.getElementById('f_quantite').value=op.quantite??'';
    document.getElementById('f_prix_unit').value=op.prixUnit??'';
    calcMontantQtyPrix();
  } else { document.getElementById('f_montant').value=op.montant??''; }
  document.getElementById('formTitle').textContent="Modifier l'opération";
  document.getElementById('btnSaveLabel').textContent='Mettre à jour';
  document.getElementById('editingBadge').style.display='inline-flex';
  onDeviseChange();
}
function deleteOp(id) {
  if (!confirm('Supprimer cette opération ?')) return;
  state.ops=state.ops.filter(o=>o.id!==id); save(); renderAll();
}

// ─── PATRIMOINE: PRIX ────────────────────────────────────
const EUR_RATE_TTL=3600000;
async function fetchEurRate(force=false) {
  const now=Date.now();
  if (!force&&state.eurRate&&state.eurRateTs&&(now-state.eurRateTs)<EUR_RATE_TTL) return state.eurRate;
  const APIS=[
    async()=>{ const r=await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR'); return (await r.json()).rates.EUR; },
    async()=>{ const r=await fetch('https://api.exchangerate-api.com/v4/latest/USD'); return (await r.json()).rates.EUR; },
    async()=>{ const r=await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'); return (await r.json()).usd.eur; }
  ];
  for (const api of APIS) { try { const rate=await api(); if(rate&&!isNaN(rate)){ state.eurRate=rate; state.eurRateTs=now; return rate; } } catch(e){} }
  return state.eurRate||null;
}
function convertToEur(v,devise){ return devise==='USD'&&state.eurRate ? v*state.eurRate : v; }
function updateRateHints() {
  const r=state.eurRate; const txt=r?r.toFixed(4):'—';
  const fEl=document.getElementById('rateValForm'); if(fEl) fEl.textContent=txt;
  const mEl=document.getElementById('modalRateVal'); if(mEl) mEl.textContent=r?`1 $ = ${r.toFixed(4)} €`:'Non disponible';
  return Promise.resolve();
}
function onDeviseChange() {
  const devise=document.getElementById('f_devise').value;
  const hint=document.getElementById('rateHintForm');
  if (devise==='USD'){ hint.style.display=''; fetchEurRate().then(updateRateHints); }
  else hint.style.display='none';
}
function renderPriceFields(positions) {
  document.getElementById('priceFields').innerHTML = positions.map(p => {
    const key=p.actif+'|'+p.compte;
    return `<div style="display:grid;grid-template-columns:120px 1fr 80px;gap:8px;align-items:center;">
      <label style="margin:0;font-size:12px;font-weight:700;color:var(--text);text-transform:none;letter-spacing:0;">${p.actif} <span style="font-size:10px;color:var(--text2)">(${p.compte})</span></label>
      <input type="number" id="px_${key}" placeholder="${p.valeurCapital?fmtEur(p.valeurCapital):'Valeur actuelle…'}" step="any" min="0" value="${p.valeurCapital||''}"/>
      <select id="pxd_${key}" class="devise-sel" style="font-size:11px;"><option value="EUR">€ EUR</option><option value="USD">$ USD</option></select>
    </div>`;
  }).join('');
  updateRateHints();
}
function openPriceModal() {
  const pos=getPositions(); if(!pos.length){ alert('Aucun actif. Ajoutez des opérations d\'abord.'); return; }
  renderPriceFields(pos); fetchEurRate().then(updateRateHints);
  document.getElementById('modalPrix').classList.add('open');
}
function quickEditPrice(actif, compte) {
  const pos=getPositions().filter(p=>p.actif===actif&&p.compte===compte); if(!pos.length) return;
  renderPriceFields(pos); fetchEurRate().then(updateRateHints);
  document.getElementById('modalPrix').classList.add('open');
  setTimeout(()=>document.getElementById('px_'+actif+'|'+compte)?.focus(),100);
}
function savePrices() {
  const today=new Date().toISOString().slice(0,10); let updated=0;
  getPositions().forEach(p => {
    const key=p.actif+'|'+p.compte;
    const inp=document.getElementById('px_'+key); const sel=document.getElementById('pxd_'+key);
    if (!inp) return; const raw=parseFloat(inp.value); if(isNaN(raw)||raw<0) return;
    const devise=sel?sel.value:'EUR';
    state.ops.unshift({ id:Date.now()+updated, date:today, compte:p.compte, actif:p.actif, type:'valorisation',
      montant:0, valeurCapital:+(convertToEur(raw,devise)).toFixed(2), devise, valeurBrute:+raw.toFixed(2), note:'Mise à jour valorisation' });
    updated++;
  });
  if (updated>0){ takeSnapshotSilent(); save(); closeModal('modalPrix'); renderAll(); }
  else closeModal('modalPrix');
}

// ─── PATRIMOINE: SNAPSHOTS ───────────────────────────────
function takeSnapshot() {
  const pos=getPositions(); const totals=getTotals(pos);
  const today=new Date().toISOString().slice(0,10);
  const snap={ id:Date.now(), date:today, total:+totals.total.toFixed(2), investi:+totals.investi.toFixed(2),
    byCompte:{ crypto:+totals.byCompte.crypto.val.toFixed(2), pea:+totals.byCompte.pea.val.toFixed(2), cto:+totals.byCompte.cto.val.toFixed(2) } };
  const existing=state.snapshots.findIndex(s=>s.date===today);
  if (existing>-1){ state.snapshots[existing]=snap; alert('Snapshot mis à jour.'); }
  else { state.snapshots.push(snap); alert('Snapshot enregistré : '+fmtEur(snap.total,0)+' au '+today); }
  save(); renderAll();
}
function takeSnapshotSilent() {
  const pos=getPositions(); const totals=getTotals(pos); const today=new Date().toISOString().slice(0,10);
  const snap={ id:Date.now(), date:today, total:+totals.total.toFixed(2), investi:+totals.investi.toFixed(2),
    byCompte:{ crypto:+totals.byCompte.crypto.val.toFixed(2), pea:+totals.byCompte.pea.val.toFixed(2), cto:+totals.byCompte.cto.val.toFixed(2) } };
  const existing=state.snapshots.findIndex(s=>s.date===today);
  if (existing>-1) state.snapshots[existing]=snap; else state.snapshots.push(snap);
}

// ─── IMPORT / EXPORT ─────────────────────────────────────
function exportData() {
  const data=JSON.stringify({ ops:state.ops, prices:state.prices, snapshots:state.snapshots },null,2);
  const a=document.createElement('a'); a.href='data:application/json,'+encodeURIComponent(data);
  a.download='nexus_patrimoine.json'; a.click();
}
function importData(e) {
  const file=e.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>{ try {
    const d=JSON.parse(ev.target.result);
    if(d.ops) state.ops=d.ops; if(d.prices) state.prices=d.prices; if(d.snapshots) state.snapshots=d.snapshots;
    save(); renderAll(); alert('Import réussi.');
  } catch(err){ alert('Fichier invalide.'); } };
  reader.readAsText(file); e.target.value='';
}
function clearOps() {
  if (!confirm('Effacer toutes les opérations patrimoine ?')) return;
  state.ops=[]; state.prices={}; state.snapshots=[]; save(); renderAll();
}

// ─── MODAL: DÉTAIL DÉPENSES ──────────────────────────────
let currentDepsCatId = null;
let expandedGroups   = new Set();
let _depsGroups      = []; // référence courante pour les indices onclick

function getItems(ym, catId) {
  const md = getMonthData(ym);
  if (!md.items) md.items = {};
  if (!md.items[catId]) md.items[catId] = [];
  return md.items[catId];
}

function getLastExpenses(ym, n = 3) {
  const md = getMonthData(ym);
  if (!md.items) return [];
  const depCats = state.cats.filter(c => (c.type || 'depense') === 'depense');
  const all = [];
  depCats.forEach(cat => {
    (md.items[cat.id] || []).forEach(item => all.push({ ...item, catName: cat.nom }));
  });
  return all.slice(-n).reverse();
}

function getRecurringItems(catId, ym) {
  const cat = state.cats.find(c => c.id === catId);
  if (!cat) return [];
  if (!cat.recurringItems) cat.recurringItems = [];
  if (!ym) return cat.recurringItems;
  return cat.recurringItems.filter(i =>
    (!i.from  || i.from  <= ym) &&
    (!i.until || i.until >= ym)
  );
}

function prevYM(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function calcDepTotal(ym, catId) {
  const monthly   = getItems(ym, catId).reduce((s, i) => s + i.amount, 0);
  const recurring = getRecurringItems(catId, ym).reduce((s, i) => s + i.amount, 0);
  return monthly + recurring;
}

function calcRecurringTotal(ym) {
  // Somme de tous les items récurrents actifs pour le mois, toutes catégories dépenses confondues
  return state.cats
    .filter(c => (c.type || 'depense') === 'depense')
    .reduce((s, c) => s + getRecurringItems(c.id, ym).reduce((a, i) => a + i.amount, 0), 0);
}

let isRecurring = false;
function toggleRecurring() {
  isRecurring = !isRecurring;
  const btn = document.getElementById('btnRecurring');
  btn.className = 'btn btn-sm' + (isRecurring ? ' btn-primary' : ' btn-ghost');
  btn.title = isRecurring ? 'Récurrent (actif)' : 'Répéter chaque mois';
}

function openDepsModal(catId) {
  currentDepsCatId = catId;
  const cat = state.cats.find(c => c.id === catId);
  document.getElementById('modalDepsTitle').textContent = (cat ? cat.emoji + ' ' + cat.name : 'Dépenses');
  document.getElementById('depsNewLabel').value = '';
  document.getElementById('depsNewAmount').value = '';
  isRecurring = false;
  expandedGroups = new Set();
  const btn = document.getElementById('btnRecurring');
  btn.className = 'btn btn-ghost btn-sm';
  renderDepsModal();
  document.getElementById('modalDeps').classList.add('open');
  setTimeout(() => document.getElementById('depsNewAmount').focus(), 100);
}

function renderDepsModal() {
  const monthlyItems   = getItems(currentMonth, currentDepsCatId).map((item, idx) => ({...item, _src:'monthly',   _idx:idx}));
  const recurringItems = getRecurringItems(currentDepsCatId, currentMonth).map((item, idx) => ({...item, _src:'recurring', _idx:idx}));
  const allItems = [...recurringItems, ...monthlyItems];
  const total = getMonthData(currentMonth).cats[currentDepsCatId] ?? calcDepTotal(currentMonth, currentDepsCatId);
  document.getElementById('depsTotalAmt').textContent = fmtEur(total);

  if (!allItems.length) {
    document.getElementById('depsItemList').innerHTML = '<p style="font-size:12px;color:var(--text2);padding:12px 0;">Aucune dépense. Ajoutez des lignes ci-dessous.</p>';
    return;
  }

  // Grouper par nom
  const groupMap = {};
  const groupOrder = [];
  for (const item of allItems) {
    const key = (item.label || '—').trim().toLowerCase();
    if (!groupMap[key]) { groupMap[key] = { label: item.label||'—', items:[], total:0 }; groupOrder.push(key); }
    groupMap[key].items.push(item);
    groupMap[key].total += item.amount;
  }
  _depsGroups = groupOrder.map(k => groupMap[k]);

  const delBtn = (src, idx) => `
    <button class="deps-item-del" onclick="removeAnyItem('${src}',${idx})">
      <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;

  document.getElementById('depsItemList').innerHTML = _depsGroups.map((group, gi) => {
    const isExpanded  = expandedGroups.has(gi);
    const hasMultiple = group.items.length > 1;
    const hasRecurring = group.items.some(i => i._src === 'recurring');
    const amtCol = group.total < 0 ? 'var(--green)' : '';

    const row = `<div class="deps-item" style="${hasMultiple ? 'cursor:pointer;' : ''}" onclick="${hasMultiple ? `toggleDepsGroup(${gi})` : ''}">
      <span class="deps-item-label">
        ${hasRecurring ? '<span style="opacity:.6;margin-right:3px;">🔁</span>' : ''}
        ${group.label}
        ${hasMultiple ? `<span style="font-size:10px;color:var(--text2);margin-left:5px;">×${group.items.length}</span>` : ''}
      </span>
      <span class="deps-item-amount" style="color:${amtCol}">${group.total<0?'−':''}${fmtEur(Math.abs(group.total))}</span>
      ${hasMultiple
        ? `<span style="color:var(--text2);font-size:14px;transition:transform .2s;display:inline-block;transform:rotate(${isExpanded?'90deg':'0deg'})">›</span>`
        : delBtn(group.items[0]._src, group.items[0]._idx)}
    </div>`;

    const detail = hasMultiple && isExpanded ? group.items.map(item => `
      <div class="deps-item" style="padding-left:22px;background:rgba(255,255,255,0.025);border-radius:0;">
        <span class="deps-item-label" style="color:var(--text3);font-size:11px;">${item.label||'—'}${item._src==='recurring'?' 🔁':''}</span>
        <span class="deps-item-amount" style="font-size:11px;color:${item.amount<0?'var(--green)':''}">${item.amount<0?'−':''}${fmtEur(Math.abs(item.amount))}</span>
        ${delBtn(item._src, item._idx)}
      </div>`).join('') : '';

    return row + detail;
  }).join('');
}

function toggleDepsGroup(gi) {
  if (expandedGroups.has(gi)) expandedGroups.delete(gi);
  else expandedGroups.add(gi);
  renderDepsModal();
}

function removeAnyItem(src, idx) {
  if (src === 'recurring') removeRecurringItem(idx);
  else removeDepsItem(idx);
}

function addDepsItem() {
  const amount = parseFloat(document.getElementById('depsNewAmount').value);
  if (!amount || amount === 0) { document.getElementById('depsNewAmount').focus(); return; }
  const label = document.getElementById('depsNewLabel').value.trim();
  if (isRecurring) {
    getRecurringItems(currentDepsCatId).push({ label, amount, from: currentMonth });
  } else {
    getItems(currentMonth, currentDepsCatId).push({ id: _genId(), label, amount });
  }
  // Update incrémentale : on ajoute le montant au total existant (préserve les dépenses historiques)
  const md = getMonthData(currentMonth);
  // Si jamais défini manuellement, initialiser depuis les récurrents pour ne pas les perdre
  const base = md.cats[currentDepsCatId] != null
    ? md.cats[currentDepsCatId]
    : getRecurringItems(currentDepsCatId, currentMonth).reduce((s, i) => s + i.amount, 0);
  md.cats[currentDepsCatId] = Math.round((base + amount) * 100) / 100;
  state.lastAddedCat = currentDepsCatId;
  save();
  document.getElementById('depsNewLabel').value = '';
  document.getElementById('depsNewAmount').value = '';
  document.getElementById('depsNewAmount').focus();
  renderDepsModal();
  renderCatGrid();
  renderBudgetSummary();
  updateHeader();
}

function removeRecurringItem(idx) {
  const all  = getRecurringItems(currentDepsCatId);
  const item = all[idx];
  if (item && item.from && item.from >= currentMonth) {
    all.splice(idx, 1);
  } else {
    item.until = prevYM(currentMonth);
  }
  const total = calcDepTotal(currentMonth, currentDepsCatId);
  getMonthData(currentMonth).cats[currentDepsCatId] = total;
  save();
  renderDepsModal();
  renderCatGrid();
  renderBudgetSummary();
  updateHeader();
}

function removeDepsItem(idx) {
  const items = getItems(currentMonth, currentDepsCatId);
  const item  = items[idx];
  _tombstoneAdd(item && item.id);                          // mémoriser la suppression
  items.splice(idx, 1);
  // Update incrémentale : on soustrait le montant du total existant
  const md = getMonthData(currentMonth);
  md.cats[currentDepsCatId] = Math.max(0, Math.round(((md.cats[currentDepsCatId] || 0) - (item ? item.amount : 0)) * 100) / 100);
  save();
  renderDepsModal();
  renderCatGrid();
  renderBudgetSummary();
  updateHeader();
}

// ─── MODAL: CATÉGORIE ────────────────────────────────────
let currentCatType = 'depense';
function setCatType(type) {
  currentCatType = type;
  const btnD = document.getElementById('catTypeDepense');
  const btnR = document.getElementById('catTypeRevenu');
  const btnI = document.getElementById('catTypeInvest');
  btnD.className = 'btn btn-sm' + (type === 'depense'        ? ' btn-primary' : ' btn-ghost');
  btnR.className = 'btn btn-sm' + (type === 'revenu'         ? ' btn-primary' : ' btn-ghost');
  btnI.className = 'btn btn-sm' + (type === 'investissement' ? ' btn-primary' : ' btn-ghost');
  document.getElementById('catBudgetLabel').textContent =
    type === 'revenu' ? 'Montant attendu (€)' : 'Budget par défaut (€)';
  if (type === 'revenu')         document.getElementById('catColor').value = 'green';
  if (type === 'investissement') document.getElementById('catColor').value = 'teal';
}

function openCatModal(id) {
  editingCatId = id || null;
  const modal = document.getElementById('modalCat');
  document.getElementById('modalCatTitle').textContent = id ? 'Modifier la catégorie' : 'Nouvelle catégorie';
  document.getElementById('btnDeleteCat').style.display = id ? '' : 'none';
  if (id) {
    const cat = state.cats.find(c=>c.id===id);
    if (cat) {
      setCatType(cat.type || 'depense');
      document.getElementById('catName').value   = cat.name;
      document.getElementById('catEmoji').value  = cat.emoji;
      document.getElementById('catBudget').value = cat.budget;
      document.getElementById('catColor').value  = cat.color;
    }
  } else {
    setCatType('depense');
    document.getElementById('catName').value   = '';
    document.getElementById('catEmoji').value  = '';
    document.getElementById('catBudget').value = '';
    document.getElementById('catColor').value  = 'purple';
  }
  modal.classList.add('open');
}
function saveCat() {
  const name   = document.getElementById('catName').value.trim();
  const emoji  = document.getElementById('catEmoji').value.trim() || '💰';
  const budget = parseFloat(document.getElementById('catBudget').value) || 0;
  const color  = document.getElementById('catColor').value;
  if (!name) { document.getElementById('catName').focus(); return; }
  const type = currentCatType;
  if (editingCatId) {
    const cat = state.cats.find(c=>c.id===editingCatId);
    if (cat) Object.assign(cat, { name, emoji, budget, color, type });
  } else {
    state.cats.push({ id: 'cat_'+Date.now(), name, emoji, budget, color, type });
  }
  save(); closeModal('modalCat'); renderAll();
}
function deleteCat() {
  if (!editingCatId) return;
  if (!confirm('Supprimer cette catégorie ?')) return;
  state.cats = state.cats.filter(c=>c.id!==editingCatId);
  save(); closeModal('modalCat'); renderAll();
}

// ─── MODAL: COMPTE ───────────────────────────────────────
function openCompteModal(id) {
  editingCompteId = id || null;
  const modal = document.getElementById('modalCompte');
  document.getElementById('modalCompteTitle').textContent = id ? 'Modifier le compte' : 'Nouveau compte';
  document.getElementById('btnDeleteCompte').style.display = id ? '' : 'none';
  if (id) {
    const c = state.comptes.find(c=>c.id===id);
    if (c) {
      document.getElementById('compteName').value   = c.nom;
      document.getElementById('compteType').value   = c.type;
      document.getElementById('compteSolde').value  = c.solde;
      document.getElementById('compteCouleur').value= c.couleur;
    }
  } else {
    document.getElementById('compteName').value  = '';
    document.getElementById('compteType').value  = 'courant';
    document.getElementById('compteSolde').value = '';
    document.getElementById('compteCouleur').value = '#7c3aed';
  }
  modal.classList.add('open');
}
function saveCompte() {
  const nom    = document.getElementById('compteName').value.trim();
  const type   = document.getElementById('compteType').value;
  const solde  = parseFloat(document.getElementById('compteSolde').value) || 0;
  const couleur= document.getElementById('compteCouleur').value;
  if (!nom) { document.getElementById('compteName').focus(); return; }
  if (editingCompteId) {
    const c = state.comptes.find(c=>c.id===editingCompteId);
    if (c) Object.assign(c, { nom, type, solde, couleur });
  } else {
    state.comptes.push({ id:'cpt_'+Date.now(), nom, type, solde, couleur });
  }
  save(); closeModal('modalCompte'); renderAll();
}
function deleteCompte() {
  if (!editingCompteId) return;
  if (!confirm('Supprimer ce compte ?')) return;
  state.comptes = state.comptes.filter(c=>c.id!==editingCompteId);
  save(); closeModal('modalCompte'); renderAll();
}

// ─── GENERIC MODAL ───────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});
document.addEventListener('keydown', e => { if (e.key==='Escape') document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open')); });
document.addEventListener('keydown', function(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input','textarea','select'].includes(tag)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch(e.key) {
    case 'a': case 'A': switchTab('dashboard'); break;
    case 'z': case 'Z': switchTab('budget');    break;
    case 'e': case 'E': switchTab('comptes');   break;
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
  }
});

// ─── Onglet Opérations : la colonne de gauche ("Nouvelle opération") et la
// colonne de droite (Résumé/Import-Export/À investir) ont un contenu de
// nature différente, donc pas de raison structurelle d'avoir la même
// hauteur naturelle. Plutôt que deviner un padding à la main (fragile dès
// que le contenu change), on mesure les deux colonnes après rendu et on
// ajoute exactement le nombre de pixels manquant au bas de la dernière
// carte de droite ("À investir") — écart garanti nul, recalculé à chaque
// fois (resize compris), sans toucher à la structure existante.
function matchOpsColumnHeight() {
  var grid = document.querySelector('#tab-ops .grid-2');
  if (!grid || grid.children.length < 2) return;
  var col1 = grid.children[0], col2 = grid.children[1];
  var col2Last = col2.lastElementChild;
  if (!col2Last) return;
  // Symétrique : selon la largeur de fenêtre, le formulaire ("Nouvelle
  // opération") peut être soit plus grand soit plus petit que la colonne de
  // droite (sa grille de champs change de nombre de colonnes avec l'espace
  // disponible) — on ne peut pas supposer laquelle des deux sera la plus
  // courte. On repart toujours des deux hauteurs naturelles, puis on
  // rallonge celle qui est la plus courte pour matcher l'autre exactement.
  col1.style.paddingBottom = '';
  col2Last.style.paddingBottom = '';
  // Deux passes : la 1ère annule l'essentiel de l'écart, la 2e absorbe le
  // résidu d'arrondi sub-pixel (offsetHeight est entier) pour un écart
  // garanti à 0px, pas juste "proche de".
  for (var pass = 0; pass < 2; pass++) {
    var diff = col1.offsetHeight - col2.offsetHeight;
    if (diff === 0) break;
    if (diff > 0) {
      var base2 = parseFloat(getComputedStyle(col2Last).paddingBottom) || 0;
      col2Last.style.paddingBottom = (base2 + diff) + 'px';
    } else {
      var base1 = parseFloat(getComputedStyle(col1).paddingBottom) || 0;
      col1.style.paddingBottom = (base1 - diff) + 'px';
    }
  }
}
var _opsResizeT;
window.addEventListener('resize', () => {
  clearTimeout(_opsResizeT);
  _opsResizeT = setTimeout(() => { if (document.getElementById('tab-ops').classList.contains('active')) matchOpsColumnHeight(); }, 150);
});
function _isOpsTabActive() { var el = document.getElementById('tab-ops'); return el && el.classList.contains('active'); }
// Le chargement des polices web (Syne/Space Grotesk) peut légèrement changer
// la métrique du texte après la première mesure : on recale une fois de plus
// une fois les polices prêtes, si l'onglet Opérations est toujours affiché.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => { if (_isOpsTabActive()) matchOpsColumnHeight(); });
}

// ─── TAB ROUTING ─────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.content').forEach(c => c.classList.toggle('active', c.id === 'tab-'+name));
  localStorage.setItem(LS_TAB, name);
  if (name === 'dashboard') { destroyChart('deps'); destroyChart('evol'); renderDashboard(); }
  if (name === 'budget')    renderBudget();
  if (name === 'comptes')   renderComptes();
  if (name === 'actifs')    renderActifs();
  if (name === 'ops')       {
    renderOps(); resetForm(); initRebalance();
    requestAnimationFrame(() => requestAnimationFrame(matchOpsColumnHeight));
    setTimeout(() => { if (_isOpsTabActive()) matchOpsColumnHeight(); }, 200); // passe de sécurité (reflow tardif)
  }
  if (name === 'projection') { projInit(); requestAnimationFrame(()=>{ if(projChart){projChart.resize();projDoUpdate();} }); }
  if (window.parent !== window) window.parent.postMessage({type:'tab_changed', tab:name}, '*');
}

window.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'switch_tab') return;
  switchTab(e.data.tab);
});

// ─── THEME ───────────────────────────────────────────────
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next === 'dark' ? null : next);
  if (next === 'light') document.documentElement.setAttribute('data-theme','light');
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem(LS_THEME, next);
  if (window.parent !== window) window.parent.postMessage({ type: 'theme_change', theme: next }, '*');
  Object.values(charts).forEach(c => { if (c) c.destroy(); });
  charts = {};
  renderAll();
}

// ─── UPDATE HEADER ────────────────────────────────────────
function updateHeader() {
  const { epargne, salaire, totalDeps } = calcMonth(currentMonth);
  const totalLiq = state.comptes.reduce((s,c)=>s+(c.solde||0),0);
  const eEl = document.getElementById('hdrEpargne');
  eEl.textContent = salaire>0||totalDeps>0 ? fmtEur(epargne) : '—';
  eEl.className = 'val ' + (epargne >= 0 ? 'pos' : 'neg');
  document.getElementById('hdrLiquidites').textContent = fmtEur(totalLiq);
}

// ─── RENDER ALL ───────────────────────────────────────────
function renderAll() {
  const active = document.querySelector('.tab.active');
  const tab = active ? active.dataset.tab : 'dashboard';
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'budget')    renderBudget();
  if (tab === 'comptes')   renderComptes();
  if (tab === 'actifs')    renderActifs();
  if (tab === 'ops')       renderOps();
  updateHeader();
}

// ═══ PROJECTION ══════════════════════════════════════════════════════════════
const PROJ_A0=25, PROJ_A1=55, PROJ_N=PROJ_A1-PROJ_A0;
const PROJ_AGES=Array.from({length:PROJ_N+1},(_,i)=>PROJ_A0+i);
const PROJ_PEA_MAX=150000, PROJ_PS=0.172, PROJ_PFU=0.30;

const fmtE=v=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(Math.round(v))+' €';

// ── Salaire brut → net mensuel → montant investi ─────────────────────────────
// Barème IR 2024, célibataire (1 part) — approximation.
const PROJ_IR_BAREME=[[11294,0],[28797,0.11],[82341,0.30],[177106,0.41],[Infinity,0.45]];
function projIR(imposable){
  let t=0,prev=0;
  for(const[c,r]of PROJ_IR_BAREME){ if(imposable>prev){ t+=(Math.min(imposable,c)-prev)*r; prev=c; } else break; }
  return t;
}
// Net mensuel après charges sociales (cadre 25% / non-cadre 22%) puis IR simplifié.
function projNetMensuel(brutAnnuel){
  if(!(brutAnnuel>0)) return 0;
  // Taux de charges salariales appliqué automatiquement selon le statut
  // (calibré pour coller à salaire-brut-en-net.fr : cadre ~28%, non-cadre ~23%).
  const ch=projV.statut==='noncadre'?0.23:0.28;
  const netAv=brutAnnuel*(1-ch);        // net avant impôt (annuel)
  const ir=projIR(netAv*0.9);           // abattement forfaitaire 10% puis barème
  return (netAv-ir)/12;
}
// Montant investi mensuel = net mensuel − reste à vivre (jamais négatif).
function projInvestMensuel(brutAnnuel, reste){
  return Math.max(0, projNetMensuel(brutAnnuel)-(reste||0));
}
// Apport mensuel investi sur tout l'horizon, dérivé du salaire par phases
// (chaque phase : âge de début + durée + salaire brut annuel + reste à vivre).
function projBuildApArr(){
  const total=PROJ_N*12, arr=new Array(total).fill(0);
  const brutByAge={}, resteByAge={};
  for(const p of (projV.salaryPhases||[])){
    const a0=Math.round(p.age||PROJ_A0), yrs=Math.max(0,Math.round(p.yrs||0));
    for(let a=a0;a<a0+yrs;a++){ const idx=a-PROJ_A0; if(idx>=0&&idx<PROJ_N){ brutByAge[idx]=p.brut||0; resteByAge[idx]=p.reste||0; } }
  }
  for(let a=0;a<PROJ_N;a++){
    const inv=projInvestMensuel(brutByAge[a]||0, resteByAge[a]||0);
    for(let m=0;m<12;m++) arr[a*12+m]=inv;
  }
  return arr;
}
// Rendement crypto décroissant : interpole linéairement de r0 (âge 25) à r1 (âge 55).
function projCryRateArr(r0,r1){
  const total=PROJ_N*12, arr=new Array(total);
  for(let m=0;m<total;m++) arr[m]=r0+(r1-r0)*(m/(total-1));
  return arr;
}
function projSimBase(apArr,r,sa,rp,k0,taxe,plafond){
  const rArr=Array.isArray(r)?r:null;               // rendement variable (par mois) ou constant
  const tmC=rArr?0:Math.pow(1+r/100,1/12)-1, trm=Math.pow(1+rp/100,1/12)-1;
  let K=k0, Vv=plafond?Math.min(k0,plafond):k0;
  const B=[],Bn=[],Bv=[]; let mois=0,mc=null;
  for(let a=0;a<=PROJ_N;a++){
    const age=PROJ_A0+a;
    B.push(K); Bn.push(K-Math.max(0,K-Vv)*taxe); Bv.push(Vv);
    if(a<PROJ_N) for(let m=0;m<12;m++){
      if(age<sa){
        const c=apArr[mois]||0;
        if(plafond){ if(Vv<plafond){ const v=Math.min(c,plafond-Vv); K+=v;Vv+=v; if(Vv>=plafond&&mc===null)mc=mois+1; } }
        else{ K+=c; Vv+=c; }
      }
      const tm=rArr?(Math.pow(1+rArr[mois]/100,1/12)-1):tmC;
      K=rp>0&&age>=sa?Math.max(0,K*(1+tm-trm)):K*(1+tm);
      mois++;
    }
  }
  return{B,Bn,Bv,mc};
}
function projSimPEA(apArr,r,sa,rp,k0){
  const pea=projSimBase(apArr,r,sa,rp,k0,PROJ_PS,PROJ_PEA_MAX);
  const debut=pea.mc??Infinity;
  const tm=Math.pow(1+r/100,1/12)-1, trm=Math.pow(1+rp/100,1/12)-1;
  let K=0,Vv=0; const cB=[],cN=[],cV=[]; let mois=0;
  for(let a=0;a<=PROJ_N;a++){
    const age=PROJ_A0+a;
    cB.push(K); cN.push(K-Math.max(0,K-Vv)*PROJ_PFU); cV.push(Vv);
    if(a<PROJ_N) for(let m=0;m<12;m++){
      if(age<sa&&mois>=debut){ const c=apArr[mois]||0; K+=c; Vv+=c; }
      K=rp>0&&age>=sa?Math.max(0,K*(1+tm-trm)):K*(1+tm);
      mois++;
    }
  }
  return{B:pea.B.map((v,i)=>v+cB[i]),Bn:pea.Bn.map((v,i)=>v+cN[i]),Bv:pea.Bv.map((v,i)=>v+cV[i]),mc:pea.mc};
}
const projSimCRY=(apArr,r,sa,rp,k0)=>projSimBase(apArr,r,sa,rp,k0,PROJ_PFU,null);

// ── Phases de salaire (UI dynamique) ─────────────────────
function projRenderStatut(){
  document.querySelectorAll('.proj-statut-btn').forEach(b=>b.classList.toggle('active',b.dataset.statut===projV.statut));
}
function projSetStatut(v){
  projV.statut=v; projSaveLS(); projRenderStatut(); projRenderPhases(); projSchedUpdate();
}
function _projPhaseSplit(brut, reste){
  const net=projNetMensuel(brut), inv=projInvestMensuel(brut, reste);
  const pea=Math.round(inv*projV.pct/100), cry=Math.round(inv-pea);
  return `→ net <b>${fmtE(net)}</b>/m · investi <b style="color:#8b9ef5">${fmtE(inv)}</b>/m `
    +`<span style="color:#64748b">(PEA ${pea} · Cry ${cry})</span>`;
}
function projRenderPhases(){
  const cont=document.getElementById('proj_phases'); if(!cont)return;
  const ph=projV.salaryPhases;
  cont.innerHTML=ph.map((p,i)=>{
    const del=ph.length>1?`<button type="button" class="pp-del" onclick="projDelPhase(${i})" title="Supprimer">−</button>`:'';
    return `<div class="proj-phase">
      <span class="pp-num">${i+1}</span>
      <span class="pp-dur">dès <input type="number" class="pp-yrs" min="25" max="54" step="1" value="${p.age}" oninput="projPhaseChange(${i},'age',this)"/> ans</span>
      <span class="pp-dur">pdt <input type="number" class="pp-yrs" min="1" max="30" step="1" value="${p.yrs}" oninput="projPhaseChange(${i},'yrs',this)"/> ans</span>
      <input type="number" class="pp-amt" min="0" step="1000" value="${p.brut}" oninput="projPhaseChange(${i},'brut',this)"/><span class="pp-unit">€/an brut</span>
      <span class="pp-dur">reste <input type="number" class="pp-yrs" min="0" step="50" value="${p.reste}" oninput="projPhaseChange(${i},'reste',this)"/> €/m</span>
      <span class="pp-split">${_projPhaseSplit(p.brut, p.reste)}</span>
      ${del}
    </div>`;
  }).join('');
}
function projPhaseChange(i,field,el){
  const v=parseFloat(el.value); if(isNaN(v))return;
  projV.salaryPhases[i][field]=Math.max(0,v);
  projSaveLS();
  if(field==='brut'||field==='reste'){ // maj du split de la ligne sans re-render (garde le focus)
    const row=el.closest('.proj-phase'), sp=row&&row.querySelector('.pp-split'), p=projV.salaryPhases[i];
    if(sp) sp.innerHTML=_projPhaseSplit(p.brut, p.reste);
  }
  projSchedUpdate();
}
function projAddPhase(){
  const arr=projV.salaryPhases, last=arr[arr.length-1];
  const nextAge=last?Math.min(54,Math.round((last.age||25)+(last.yrs||1))):25;
  arr.push({age:nextAge,yrs:3,brut:last?last.brut:35000,reste:last?last.reste:1500});
  projSaveLS(); projRenderPhases(); projSchedUpdate();
}
function projDelPhase(i){
  if(projV.salaryPhases.length<=1)return;
  projV.salaryPhases.splice(i,1);
  projSaveLS(); projRenderPhases(); projSchedUpdate();
}

const PROJ_CFG={
  pct:   {v:70,  lo:0,  hi:100,  st:5,   fmt:v=>v+' %'},
  pea_k: {v:1700,lo:0,  hi:10000,st:100, fmt:v=>v+' €'},
  pea_r: {v:10,  lo:1,  hi:20,   st:0.5, fmt:v=>(+v).toFixed(1)+' %'},
  pea_a: {v:40,  lo:25, hi:55,   st:1,   fmt:v=>v+' ans'},
  pea_ret:{v:4,  lo:0,  hi:15,   st:1,   fmt:v=>v+' %'},
  cry_k: {v:0,   lo:0,  hi:100000,st:5000,fmt:v=>v+' €'},
  cry_r0:{v:20,  lo:1,  hi:100,  st:1,   fmt:v=>v+' %'},
  cry_r1:{v:6,   lo:0,  hi:50,   st:1,   fmt:v=>v+' %'},
  cry_a: {v:40,  lo:25, hi:55,   st:1,   fmt:v=>v+' ans'},
  cry_ret:{v:4,  lo:0,  hi:15,   st:1,   fmt:v=>v+' %'},
};
const PROJ_LS='nx_proj_v1';
const projV={};
(function(){
  let s={};
  try{s=JSON.parse(localStorage.getItem(PROJ_LS))||{};}catch(e){}
  Object.keys(PROJ_CFG).forEach(k=>projV[k]=s[k]??PROJ_CFG[k].v);
  if(s.cry_r!=null && s.cry_r0==null) projV.cry_r0=s.cry_r;   // migration ancien rendement fixe
  // Statut (charges sociales) + phases de salaire {age début, durée, brut annuel}
  projV.statut = s.statut==='noncadre' ? 'noncadre' : 'cadre';
  projV.salaryPhases = (Array.isArray(s.salaryPhases)&&s.salaryPhases.length)
    ? s.salaryPhases
    : [{age:25,yrs:3,brut:30000,reste:1500},{age:28,yrs:12,brut:45000,reste:1800}];
  const _oldReste = s.resteAVivre!=null ? s.resteAVivre : 1500;   // reste par phase (ancien global -> défaut)
  projV.salaryPhases.forEach(p=>{ if(p.reste==null) p.reste=_oldReste; });
})();
function projSaveLS(){try{localStorage.setItem(PROJ_LS,JSON.stringify(projV));}catch(e){}}
function projSetTrack(id,v){
  const el=document.getElementById('sl_'+id); if(!el)return;
  const c=PROJ_CFG[id];
  el.style.setProperty('--p',((v-c.lo)/(c.hi-c.lo)*100).toFixed(1)+'%');
}
function onSl(id,v){
  projV[id]=parseFloat(v);
  document.getElementById('vl_'+id).textContent=PROJ_CFG[id].fmt(v);
  projSetTrack(id,v); projSaveLS();
  if(id==='pct') projRenderPhases();   // recalcule le split PEA/Crypto de chaque phase
  projSchedUpdate();
}
function step(id,dir){
  const c=PROJ_CFG[id],el=document.getElementById('sl_'+id);
  const nv=Math.min(c.hi,Math.max(c.lo,parseFloat(el.value)+dir*c.st));
  el.value=nv; onSl(id,nv);
}

let projChart, proj_raf=null;

function projExternalTooltip({chart,tooltip}){
  const el=document.getElementById('chartTooltip');
  if(tooltip.opacity===0){el.classList.add('hidden');return;}
  el.classList.remove('hidden');
  const dp=tooltip.dataPoints; if(!dp||!dp.length)return;
  const by={}; dp.forEach(p=>by[p.datasetIndex]=p.parsed.y);
  const age=dp[0].parsed.x;
  const versé=by[0],peaBrut=by[1],peaNet=by[2],cryBrut=by[3],cryNet=by[4],totNet=by[5];
  const peaVersé=by[6]??0, cryVersé=by[7]??0;
  const peaTrm=Math.pow(1+projV.pea_ret/100,1/12)-1;
  const cryTrm=Math.pow(1+projV.cry_ret/100,1/12)-1;
  const peaRmB=peaBrut*peaTrm, cryRmB=cryBrut*cryTrm;
  const peaGR=peaBrut>0?Math.max(0,peaBrut-peaVersé)/peaBrut:0;
  const cryGR=cryBrut>0?Math.max(0,cryBrut-cryVersé)/cryBrut:0;
  const peaRm=peaRmB*(1-peaGR*PROJ_PS), cryRm=cryRmB*(1-cryGR*PROJ_PFU);
  const totRm=peaRm+cryRm;
  const phase=a=>a>=projV.pea_a?'(retraits)':'(versements)';
  const phaseC=a=>a>=projV.cry_a?'(retraits)':'(versements)';
  el.innerHTML=`
    <div class="tt-age">${age} ans</div>
    <div class="tt-sec">
      <div class="tt-sec-title" style="color:#00e5a0">PEA ${phase(age)}</div>
      <div class="tt-row"><span class="tt-lbl">Brut</span><span class="tt-val" style="color:#e2e8f0">${fmtE(peaBrut)}</span></div>
      <div class="tt-row"><span class="tt-lbl">Net (PS 17.2%)</span><span class="tt-val" style="color:#00e5a0">${fmtE(peaNet)}</span></div>
      <div class="tt-row"><span class="tt-lbl">Retrait mensuel net</span><span class="tt-val" style="color:#00e5a0">${fmtE(peaRm)}/m</span></div>
    </div>
    <div class="tt-divider"></div>
    <div class="tt-sec">
      <div class="tt-sec-title" style="color:#f7931a">Crypto ${phaseC(age)}</div>
      <div class="tt-row"><span class="tt-lbl">Brut</span><span class="tt-val" style="color:#e2e8f0">${fmtE(cryBrut)}</span></div>
      <div class="tt-row"><span class="tt-lbl">Net (PFU 30%)</span><span class="tt-val" style="color:#f7931a">${fmtE(cryNet)}</span></div>
      <div class="tt-row"><span class="tt-lbl">Retrait mensuel net</span><span class="tt-val" style="color:#f7931a">${fmtE(cryRm)}/m</span></div>
    </div>
    <div class="tt-divider"></div>
    <div class="tt-sec">
      <div class="tt-sec-title" style="color:#fff">Total</div>
      <div class="tt-row"><span class="tt-lbl">Versé cumulé</span><span class="tt-val" style="color:#64748b">${fmtE(versé)}</span></div>
      <div class="tt-row"><span class="tt-lbl">Brut total</span><span class="tt-val" style="color:#fff">${fmtE(peaBrut+cryBrut)}</span></div>
      <div class="tt-row"><span class="tt-lbl">Retrait mensuel total</span><span class="tt-val" style="color:#06b6d4">${fmtE(totRm)}/m</span></div>
    </div>`;
  const cx=tooltip.caretX, cy=tooltip.caretY;
  const wrap=chart.canvas.parentNode;
  const tw=el.offsetWidth, th=el.offsetHeight;
  const ww=wrap.offsetWidth, wh=wrap.offsetHeight;
  el.style.position='absolute';
  let x=cx+16, y=cy-th/2;
  if(x+tw>ww-8) x=cx-tw-16;
  if(y<4) y=4;
  if(y+th>wh-4) y=wh-th-4;
  el.style.left=x+'px'; el.style.top=y+'px';
}

if(!window._projVlinesOk){
  window._projVlinesOk=true;
  Chart.register({id:'vlines',afterDraw(ch){
    if(!ch._vlines||!ch._vlines.length)return;
    const{ctx,chartArea:{left,right,top,bottom},scales:{x}}=ch;
    ch._vlines.forEach(({age,color,label},i)=>{
      const px=x.getPixelForValue(age);
      if(px<left-1||px>right+1)return;
      ctx.save();
      ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.setLineDash([4,4]);
      ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,bottom);ctx.stroke();
      ctx.setLineDash([]);ctx.fillStyle=color;
      ctx.font='bold 9px Inter,monospace';
      const labelY=top+13+i*16,labelX=px+4;
      const align=px>right-80?'right':'left';
      ctx.textAlign=align;
      ctx.fillText(label,align==='right'?px-4:labelX,labelY);
      ctx.restore();
    });
  }});
}

// ── Bezier interpolation (même helper que equity curve) ──────────────
function projBezierAt(pts,idxF){
  const lo=Math.max(0,Math.floor(idxF)),hi=Math.min(pts.length-1,Math.ceil(idxF));
  if(lo===hi)return{x:pts[lo].x,y:pts[lo].y};
  const t=idxF-lo,mt=1-t,p=pts[lo],c=pts[hi];
  const cp2x=p.cp2x??(p.x+c.x)/2,cp2y=p.cp2y??(p.y+c.y)/2;
  const cp1x=c.cp1x??(p.x+c.x)/2,cp1y=c.cp1y??(p.y+c.y)/2;
  return{
    x:mt*mt*mt*p.x+3*mt*mt*t*cp2x+3*mt*t*t*cp1x+t*t*t*c.x,
    y:mt*mt*mt*p.y+3*mt*mt*t*cp2y+3*mt*t*t*cp1y+t*t*t*c.y
  };
}

// ── Plugin reveal projection (copie exacte de equityRevealPlugin) ────
if(!window._projCrosshairOk){
  window._projCrosshairOk=true;
  Chart.register({id:'projCrosshair',afterDatasetsDraw(ch){
    if(ch.canvas.id!=='myChart')return;
    const idx=ch._revealIdx; if(idx==null)return;
    const{ctx,chartArea}=ch;
    const pts=ch.getDatasetMeta(5).data; // Total brut — ligne principale
    if(!pts||pts.length<2)return;
    const hIdx=Math.min(idx,pts.length-1);
    const rx=ch._revealX??pts[hIdx].x;
    const ry=ch._revealY??pts[hIdx].y;

    // Ligne bezier lumineuse de 0 à rx, clippée (comme equityRevealPlugin)
    ctx.save();
    ctx.beginPath();
    ctx.rect(chartArea.left,chartArea.top,rx-chartArea.left+1,chartArea.height);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(pts[0].x,pts[0].y);
    const drawTo=Math.min(hIdx+1,pts.length-1);
    for(let i=1;i<=drawTo;i++){
      const p=pts[i-1],c=pts[i];
      ctx.bezierCurveTo(
        p.cp2x??(p.x+c.x)/2, p.cp2y??(p.y+c.y)/2,
        c.cp1x??(p.x+c.x)/2, c.cp1y??(p.y+c.y)/2,
        c.x,c.y
      );
    }
    ctx.strokeStyle=isLight()?'#1e1e3a':'#ffffff';
    ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
    ctx.restore();

    // Ligne verticale pointillée à rx
    ctx.save();
    ctx.setLineDash([4,5]);
    ctx.beginPath();ctx.moveTo(rx,chartArea.top);ctx.lineTo(rx,chartArea.bottom);
    ctx.strokeStyle=isLight()?'rgba(0,0,0,0.2)':'rgba(255,255,255,0.25)';
    ctx.lineWidth=1;ctx.stroke();ctx.setLineDash([]);ctx.restore();

    // Dot + halo sur Total brut (blanc) — identique equity curve
    ctx.save();
    ctx.beginPath();ctx.arc(rx,ry,8,0,Math.PI*2);
    ctx.fillStyle=isLight()?'rgba(0,0,0,0.08)':'rgba(255,255,255,0.15)';ctx.fill();
    ctx.beginPath();ctx.arc(rx,ry,4,0,Math.PI*2);
    ctx.fillStyle=isLight()?'#1e1e3a':'#ffffff';ctx.fill();
    ctx.restore();

    // Dots colorés sur PEA brut et Crypto brut
    [[1,'#00e5a0'],[3,'#f7931a']].forEach(([di,col])=>{
      const dpts=ch.getDatasetMeta(di).data;
      if(!dpts||!dpts.length)return;
      const dpt=projBezierAt(dpts,ch._revealIdxF??hIdx);
      ctx.save();
      ctx.beginPath();ctx.arc(rx,dpt.y,7,0,Math.PI*2);
      ctx.fillStyle=col+'28';ctx.fill();
      ctx.beginPath();ctx.arc(rx,dpt.y,3.5,0,Math.PI*2);
      ctx.fillStyle=col;ctx.fill();
      ctx.restore();
    });
  }});
}

function projInitChart(){
  const canvas=document.getElementById('myChart');
  const _tip=document.getElementById('chartTooltip');
  _tip.style.position='absolute';

  const blank=PROJ_AGES.map(a=>({x:a,y:0}));
  projChart=new Chart(canvas.getContext('2d'),{
    type:'line',
    data:{datasets:[
      {label:'Total versé',data:[...blank],fill:'origin',backgroundColor:'rgba(100,149,237,0.07)',borderColor:'rgba(100,149,237,0.3)',borderWidth:1,borderDash:[4,4],pointRadius:0,tension:0.4,order:10},
      {label:'PEA brut',data:[...blank],borderColor:'#00e5a0',borderWidth:2.5,pointRadius:0,tension:0.4,fill:false,order:4},
      {label:'PEA net',data:[...blank],borderColor:'#00e5a0',borderWidth:1.5,borderDash:[6,4],pointRadius:0,tension:0.4,fill:false,order:5,hidden:true},
      {label:'Crypto brut',data:[...blank],borderColor:'#f7931a',borderWidth:2.5,pointRadius:0,tension:0.4,fill:false,order:2},
      {label:'Crypto net',data:[...blank],borderColor:'#f7931a',borderWidth:1.5,borderDash:[6,4],pointRadius:0,tension:0.4,fill:false,order:3,hidden:true},
      {label:'Total brut',data:[...blank],borderColor:'#ffffff',borderWidth:3,pointRadius:0,tension:0.4,fill:false,order:1},
      {label:'PEA versé',data:[...blank],borderWidth:0,pointRadius:0,hidden:true,order:99},
      {label:'Crypto versé',data:[...blank],borderWidth:0,pointRadius:0,hidden:true,order:99},
    ]},
    options:{
      responsive:true,maintainAspectRatio:false,animation:false,
      // events:[] coupe la gestion d'événements native de Chart.js : plus de points
      // de survol "collés à l'âge entier" (le 2e marqueur mal aligné) et moins de
      // calculs. Le crosshair custom utilise son propre listener mousemove.
      events:[],
      plugins:{legend:{display:false},tooltip:{enabled:false}},
      scales:{
        x:{type:'linear',min:PROJ_A0,max:PROJ_A1,grid:{color:'rgba(255,255,255,0.04)'},border:{display:false},ticks:{color:'#64748b',font:{family:'Inter',size:11},stepSize:5,callback:v=>v+' ans'}},
        y:{type:'logarithmic',grid:{color:'rgba(255,255,255,0.04)'},border:{display:false},ticks:{color:'#64748b',font:{family:'Inter',size:11},callback:function(v){
          const p=Math.pow(10,Math.floor(Math.log10(v)+1e-9)),m=Math.round(v/p);
          if(![1,2,5].includes(m)) return '';   // n'affiche que 1/2/5 × 10^n
          return v>=1e6?(v/1e6)+'M €':v>=1000?(v/1000)+'k €':v+' €';
        }}}
      }
    }
  });

  const LERP=1;   // snap instantané : crosshair collé à la souris, aucun délai de suivi

  function _projRevealTick(chart,pts){
    const tgt=chart._revealTarget;
    if(tgt===null){
      chart._revealIdx=null;chart._revealIdxF=null;
      chart._revealX=null;chart._revealY=null;
      chart._revealAnimId=null;
      chart.render();
      _tip.classList.add('hidden');
      return;
    }
    const cur=chart._revealIdxF??tgt;
    const nxt=cur+(tgt-cur)*LERP;
    chart._revealIdxF=nxt;
    chart._revealIdx=Math.round(nxt);
    const{x:_rx,y:_ry}=projBezierAt(pts,nxt);
    chart._revealX=_rx;chart._revealY=_ry;
    chart.render();

    // Tooltip contenu
    const ni=chart._revealIdx;
    const age=PROJ_AGES[ni];
    const ds=chart.data.datasets;
    const by={}; ds.forEach((d,di)=>{const pt=d.data[ni];by[di]=pt?(pt.y!==undefined?pt.y:pt):0;});
    const versé=by[0],peaBrut=by[1],peaNet=by[2],cryBrut=by[3],cryNet=by[4],totNet=by[5];
    const peaVersé=by[6]??0,cryVersé=by[7]??0;
    const peaTrm=Math.pow(1+projV.pea_ret/100,1/12)-1;
    const cryTrm=Math.pow(1+projV.cry_ret/100,1/12)-1;
    const peaRmB=peaBrut*peaTrm,cryRmB=cryBrut*cryTrm;
    const peaGR=peaBrut>0?Math.max(0,peaBrut-peaVersé)/peaBrut:0;
    const cryGR=cryBrut>0?Math.max(0,cryBrut-cryVersé)/cryBrut:0;
    const peaRm=peaRmB*(1-peaGR*PROJ_PS),cryRm=cryRmB*(1-cryGR*PROJ_PFU);
    const totRm=peaRm+cryRm;
    const phase=a=>a>=projV.pea_a?'(retraits)':'(versements)';
    const phaseC=a=>a>=projV.cry_a?'(retraits)':'(versements)';
    _tip.innerHTML=`
      <div class="tt-age">${age} ans</div>
      <div class="tt-sec">
        <div class="tt-sec-title" style="color:#00e5a0">PEA ${phase(age)}</div>
        <div class="tt-row"><span class="tt-lbl">Brut</span><span class="tt-val" style="color:#e2e8f0">${fmtE(peaBrut)}</span></div>
        <div class="tt-row"><span class="tt-lbl">Net (PS 17.2%)</span><span class="tt-val" style="color:#00e5a0">${fmtE(peaNet)}</span></div>
        <div class="tt-row"><span class="tt-lbl">Retrait mensuel net</span><span class="tt-val" style="color:#00e5a0">${fmtE(peaRm)}/m</span></div>
      </div>
      <div class="tt-divider"></div>
      <div class="tt-sec">
        <div class="tt-sec-title" style="color:#f7931a">Crypto ${phaseC(age)}</div>
        <div class="tt-row"><span class="tt-lbl">Brut</span><span class="tt-val" style="color:#e2e8f0">${fmtE(cryBrut)}</span></div>
        <div class="tt-row"><span class="tt-lbl">Net (PFU 30%)</span><span class="tt-val" style="color:#f7931a">${fmtE(cryNet)}</span></div>
        <div class="tt-row"><span class="tt-lbl">Retrait mensuel net</span><span class="tt-val" style="color:#f7931a">${fmtE(cryRm)}/m</span></div>
      </div>
      <div class="tt-divider"></div>
      <div class="tt-sec">
        <div class="tt-sec-title" style="color:#fff">Total</div>
        <div class="tt-row"><span class="tt-lbl">Versé cumulé</span><span class="tt-val" style="color:#64748b">${fmtE(versé)}</span></div>
        <div class="tt-row"><span class="tt-lbl">Brut total</span><span class="tt-val" style="color:#fff">${fmtE(peaBrut+cryBrut)}</span></div>
        <div class="tt-row"><span class="tt-lbl">Retrait mensuel total</span><span class="tt-val" style="color:#06b6d4">${fmtE(totRm)}/m</span></div>
      </div>`;

    // Position tooltip — exactement comme equity curve
    const rx=chart._revealX;
    const tw=_tip.offsetWidth;
    const rect=canvas.getBoundingClientRect();
    const left=rx+14+tw>rect.width?rx-tw-14:rx+14;
    _tip.style.left=left+'px';
    _tip.style.top=(chart.chartArea.top+10)+'px';
    _tip.classList.remove('hidden');

    if(Math.abs(nxt-tgt)>0.02){
      chart._revealAnimId=requestAnimationFrame(()=>_projRevealTick(chart,pts));
    } else {
      const snap=Math.round(tgt);
      chart._revealIdxF=snap;chart._revealIdx=snap;
      const snapPt=pts[Math.min(snap,pts.length-1)];
      chart._revealX=snapPt.x;chart._revealY=snapPt.y;
      chart._revealAnimId=null;
      chart.render();
    }
  }

  if(canvas._projMM)    canvas.removeEventListener('mousemove',canvas._projMM);
  if(canvas._projML)    canvas.removeEventListener('mouseleave',canvas._projML);
  if(canvas._projDocMM) document.removeEventListener('mousemove',canvas._projDocMM);

  canvas._projMM=e=>{
    const chart=projChart; if(!chart) return;
    const rect=canvas.getBoundingClientRect();
    const mx=(e.clientX-rect.left)*(chart.width/rect.width);
    const{chartArea}=chart;
    if(!chartArea||mx<chartArea.left||mx>chartArea.right) return;
    const pts=chart.getDatasetMeta(5).data;
    let ci=0,cd=Infinity;
    pts.forEach((p,i)=>{const d=Math.abs(p.x-mx);if(d<cd){cd=d;ci=i;}});
    chart._revealTarget=ci;
    if(!chart._revealAnimId)
      chart._revealAnimId=requestAnimationFrame(()=>_projRevealTick(chart,pts));
  };

  canvas._projML=()=>{
    const chart=projChart; if(!chart) return;
    chart._revealTarget=null;
    if(!chart._revealAnimId)
      chart._revealAnimId=requestAnimationFrame(()=>_projRevealTick(chart,chart.getDatasetMeta(5).data));
  };

  canvas._projDocMM=e=>{
    const r=canvas.getBoundingClientRect();
    if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom){
      if(projChart&&projChart._revealX!=null){projChart._revealTarget=null;_tip.classList.add('hidden');}
    }
  };

  canvas.addEventListener('mousemove',canvas._projMM);
  canvas.addEventListener('mouseleave',canvas._projML);
  document.addEventListener('mousemove',canvas._projDocMM);
}

function projSchedUpdate(){if(proj_raf)cancelAnimationFrame(proj_raf);proj_raf=requestAnimationFrame(projDoUpdate);}

function projDoUpdate(){
  const{pct,pea_k,pea_r,pea_a,pea_ret,cry_k,cry_r0,cry_r1,cry_a,cry_ret}=projV;
  const apArr=projBuildApArr();
  const peaArr=apArr.map(v=>Math.round(v*pct/100));
  const cryArr=apArr.map((v,i)=>v-peaArr[i]);
  const pc=projSimPEA(peaArr,pea_r,pea_a,pea_ret,pea_k);
  const cr=projSimCRY(cryArr,projCryRateArr(cry_r0,cry_r1),cry_a,cry_ret,cry_k);
  const totNet=pc.Bn.map((v,i)=>v+cr.Bn[i]);
  const totBrut=pc.B.map((v,i)=>v+cr.B[i]);
  const totVers=pc.Bv.map((v,i)=>v+cr.Bv[i]);
  const xy=arr=>arr.map((y,i)=>({x:PROJ_AGES[i],y}));
  projChart.data.datasets[0].data=xy(totVers);
  projChart.data.datasets[1].data=xy(pc.B);
  projChart.data.datasets[2].data=xy(pc.Bn);
  projChart.data.datasets[3].data=xy(cr.B);
  projChart.data.datasets[4].data=xy(cr.Bn);
  projChart.data.datasets[5].data=xy(totBrut);
  projChart.data.datasets[6].data=xy(pc.Bv);
  projChart.data.datasets[7].data=xy(cr.Bv);
  const vlines=[];
  for(const p of (projV.salaryPhases||[])){ const ag=Math.round(p.age||0); if(ag>PROJ_A0&&ag<PROJ_A0+PROJ_N) vlines.push({age:ag,color:'#a78bfa',label:`${Math.round((p.brut||0)/1000)}k€`}); }
  if(pc.mc!==null) vlines.push({age:PROJ_A0+pc.mc/12,color:'#4488ff',label:`PEA→CTO ${(PROJ_A0+pc.mc/12).toFixed(1)}ans`});
  vlines.push({age:pea_a,color:'#00e5a0',label:`Arrêt PEA ${pea_a}ans`});
  if(cryArr.some(v=>v>0)||cry_k>0) vlines.push({age:cry_a,color:'#f7931a',label:`Arrêt Crypto ${cry_a}ans`});
  projChart._vlines=vlines;
  // Axe log : plancher = point de donnée le plus bas (valeur positive mini),
  // arrondi à la graduation 1/2/5 × 10^n juste en dessous.
  let _minPos=Infinity;
  [totVers,pc.B,pc.Bn,cr.B,cr.Bn,totBrut].forEach(a=>a.forEach(v=>{ if(v>0&&v<_minPos)_minPos=v; }));
  if(isFinite(_minPos)){ const _p=Math.pow(10,Math.floor(Math.log10(_minPos)+1e-9)); projChart.options.scales.y.min=[5,2,1].map(m=>m*_p).find(x=>x<=_minPos)||_p; }
  else projChart.options.scales.y.min=100;
  projChart.update('none');
  const pcTrm=Math.pow(1+pea_ret/100,1/12)-1,crTrm=Math.pow(1+cry_ret/100,1/12)-1;
  const pcRmB=pc.B[PROJ_N]*pcTrm,crRmB=cr.B[PROJ_N]*crTrm;
  const pcGR=pc.B[PROJ_N]>0?Math.max(0,pc.B[PROJ_N]-pc.Bv[PROJ_N])/pc.B[PROJ_N]:0;
  const crGR=cr.B[PROJ_N]>0?Math.max(0,cr.B[PROJ_N]-cr.Bv[PROJ_N])/cr.B[PROJ_N]:0;
  const pcRm=pcRmB*(1-pcGR*PROJ_PS),crRm=crRmB*(1-crGR*PROJ_PFU);
  const mult=totVers[PROJ_N]>0?(totNet[PROJ_N]/totVers[PROJ_N]).toFixed(1):'—';
  const ctoTag=pc.mc?` · PEA→CTO à ${(PROJ_A0+pc.mc/12).toFixed(1)} ans`:'';
  document.getElementById('sTotN').textContent=fmtE(totNet[PROJ_N]);
  document.getElementById('sTotR').textContent=fmtE(pcRm+crRm)+'/m';
  document.getElementById('sPeaR').textContent=fmtE(pcRm)+'/m';
  document.getElementById('sCryR').textContent=fmtE(crRm)+'/m';
  document.getElementById('sPeaN').textContent=fmtE(pc.Bn[PROJ_N]);
  document.getElementById('sPeaB').textContent=fmtE(pc.B[PROJ_N]);
  document.getElementById('sPeaR2').textContent=fmtE(pcRm)+'/m';
  document.getElementById('sCryN').textContent=fmtE(cr.Bn[PROJ_N]);
  document.getElementById('sCryB').textContent=fmtE(cr.B[PROJ_N]);
  document.getElementById('sCryR2').textContent=fmtE(crRm)+'/m';
  document.getElementById('sMult').textContent='×'+mult;
  document.getElementById('sTotV').textContent=fmtE(totVers[PROJ_N]);
  document.getElementById('sPV').textContent=fmtE(totNet[PROJ_N]-totVers[PROJ_N]);
  document.getElementById('chartTitle').innerHTML=
    `<span style="color:#00e5a0">PEA</span> @ ${(+pea_r).toFixed(1)} %/an`+
    ` → net <b style="color:#00e5a0">${fmtE(pc.Bn[PROJ_N])}</b> (${fmtE(pcRm)}/m)${ctoTag}`+
    ` &nbsp;│&nbsp; `+
    `<span style="color:#f7931a">Crypto</span> @ ${cry_r0}→${cry_r1} %/an`+
    ` → net <b style="color:#f7931a">${fmtE(cr.Bn[PROJ_N])}</b> (${fmtE(crRm)}/m)`+
    ` &nbsp;│&nbsp; <b>Total brut ${fmtE(totBrut[PROJ_N])}</b>`+
    ` &nbsp;│&nbsp; ×${mult} sur ${fmtE(totVers[PROJ_N])} versés`;
}

let projInited=false;
function projInit(){
  if(projInited)return;
  projInited=true;
  Object.keys(PROJ_CFG).forEach(k=>{
    const el=document.getElementById('sl_'+k); if(el) el.value=projV[k];
    const vl=document.getElementById('vl_'+k); if(vl) vl.textContent=PROJ_CFG[k].fmt(projV[k]);
    projSetTrack(k,projV[k]);
  });
  projRenderStatut();
  projRenderPhases();
  requestAnimationFrame(()=>{
    projInitChart();
    projDoUpdate();
  });
}

// ─── RÉÉQUILIBRAGE ETF ───────────────────────────────────
const LS_REBAL = 'nx_rebal';

function rbToggle() {
  const body = document.getElementById('rb_body');
  const btn  = document.getElementById('rb_toggle');
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  btn.textContent = collapsed ? '▲ Replier' : '▼ Déplier';
}

function onRbTargetChange() {
  const t1 = Math.min(99, Math.max(1, parseFloat(document.getElementById('rb_target1').value) || 0));
  const t2el = document.getElementById('rb_target2_disp');
  if (t2el) t2el.textContent = (100 - t1).toFixed(0) + ' %';
  calcRebalance();
}

function calcRebalance() {
  const get = id => document.getElementById(id);
  const rb = {
    invest:     parseFloat(get('rb_invest')?.value)     || 0,
    etf1_name:  get('rb_etf1_name')?.value  || 'SP500',
    etf1_units: parseFloat(get('rb_etf1_units')?.value) || 0,
    etf1_price: parseFloat(get('rb_etf1_price')?.value) || 0,
    etf2_name:  get('rb_etf2_name')?.value  || 'NS100',
    etf2_units: parseFloat(get('rb_etf2_units')?.value) || 0,
    etf2_price: parseFloat(get('rb_etf2_price')?.value) || 0,
    target1:    parseFloat(get('rb_target1')?.value)    || 80,
  };
  try { localStorage.setItem(LS_REBAL, JSON.stringify(rb)); } catch(e) {}

  const target2 = 100 - rb.target1;
  const val1 = rb.etf1_units * rb.etf1_price;
  const val2 = rb.etf2_units * rb.etf2_price;

  const v1El = get('rb_etf1_val'), v2El = get('rb_etf2_val');
  if (v1El) v1El.textContent = rb.etf1_price > 0 ? fmtEur(val1) + ' en portefeuille' : '—';
  if (v2El) v2El.textContent = rb.etf2_price > 0 ? fmtEur(val2) + ' en portefeuille' : '—';

  const res = get('rb_result'); if (!res) return;
  if (!rb.invest || !rb.etf1_price || !rb.etf2_price) {
    res.innerHTML = `<div style="text-align:center;padding:14px;font-size:12px;color:var(--text2);">Renseigne les prix des ETF et le montant à investir.</div>`;
    return;
  }

  // Passe 1 : trouve l'écart minimal atteignable
  const maxN1 = Math.min(Math.floor(rb.invest / rb.etf1_price), 500);
  let minDev = Infinity;
  for (let n1 = 0; n1 <= maxN1; n1++) {
    const budget2 = rb.invest - n1 * rb.etf1_price;
    if (budget2 < 0) break;
    const n2  = Math.floor(budget2 / rb.etf2_price);
    const nv1 = val1 + n1 * rb.etf1_price;
    const nv2 = val2 + n2 * rb.etf2_price;
    const nt  = nv1 + nv2;
    const dev = nt > 0 ? Math.abs(nv1 / nt * 100 - rb.target1) : 0;
    if (dev < minDev) minDev = dev;
  }
  // Passe 2 : parmi les solutions à ≤ 0.5% du meilleur écart, maximise le montant investi
  const TOL = 0.5;
  let bestUnits1 = 0, bestUnits2 = 0, bestSpent = -1, bestDev = Infinity;
  for (let n1 = 0; n1 <= maxN1; n1++) {
    const budget2 = rb.invest - n1 * rb.etf1_price;
    if (budget2 < 0) break;
    const n2  = Math.floor(budget2 / rb.etf2_price);
    const sp  = n1 * rb.etf1_price + n2 * rb.etf2_price;
    const nv1 = val1 + n1 * rb.etf1_price;
    const nv2 = val2 + n2 * rb.etf2_price;
    const nt  = nv1 + nv2;
    const dev = nt > 0 ? Math.abs(nv1 / nt * 100 - rb.target1) : 0;
    if (dev <= minDev + TOL && sp > bestSpent) {
      bestSpent = sp; bestDev = dev; bestUnits1 = n1; bestUnits2 = n2;
    }
  }
  const units1 = bestUnits1;
  const units2 = bestUnits2;
  const cost1  = units1 * rb.etf1_price;
  const cost2  = units2 * rb.etf2_price;
  const spent  = bestSpent;
  const left   = rb.invest - spent;

  const newVal1 = val1 + cost1, newVal2 = val2 + cost2;
  const newTot  = newVal1 + newVal2;
  const newPct1 = newTot > 0 ? newVal1 / newTot * 100 : rb.target1;
  const newPct2 = newTot > 0 ? newVal2 / newTot * 100 : target2;

  const col1 = '#818cf8', col2 = '#06b6d4';
  const fmtDev = d => `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
  const devCol  = d => Math.abs(d) < 1 ? 'var(--green)' : Math.abs(d) < 3 ? 'var(--yellow)' : 'var(--red)';

  res.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
      ${[
        { col: col1, name: rb.etf1_name, units: units1, cost: cost1, price: rb.etf1_price },
        { col: col2, name: rb.etf2_name, units: units2, cost: cost2, price: rb.etf2_price },
      ].map(e => `
        <div style="background:${e.col === col1 ? 'rgba(129,140,248,0.07)' : 'rgba(6,182,212,0.07)'};border:1px solid ${e.col === col1 ? 'rgba(129,140,248,0.22)' : 'rgba(6,182,212,0.22)'};border-radius:12px;padding:14px;">
          <div style="font-size:10px;font-weight:700;letter-spacing:1px;color:${e.col};margin-bottom:8px;text-transform:uppercase;">${e.name}</div>
          <div style="font-size:26px;font-weight:800;line-height:1;">${e.units}<span style="font-size:12px;font-weight:500;color:var(--text2);margin-left:5px;">part${e.units > 1 ? 's' : ''}</span></div>
          <div style="font-size:13px;color:var(--text3);margin-top:3px;">${fmtEur(e.cost)}</div>
          ${e.units === 0 && rb.invest < e.price ? `<div style="font-size:10px;color:var(--yellow);margin-top:6px;">⚠ Budget insuffisant pour 1 part (${fmtEur(e.price)})</div>` : ''}
        </div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:11px;color:var(--text2);">Investi</span>
        <span style="font-size:13px;font-weight:700;">${fmtEur(spent)}</span>
      </div>
      <div style="background:rgba(16,185,129,0.07);border:1px solid rgba(16,185,129,0.2);border-radius:10px;padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:11px;color:var(--green);">Reste</span>
        <span style="font-size:13px;font-weight:700;color:var(--green);">${fmtEur(left)}</span>
      </div>
    </div>
    <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:11px;padding:14px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text2);margin-bottom:12px;">Répartition après achat</div>
      ${[
        { col: col1, name: rb.etf1_name, pct: newPct1, target: rb.target1 },
        { col: col2, name: rb.etf2_name, pct: newPct2, target: target2 },
      ].map(e => {
        const dev = e.pct - e.target;
        return `<div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <span style="font-size:11px;font-weight:600;color:${e.col};">${e.name}</span>
            <span style="font-size:11px;">
              <span style="font-weight:700;color:${e.col};">${e.pct.toFixed(1)}%</span>
              <span style="color:var(--text2);"> · cible ${e.target}%</span>
              <span style="color:${devCol(dev)};font-size:10px;font-weight:600;margin-left:4px;">(${fmtDev(dev)})</span>
            </span>
          </div>
          <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;position:relative;">
            <div style="position:absolute;top:0;height:100%;left:0;width:${e.target}%;border-right:2px dashed rgba(255,255,255,0.15);"></div>
            <div style="height:100%;width:${Math.min(e.pct,100).toFixed(1)}%;background:${e.col};border-radius:3px;transition:width .35s;"></div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

function initRebalance() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_REBAL) || '{}');
    const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    set('rb_invest',      s.invest);
    set('rb_etf1_name',   s.etf1_name);
    set('rb_etf1_units',  s.etf1_units !== 0 ? s.etf1_units : undefined);
    set('rb_etf1_price',  s.etf1_price !== 0 ? s.etf1_price : undefined);
    set('rb_etf2_name',   s.etf2_name);
    set('rb_etf2_units',  s.etf2_units !== 0 ? s.etf2_units : undefined);
    set('rb_etf2_price',  s.etf2_price !== 0 ? s.etf2_price : undefined);
    set('rb_target1',     s.target1   != null ? s.target1   : 80);
  } catch(e) {}
  onRbTargetChange();
}

// ─── INIT ────────────────────────────────────────────────
load();
const _dateEl = document.getElementById('f_date');
if (_dateEl) _dateEl.value = new Date().toISOString().slice(0,10);
const savedTab = localStorage.getItem(LS_TAB) || 'dashboard';
switchTab(savedTab);
updateHeader();
// Sync au chargement + poll toutes les 60s pour détecter les nouvelles dépenses Telegram
syncBotBudget();
setInterval(function() { syncBotBudget(0); }, 60000);

// Pont postMessage : répond aux demandes de données budget depuis le hub
window.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'budget_data_request') return;
  var budgetKeys = [
    'nx_budget','nx_cats','nx_comptes','nx_tombstone','nx_last_cat',
    'nexus_ops','nexus_prices','nexus_snaps',
    'nx_proj_v1','nx_rebal',
    'nx_theme',
  ];
  var budget = {};
  budgetKeys.forEach(function(k) {
    var v = localStorage.getItem(k);
    if (v !== null) { try { budget[k] = JSON.parse(v); } catch(ex) { budget[k] = v; } }
  });
  e.source.postMessage({ type: 'budget_data_for_hub', budget: budget }, '*');
});

// ── Constellation (hub mode uniquement) ─────────────────
(function(){
  if (!document.documentElement.classList.contains('in-hub')) return;
  const canvas = document.getElementById('hub-constellation-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H;
  // devicePixelRatio : rend à la résolution physique de l'écran (net sur HiDPI)
  function _fit() {
    // Ne dimensionne que le backing store ×dpr ; l'affichage reste géré par
    // le CSS (width/height:100%). Fixer une taille inline en px décalait le
    // canvas sur écran ultrawide.
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  _fit();

  const mouse = { x: -9999, y: -9999, active: false };

  // ── Grille réactive au survol (portage vanilla de "ProximityHover", un
  // composant React/Canvas fourni par l'utilisateur) : chaque cellule d'une
  // grille de carrés arrondis grossit selon sa proximité au curseur, avec un
  // lissage exponentiel (lerp) pour un mouvement fluide plutôt qu'un saut net.
  const GRID_MIN_SIZE = 1, GRID_MAX_SIZE = 30, GRID_GAP = 0, GRID_INFLUENCE = 140;
  const GRID_STROKE_WIDTH = 1.5;
  const GRID_BG = '#050816', GRID_PARTICLE = 'rgba(255,255,255,0.35)'; // #050816 = même fond que la constellation de l'onglet trading
  let sizes = new Float32Array(0);

  function _lerp(a, b, t) { return a + (b - a) * t; }
  function _clamp01to(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  function _roundedSquarePath(cx, cy, s) {
    const half = s / 2;
    const r = Math.min(half, s * 0.28);
    const x = cx - half, y = cy - half;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + s, y, x + s, y + s, r);
    ctx.arcTo(x + s, y + s, x, y + s, r);
    ctx.arcTo(x, y + s, x, y, r);
    ctx.arcTo(x, y, x + s, y, r);
    ctx.closePath();
  }

  function drawGrid() {
    const cell = Math.max(1, GRID_MAX_SIZE + GRID_GAP);
    const cols = Math.max(1, Math.floor(W / cell));
    const rows = Math.max(1, Math.floor(H / cell));
    const offX = (W - cols * cell) / 2 + cell / 2;
    const offY = (H - rows * cell) / 2 + cell / 2;
    const count = cols * rows;
    if (sizes.length !== count) sizes = new Float32Array(count).fill(GRID_MIN_SIZE);

    ctx.fillStyle = GRID_BG;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = GRID_PARTICLE;
    ctx.lineWidth = GRID_STROKE_WIDTH;
    ctx.lineJoin = 'round';

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        const cx = offX + col * cell, cy = offY + row * cell;
        let infl = 0;
        if (mouse.active) {
          const dx = mouse.x - cx, dy = mouse.y - cy;
          const dist = Math.sqrt(dx*dx + dy*dy);
          infl = _clamp01to(1 - dist / GRID_INFLUENCE);
        }
        const target = _lerp(GRID_MIN_SIZE, GRID_MAX_SIZE, infl);
        const cur = _lerp(sizes[idx] || GRID_MIN_SIZE, target, 0.2);
        sizes[idx] = cur;
        if (cur <= 0.2) continue;
        ctx.beginPath();
        _roundedSquarePath(cx, cy, cur);
        ctx.stroke();
      }
    }
  }

  let rafId = null, _running = false;
  function animate() {
    if (!_running) return;
    drawGrid();
    requestAnimationFrame(animate);
  }

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
  });
  window.addEventListener('mouseleave', () => { mouse.active = false; });
  let _rt;
  window.addEventListener('resize', () => {
    clearTimeout(_rt);
    _rt = setTimeout(() => {
      _fit();
      sizes = new Float32Array(0); // force le recalcul de la grille à la prochaine frame
    }, 150);
  });

  // Pause quand l'onglet navigateur est en arrière-plan, ou quand le budget
  // n'est pas l'app affichée dans le hub (son iframe est cachée).
  function _start() { if (_running) return; _running = true; rafId = requestAnimationFrame(animate); }
  function _stop()  { _running = false; if (rafId) cancelAnimationFrame(rafId); rafId = null; }
  let _tabOK = !document.hidden, _appOK = true, _focusOK = true;
  function _sync() { (_tabOK && _appOK && _focusOK) ? _start() : _stop(); }
  document.addEventListener('visibilitychange', () => { _tabOK = !document.hidden; _sync(); });
  window.addEventListener('message', e => {
    if (e.data && e.data.type === 'app_visible') { _appOK = !!e.data.visible; _sync(); }
    // Le focus DOM de cette iframe n'est pas fiable (changer d'onglet via le
    // hub ne le donne à aucune iframe) : c'est le hub, seul niveau capable de
    // détecter fiablement un clic vers une autre application/écran, qui le
    // diffuse ici.
    if (e.data && e.data.type === 'window_focus') { _focusOK = !!e.data.focused; _sync(); }
  });
  if (window.parent !== window) window.parent.postMessage({ type: 'request_app_visible' }, '*');
  _sync();
})();
