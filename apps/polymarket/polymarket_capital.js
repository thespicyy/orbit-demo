const LS_KEY = 'polymarket_capital_history'; // [{date:'YYYY-MM-DD', capital: number}, ...]
let _chart = null;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]').sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) { return []; }
}

function saveEntry(date, capital) {
  const h = loadHistory().filter(e => e.date !== date);
  h.push({ date, capital });
  h.sort((a, b) => a.date.localeCompare(b.date));
  localStorage.setItem(LS_KEY, JSON.stringify(h));
  render();
}

function fmtMoney(v) {
  return v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
}
function fmtPct(v) {
  if (v === null || v === undefined || isNaN(v)) return '–';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + ' %';
}

function withVariations(history) {
  return history.map((e, i) => {
    const prev = i > 0 ? history[i - 1] : null;
    const variation = prev ? ((e.capital / prev.capital - 1) * 100) : null;
    return { ...e, variation };
  });
}

function handleSave() {
  const dateEl = document.getElementById('entryDate');
  const capEl = document.getElementById('entryCapital');
  const date = dateEl.value;
  const capital = parseFloat(capEl.value);
  if (!date || isNaN(capital)) { alert('Renseigne une date et un montant valides.'); return; }
  saveEntry(date, capital);
  capEl.value = '';
}

function editEntry(date) {
  const entry = loadHistory().find(e => e.date === date);
  if (!entry) return;
  document.getElementById('entryDate').value = entry.date;
  document.getElementById('entryCapital').value = entry.capital;
  document.getElementById('entryCapital').focus();
}

function deleteEntry(date) {
  if (!confirm('Supprimer l\'entrée du ' + new Date(date + 'T00:00:00').toLocaleDateString('fr-FR') + ' ?')) return;
  const h = loadHistory().filter(e => e.date !== date);
  localStorage.setItem(LS_KEY, JSON.stringify(h));
  render();
}

function render() {
  const history = withVariations(loadHistory());
  const tbody = document.getElementById('historyBody');
  const chartWrap = document.getElementById('chartWrap');
  const statsRow = document.getElementById('statsRow');

  if (history.length === 0) {
    statsRow.innerHTML = '<div class="empty-hint" style="grid-column:1/-1">Aucune donnée — enregistre le capital du jour ci-dessus.</div>';
    chartWrap.innerHTML = '<div class="empty-hint">Ajoute au moins deux jours de données pour afficher le graphique.</div>';
    tbody.innerHTML = '';
    return;
  }

  const last = history[history.length - 1];
  const first = history[0];
  const totalVar = (last.capital / first.capital - 1) * 100;

  statsRow.innerHTML = `
    <div class="stat-box"><div class="lbl">Capital actuel</div><div class="val">${fmtMoney(last.capital)}</div></div>
    <div class="stat-box"><div class="lbl">Variation dernier jour</div><div class="val ${last.variation >= 0 ? 'pos' : 'neg'}">${fmtPct(last.variation)}</div></div>
    <div class="stat-box"><div class="lbl">Variation depuis le début</div><div class="val ${totalVar >= 0 ? 'pos' : 'neg'}">${fmtPct(totalVar)}</div></div>
  `;

  tbody.innerHTML = history.slice().reverse().slice(0, 20).map(e => `
    <tr>
      <td>${new Date(e.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}</td>
      <td>${fmtMoney(e.capital)}</td>
      <td class="${e.variation === null ? '' : (e.variation >= 0 ? 'pos' : 'neg')}">${fmtPct(e.variation)}</td>
      <td class="row-actions"><button class="icon-btn tiny" onclick="editEntry('${e.date}')" title="Modifier" aria-label="Modifier">✏</button><button class="icon-btn tiny danger" onclick="deleteEntry('${e.date}')" title="Supprimer" aria-label="Supprimer">🗑</button></td>
    </tr>
  `).join('');

  if (history.length < 2) {
    chartWrap.innerHTML = '<div class="empty-hint">Ajoute au moins deux jours de données pour afficher le graphique.</div>';
    return;
  }
  if (!document.getElementById('capitalChart')) {
    chartWrap.innerHTML = '<canvas id="capitalChart"></canvas>';
  }
  const ctx = document.getElementById('capitalChart').getContext('2d');
  if (_chart) _chart.destroy();
  const labels = history.map(e => new Date(e.date + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
  _chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'line', label: 'Capital', data: history.map(e => e.capital),
          borderColor: '#00e5a0', backgroundColor: 'rgba(0,229,160,0.08)', fill: true,
          tension: 0.25, pointRadius: 3, pointBackgroundColor: '#00e5a0', yAxisID: 'y',
        },
        {
          type: 'bar', label: 'Variation %', data: history.map(e => e.variation || 0),
          backgroundColor: history.map(e => (e.variation || 0) >= 0 ? 'rgba(0,229,160,0.55)' : 'rgba(255,79,94,0.55)'),
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: {
        y: { position: 'left', ticks: { color: '#8890b0', callback: v => v.toLocaleString('fr-FR') + ' $' }, grid: { color: '#1e2330' } },
        y1: { position: 'right', ticks: { color: '#8890b0', callback: v => v.toFixed(1) + '%' }, grid: { display: false } },
        x: { ticks: { color: '#8890b0' }, grid: { color: '#1e2330' } },
      },
    },
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('entryDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('saveBtn').addEventListener('click', handleSave);
  const onEnter = (e) => { if (e.key === 'Enter') handleSave(); };
  document.getElementById('entryDate').addEventListener('keydown', onEnter);
  document.getElementById('entryCapital').addEventListener('keydown', onEnter);
  render();
});

document.addEventListener('keydown', function(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'r' || e.key === 'R') {
    if (window.parent !== window) window.parent.postMessage({ type: 'toggle_app' }, '*');
  }
  if (e.key === 'p' || e.key === 'P') {
    if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'polymarket' }, '*');
  }
  if (e.key === 'b' || e.key === 'B') {
    if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'budget' }, '*');
  }
  if (e.key === 't' || e.key === 'T') {
    if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'trading' }, '*');
  }
  if (e.key === 'l' || e.key === 'L') {
    if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'tdl' }, '*');
  }
});

window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'open_settings') openBgSettingsModal();
});

/* ── Réglages du fond animé (Chromatic Waves) ── */
const BG_FIELDS = [
  { key: 'frequency', id: 'set-frequency', type: 'range' },
  { key: 'speed', id: 'set-speed', type: 'range' },
  { key: 'cellSize', id: 'set-cellSize', type: 'range' },
  { key: 'gamma', id: 'set-gamma', type: 'range' },
  { key: 'paletteBias', id: 'set-paletteBias', type: 'range' },
  { key: 'color1', id: 'set-color1', type: 'color' },
  { key: 'alpha1', id: 'set-alpha1', type: 'range' },
  { key: 'color2', id: 'set-color2', type: 'color' },
  { key: 'alpha2', id: 'set-alpha2', type: 'range' },
  { key: 'color3', id: 'set-color3', type: 'color' },
  { key: 'alpha3', id: 'set-alpha3', type: 'range' },
];

function populateBgSettingsForm() {
  if (!window.ChromaticWaves) return;
  const s = window.ChromaticWaves.getSettings();
  BG_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    el.value = s[f.key];
    if (f.type === 'range') {
      const valEl = document.getElementById(f.id + '-val');
      if (valEl) valEl.textContent = s[f.key];
    }
  });
}

function bindBgSettingsInputs() {
  BG_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (!window.ChromaticWaves) return;
      const v = f.type === 'range' ? Number(el.value) : el.value;
      window.ChromaticWaves.setSettings({ [f.key]: v });
      if (f.type === 'range') {
        const valEl = document.getElementById(f.id + '-val');
        if (valEl) valEl.textContent = v;
      }
    });
  });
}

function resetBgSettings() {
  if (!window.ChromaticWaves) return;
  window.ChromaticWaves.resetSettings();
  populateBgSettingsForm();
}

function openBgSettingsModal() {
  populateBgSettingsForm();
  document.getElementById('settings-modal-overlay').classList.add('open');
}

function closeBgSettingsModal() {
  document.getElementById('settings-modal-overlay').classList.remove('open');
}

document.addEventListener('DOMContentLoaded', bindBgSettingsInputs);
