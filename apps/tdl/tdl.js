/* ══════════════════════════ Utils ══════════════════════════ */
function pad(n){ return n < 10 ? '0'+n : ''+n; }
function todayStr(){ var d = new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function nowHM(){ var d = new Date(); return pad(d.getHours())+':'+pad(d.getMinutes()); }
function uid(prefix){ return prefix+'_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, function(ch){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}
function hexToRgba(hex, alpha){
  if(!hex || hex[0] !== '#'){ hex = '#7c3aed'; }
  var h = hex.replace('#','');
  if(h.length === 3){ h = h.split('').map(function(c){ return c+c; }).join(''); }
  var bigint = parseInt(h, 16);
  var r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}
function addDays(dateStr, n){
  var parts = dateStr.split('-').map(Number);
  var dt = new Date(parts[0], parts[1]-1, parts[2]);
  dt.setDate(dt.getDate()+n);
  return dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());
}
function daysBetween(dateStr, fromStr){
  var a = dateStr.split('-').map(Number), b = fromStr.split('-').map(Number);
  var da = new Date(a[0], a[1]-1, a[2]), db = new Date(b[0], b[1]-1, b[2]);
  return Math.round((da - db) / 86400000);
}
var MONTHS_FR = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function fmtDateHuman(dateStr){
  if(!dateStr) return '';
  var parts = dateStr.split('-').map(Number);
  return parts[2]+' '+MONTHS_FR[parts[1]-1];
}
function fmtDaysRemaining(dateStr){
  if(!dateStr) return '';
  var today = todayStr();
  if(dateStr === today) return "Aujourd'hui";
  if(dateStr === addDays(today,1)) return 'Demain';
  if(dateStr === addDays(today,-1)) return 'Hier';
  var diff = daysBetween(dateStr, today);
  if(diff > 0) return 'Dans '+diff+' jours';
  return 'Il y a '+Math.abs(diff)+' jours';
}
function sameLocalDay(epochMs, dayStr){
  var d = new Date(epochMs);
  return (d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())) === dayStr;
}
function emptyState(msg){ return '<div class="empty-state">'+escapeHtml(msg)+'</div>'; }

function icon(name){
  var icons = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    repeat: '<svg class="ic-repeat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>',
    clock: '<svg class="ic-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>'
  };
  return icons[name] || '';
}

/* ══════════════════════════ State ══════════════════════════ */
var STORAGE_KEY = 'tdl_state';

function defaultState(){
  return {
    version: 1,
    settings: {
      lastTab: 'tasks',
      sleepHours: 8
    },
    tasks: [],
    categories: [],
    dayLayouts: [
      { id: 'layout_default', name: 'Routine', days: [0,1,2,3,4,5,6], blocks: [] }
    ],
    timeRoutines: [
      { id:'rt_sleep', emoji:'😴', name:'Sommeil', type:'fixed', isSleep:true,  startTime:'23:00', durationMin:480, weekdays:[0,1,2,3,4,5,6] },
      { id:'rt_work',  emoji:'💼', name:'Travail', type:'fixed', isSleep:false, startTime:'08:00', durationMin:600, weekdays:[1,2,3,4,5] },
      { id:'rt_meal',  emoji:'🍽️', name:'Repas',   type:'fixed', isSleep:false, startTime:'12:30', durationMin:90,  weekdays:[0,1,2,3,4,5,6] },
      { id:'rt_sport', emoji:'🏋️', name:'Sport',   type:'flexible', isSleep:false, startTime:null, durationMin:90,  weekdays:[1,3,5] },
      { id:'rt_read',  emoji:'📚', name:'Lecture', type:'flexible', isSleep:false, startTime:null, durationMin:30,  weekdays:[0,1,2,3,4,5,6] }
    ],
    timeDone: {},   // { 'YYYY-MM-DD': { routineId|extraId: realMin|null } }  clé présente = fait
    timeSkip: {},   // { 'YYYY-MM-DD': [routineId, …] }  routines sautées ce jour
    timeExtra: {}   // { 'YYYY-MM-DD': [{id,emoji,name,durationMin,type,startTime}, …] }  activités ponctuelles
  };
}

var state;

function loadState(){
  var d = defaultState();
  try{
    var raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return d;
    var p = JSON.parse(raw);
    return {
      version: 1,
      settings: {
        lastTab: (p.settings && p.settings.lastTab) || d.settings.lastTab,
        sleepHours: (p.settings && p.settings.sleepHours != null) ? p.settings.sleepHours : d.settings.sleepHours
      },
      tasks: Array.isArray(p.tasks) ? p.tasks : [],
      categories: Array.isArray(p.categories) ? p.categories : [],
      dayLayouts: (Array.isArray(p.dayLayouts) && p.dayLayouts.length)
        ? p.dayLayouts
        : (Array.isArray(p.schedule) ? [{ id:'layout_default', name:'Routine', days:[0,1,2,3,4,5,6], blocks:p.schedule }] : d.dayLayouts),
      timeRoutines: Array.isArray(p.timeRoutines) ? p.timeRoutines : d.timeRoutines,
      timeDone: (p.timeDone && typeof p.timeDone === 'object') ? p.timeDone : {},
      timeSkip: (p.timeSkip && typeof p.timeSkip === 'object') ? p.timeSkip : {},
      timeExtra: (p.timeExtra && typeof p.timeExtra === 'object') ? p.timeExtra : {}
    };
  }catch(e){
    logError('loadState', e);
    return d;
  }
}

function persist(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch(e){ logError('persist', e); }
}

/* ── Sauvegarde : export / import du localStorage ── */
function exportTdlData(){
  try{
    var raw = localStorage.getItem(STORAGE_KEY) || JSON.stringify(state);
    var blob = new Blob([raw], { type:'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'tdl-sauvegarde-'+todayStr()+'.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  }catch(e){ logError('exportTdlData', e); alert('Export impossible : '+(e.message||e)); }
}
function importTdlData(input){
  var file = input.files && input.files[0];
  input.value = '';                          // permet de ré-importer le même fichier plus tard
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var parsed = JSON.parse(reader.result);
      if(!parsed || typeof parsed !== 'object' || !('tasks' in parsed || 'timeRoutines' in parsed))
        throw new Error('Ce fichier ne ressemble pas à une sauvegarde TDL.');
      if(!confirm('Importer cette sauvegarde ?\nCela REMPLACE toutes les données de cet appareil (tâches, planning, routines, historique).')) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      alert('Import réussi ✅ — l\'app va se recharger.');
      location.reload();                     // recharge propre : loadState() re-normalise + migrations
    }catch(e){ logError('importTdlData', e); alert('Import impossible : '+(e.message||e)); }
  };
  reader.onerror = function(){ alert('Lecture du fichier impossible.'); };
  reader.readAsText(file);
}

function logError(context, err){
  try{ console.error('[TDL error] '+context+':', err); }catch(e){}
}

window.addEventListener('error', function(e){ logError('window.onerror', e.error || e.message); });
window.addEventListener('beforeunload', persist);

function switchTab(name){
  state.settings.lastTab = name;
  persist();
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab === name); });
  document.querySelectorAll('.view').forEach(function(v){ v.classList.toggle('active', v.id === 'view-'+name); });
  if(name === 'temps') renderTemps();
  // Synchro hub : reflète l'onglet interne dans la barre du hub (même pattern
  // que trading_dashboard.js/budget.js — cf. hub.html hubSwitchTab/switchBudgetTab).
  if (window.parent !== window) window.parent.postMessage({ type: 'tab_changed', tab: name }, '*');
}

/* -- Reglages (modal : uniquement Sauvegarde) -- */
function openSettingsModal(){ document.getElementById('settings-modal-overlay').classList.add('open'); }
function closeSettingsModal(){ document.getElementById('settings-modal-overlay').classList.remove('open'); }

/* ══════════════════════════ Delete confirm (shared: tasks + schedule + layouts) ══════════════════════════ */
var pendingDelete = { type:null, id:null, timer:null };
function clearPendingDelete(){
  if(pendingDelete.timer) clearTimeout(pendingDelete.timer);
  pendingDelete = { type:null, id:null, timer:null };
}
function rerenderForDeleteType(type){
  if(type === 'task') renderTasks();
  else if(type === 'schedule') renderSchedule();
  else if(type === 'layout') renderLayoutsManageList();
}
function requestDelete(type, id){
  clearPendingDelete();
  pendingDelete.type = type;
  pendingDelete.id = id;
  pendingDelete.timer = setTimeout(function(){
    clearPendingDelete();
    rerenderForDeleteType(type);
  }, 4000);
  rerenderForDeleteType(type);
}
function cancelDelete(){
  var type = pendingDelete.type;
  clearPendingDelete();
  rerenderForDeleteType(type);
}
function confirmDelete(type, id){
  if(type === 'task'){
    state.tasks = state.tasks.filter(function(t){ return t.id !== id; });
  } else if(type === 'schedule'){
    var layout = getActiveLayout();
    if(layout) layout.blocks = layout.blocks.filter(function(b){ return b.id !== id; });
  } else if(type === 'layout'){
    if(state.dayLayouts.length > 1){
      state.dayLayouts = state.dayLayouts.filter(function(l){ return l.id !== id; });
      if(viewingLayoutId === id){ viewingLayoutId = null; }
      var fallback = state.dayLayouts[0];
      for(var d = 0; d <= 6; d++){
        var owned = state.dayLayouts.some(function(l){ return l.days.indexOf(d) !== -1; });
        if(!owned) fallback.days.push(d);
      }
    }
  }
  clearPendingDelete();
  persist();
  rerenderForDeleteType(type);
  if(type === 'layout'){ renderSchedule(); }
}

/* ══════════════════════════ Categories ══════════════════════════ */
var CATEGORY_PALETTE = ['#7c3aed','#9333ea','#a78bfa','#6d28d9','#c4b5fd','#8b5cf6','#5b21b6','#a855f7'];
function getOrCreateCategory(name){
  var found = state.categories.find(function(c){ return c.name.toLowerCase() === name.toLowerCase(); });
  if(found) return found;
  var c = { name: name, color: CATEGORY_PALETTE[state.categories.length % CATEGORY_PALETTE.length] };
  state.categories.push(c);
  return c;
}
function refreshCategoryUI(){
  var dl = document.getElementById('category-list');
  dl.innerHTML = state.categories.map(function(c){ return '<option value="'+escapeHtml(c.name)+'"></option>'; }).join('');
  updateCategoryFilterOptions();
}
function updateCategoryFilterOptions(){
  var sel = document.getElementById('filter-category');
  var current = sel.value || 'all';
  var opts = ['<option value="all">Toutes catégories</option>'].concat(
    state.categories.map(function(c){ return '<option value="'+escapeHtml(c.name)+'">'+escapeHtml(c.name)+'</option>'; })
  );
  sel.innerHTML = opts.join('');
  var exists = Array.prototype.some.call(sel.options, function(o){ return o.value === current; });
  sel.value = exists ? current : 'all';
}

/* ══════════════════════════ Tasks ══════════════════════════ */
var PRIORITY_META = {
  low: { label:'Basse', color:'#ddd6fe' },
  medium: { label:'Moyenne', color:'#c4b5fd' },
  high: { label:'Haute', color:'#a78bfa' },
  urgent: { label:'Urgente', color:'#8b5cf6' }
};
var uiState = { taskFilter:'all', taskSearch:'', categoryFilter:'all', priorityFilter:'all', taskSort:'due' };
var editingTaskId = null;
var modalSubtasks = [];

function isOverdue(t){ return t.status === 'open' && !!t.dueDate && t.dueDate < todayStr(); }

function computeVisibleTasks(){
  var today = todayStr();
  var list = state.tasks.slice();
  var f = uiState.taskFilter;
  if(f === 'today') list = list.filter(function(t){ return t.status === 'open' && (t.dueDate === today || (t.recurrenceDays > 0 && !t.dueDate)); });
  else if(f === 'upcoming') list = list.filter(function(t){ return t.status === 'open' && t.dueDate && t.dueDate > today; });
  else if(f === 'overdue') list = list.filter(isOverdue);
  else if(f === 'completed') list = list.filter(function(t){ return t.status === 'done'; });
  else list = list.filter(function(t){ return t.status === 'open'; }); /* 'all' = all active tasks; done ones live under "Terminé" */

  var q = uiState.taskSearch.trim().toLowerCase();
  if(q) list = list.filter(function(t){
    return ((t.title||'')+' '+(t.notes||'')+' '+(t.category||'')).toLowerCase().indexOf(q) !== -1;
  });
  if(uiState.categoryFilter !== 'all') list = list.filter(function(t){ return t.category === uiState.categoryFilter; });
  if(uiState.priorityFilter !== 'all') list = list.filter(function(t){ return t.priority === uiState.priorityFilter; });

  var prOrder = { urgent:0, high:1, medium:2, low:3 };
  var sortMode = uiState.taskSort;
  list.sort(function(a,b){
    if(sortMode === 'due'){
      var av = a.dueDate || '9999-99-99', bv = b.dueDate || '9999-99-99';
      if(av !== bv) return av < bv ? -1 : 1;
      var at = a.dueTime || '99:99', bt = b.dueTime || '99:99';
      return at < bt ? -1 : (at > bt ? 1 : 0);
    }
    if(sortMode === 'priority') return prOrder[a.priority] - prOrder[b.priority];
    if(sortMode === 'created') return b.createdAt - a.createdAt;
    return (a.order||0) - (b.order||0);
  });
  return list;
}

function renderKpiStrip(){
  var today = todayStr();
  var total = state.tasks.length;
  var doneToday = state.tasks.filter(function(t){ return t.status === 'done' && t.completedAt && sameLocalDay(t.completedAt, today); }).length;
  var overdue = state.tasks.filter(isOverdue).length;
  var upcoming = state.tasks.filter(function(t){ return t.status === 'open' && t.dueDate && t.dueDate > today; }).length;
  return (
    '<div class="kpi-tile"><div class="kpi-lbl">Total</div><div class="kpi-val">'+total+'</div></div>'+
    '<div class="kpi-tile green"><div class="kpi-lbl">Fait aujourd\'hui</div><div class="kpi-val">'+doneToday+'</div></div>'+
    '<div class="kpi-tile red"><div class="kpi-lbl">En retard</div><div class="kpi-val">'+overdue+'</div></div>'+
    '<div class="kpi-tile teal"><div class="kpi-lbl">À venir</div><div class="kpi-val">'+upcoming+'</div></div>'
  );
}

function renderTaskRow(task){
  var overdue = isOverdue(task);
  var isToday = task.dueDate === todayStr();
  var isPendingDelete = pendingDelete.type === 'task' && pendingDelete.id === task.id;
  var pm = PRIORITY_META[task.priority] || PRIORITY_META.medium;
  var subtasks = task.subtasks || [];
  var subDone = subtasks.filter(function(s){ return s.done; }).length;

  var dueBadge = '';
  if(task.dueDate){
    var dueClass = overdue ? 'overdue' : (isToday ? 'today' : '');
    dueBadge = '<span class="badge due '+dueClass+'">'+icon('clock')+' '+escapeHtml(fmtDateHuman(task.dueDate))+' · '+escapeHtml(fmtDaysRemaining(task.dueDate))+(task.dueTime ? ' · '+escapeHtml(task.dueTime) : '')+'</span>';
  }
  var catBadge = task.category ? '<span class="badge" style="background:'+hexToRgba(task.categoryColor,0.16)+';color:'+task.categoryColor+';border-color:'+hexToRgba(task.categoryColor,0.4)+'">'+escapeHtml(task.category)+'</span>' : '';
  var priBadge = '<span class="badge" style="background:'+hexToRgba(pm.color,0.16)+';color:'+pm.color+';border-color:'+hexToRgba(pm.color,0.4)+'">'+pm.label+'</span>';
  var subBadge = subtasks.length ? '<span class="badge sub">'+subDone+'/'+subtasks.length+'</span>' : '';

  var actions;
  if(isPendingDelete){
    actions = '<button class="mini danger" onclick="confirmDelete(\'task\',\''+task.id+'\')">Confirmer</button>'+
              '<button class="mini" onclick="cancelDelete()">Annuler</button>';
  } else {
    actions = '<button class="icon-btn tiny" title="Modifier" aria-label="Modifier la tâche" onclick="openTaskModal(\''+task.id+'\')">'+icon('pencil')+'</button>'+
              '<button class="icon-btn tiny danger" title="Supprimer" aria-label="Supprimer la tâche" onclick="requestDelete(\'task\',\''+task.id+'\')">'+icon('trash')+'</button>';
  }

  return (
    '<div class="row '+(task.status==='done'?'done':'')+'" data-id="'+task.id+'">'+
      '<button class="chk '+(task.status==='done'?'checked':'')+'" aria-label="Marquer comme '+(task.status==='done'?'à faire':'terminée')+'" onclick="toggleTaskDone(\''+task.id+'\')">'+(task.status==='done'?icon('check'):'')+'</button>'+
      '<div class="row-main">'+
        '<div class="row-title">'+escapeHtml(task.title)+(task.recurrenceDays > 0 ? '<span title="Se répète tous les '+task.recurrenceDays+' jours (depuis la validation)">'+icon('repeat')+'</span>' : '')+'</div>'+
        '<div class="row-badges">'+catBadge+priBadge+dueBadge+subBadge+'</div>'+
      '</div>'+
      '<div class="row-actions">'+actions+'</div>'+
    '</div>'
  );
}

function renderTasks(){
  var list = computeVisibleTasks();
  var container = document.getElementById('task-list');
  container.innerHTML = list.length ? list.map(renderTaskRow).join('') : emptyState('Aucune tâche ici. Ajoutez-en une avec le champ ci-dessus.');
  document.getElementById('kpi-strip').innerHTML = renderKpiStrip();
  updateTaskNotifications();
}

var BASE_TITLE = 'TDL — Tâches & Planning';
function updateTaskNotifications(){
  var today = todayStr();
  var count = state.tasks.filter(function(t){
    return t.status === 'open' && (t.dueDate === today || (t.recurrenceDays > 0 && !t.dueDate) || isOverdue(t));
  }).length;
  var badge = document.getElementById('tab-badge-tasks');
  if(badge){
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  }
  document.title = count > 0 ? '('+count+') '+BASE_TITLE : BASE_TITLE;
}

function quickAddTask(title){
  state.tasks.push({
    id: uid('t'), title: title, notes:'', category:'', categoryColor:'', priority:'medium',
    dueDate:null, dueTime:null, subtasks:[], status:'open', recurrenceDays:0,
    createdAt: Date.now(), completedAt:null, order: state.tasks.length
  });
  persist();
  renderTasks();
}

function toggleTaskDone(id){
  var t = state.tasks.find(function(x){ return x.id === id; });
  if(!t) return;
  if(t.status === 'open'){
    t.status = 'done';
    t.completedAt = Date.now();
    if(t.recurrenceDays && t.recurrenceDays > 0){
      var nextDue = addDays(todayStr(), t.recurrenceDays);
      state.tasks.push({
        id: uid('t'), title:t.title, notes:t.notes, category:t.category, categoryColor:t.categoryColor,
        priority:t.priority, dueDate: nextDue, dueTime:t.dueTime,
        subtasks: (t.subtasks||[]).map(function(s){ return { id: uid('s'), text:s.text, done:false }; }),
        status:'open', recurrenceDays:t.recurrenceDays,
        createdAt: Date.now(), completedAt:null, order: state.tasks.length
      });
    }
  } else {
    t.status = 'open';
    t.completedAt = null;
  }
  persist();
  renderTasks();
}

function renderModalSubtasks(){
  var c = document.getElementById('subtask-list');
  if(modalSubtasks.length === 0){ c.innerHTML = '<div class="subtask-empty">Aucune sous-tâche</div>'; return; }
  c.innerHTML = modalSubtasks.map(function(s, idx){
    return '<div class="subtask-row">'+
      '<input type="checkbox" '+(s.done?'checked':'')+' onchange="toggleModalSubtask('+idx+')">'+
      '<span class="'+(s.done?'done':'')+'">'+escapeHtml(s.text)+'</span>'+
      '<button type="button" class="icon-btn tiny" aria-label="Retirer la sous-tâche" onclick="removeModalSubtask('+idx+')">'+icon('x')+'</button>'+
    '</div>';
  }).join('');
}
function addModalSubtask(){
  var inp = document.getElementById('subtask-input');
  var v = inp.value.trim();
  if(!v) return;
  modalSubtasks.push({ id: uid('s'), text:v, done:false });
  inp.value = '';
  renderModalSubtasks();
}
function toggleModalSubtask(idx){ modalSubtasks[idx].done = !modalSubtasks[idx].done; renderModalSubtasks(); }
function removeModalSubtask(idx){ modalSubtasks.splice(idx,1); renderModalSubtasks(); }

function openTaskModal(id){
  editingTaskId = id;
  document.getElementById('task-modal-error').textContent = '';
  if(id){
    var t = state.tasks.find(function(x){ return x.id === id; });
    if(!t) return;
    document.getElementById('task-modal-title').textContent = 'Modifier la tâche';
    document.getElementById('task-title').value = t.title || '';
    document.getElementById('task-notes').value = t.notes || '';
    document.getElementById('task-category').value = t.category || '';
    document.getElementById('task-priority').value = t.priority || 'medium';
    document.getElementById('task-due-date').value = t.dueDate || '';
    document.getElementById('task-due-time').value = t.dueTime || '';
    document.getElementById('task-recurrence-on').checked = !!(t.recurrenceDays > 0);
    document.getElementById('task-recurrence-days').value = t.recurrenceDays > 0 ? t.recurrenceDays : 1;
    document.getElementById('task-recurrence-days-field').style.display = (t.recurrenceDays > 0) ? '' : 'none';
    modalSubtasks = t.subtasks ? JSON.parse(JSON.stringify(t.subtasks)) : [];
  } else {
    document.getElementById('task-modal-title').textContent = 'Nouvelle tâche';
    document.getElementById('task-title').value = '';
    document.getElementById('task-notes').value = '';
    document.getElementById('task-category').value = '';
    document.getElementById('task-priority').value = 'medium';
    document.getElementById('task-due-date').value = '';
    document.getElementById('task-due-time').value = '';
    document.getElementById('task-recurrence-on').checked = false;
    document.getElementById('task-recurrence-days').value = 1;
    document.getElementById('task-recurrence-days-field').style.display = 'none';
    modalSubtasks = [];
  }
  renderModalSubtasks();
  document.getElementById('task-modal-overlay').classList.add('open');
  document.getElementById('task-title').focus();
}
function closeTaskModal(){
  document.getElementById('task-modal-overlay').classList.remove('open');
  editingTaskId = null;
}
function saveTaskFromModal(){
  var title = document.getElementById('task-title').value.trim();
  var errEl = document.getElementById('task-modal-error');
  if(!title){
    errEl.textContent = 'Le titre est obligatoire.';
    document.getElementById('task-title').focus();
    return;
  }
  errEl.textContent = '';
  var catName = document.getElementById('task-category').value.trim();
  var cat = catName ? getOrCreateCategory(catName) : { name:'', color:'' };
  var dueDate = document.getElementById('task-due-date').value || null;
  var dueTime = document.getElementById('task-due-time').value || null;
  var priority = document.getElementById('task-priority').value;
  var recurrenceOn = document.getElementById('task-recurrence-on').checked;
  var recurrenceDays = recurrenceOn ? Math.max(1, Math.min(365, parseInt(document.getElementById('task-recurrence-days').value, 10) || 1)) : 0;
  if(recurrenceOn && !dueDate) dueDate = todayStr(); /* a repeating task with no explicit date is due today by default */
  var notes = document.getElementById('task-notes').value;

  if(editingTaskId){
    var t = state.tasks.find(function(x){ return x.id === editingTaskId; });
    Object.assign(t, { title:title, notes:notes, category:cat.name, categoryColor:cat.color, priority:priority, dueDate:dueDate, dueTime:dueTime, recurrenceDays:recurrenceDays, subtasks: modalSubtasks });
  } else {
    state.tasks.push({
      id: uid('t'), title:title, notes:notes, category:cat.name, categoryColor:cat.color, priority:priority,
      dueDate:dueDate, dueTime:dueTime, subtasks: modalSubtasks, status:'open', recurrenceDays:recurrenceDays,
      createdAt: Date.now(), completedAt:null, order: state.tasks.length
    });
  }
  persist();
  closeTaskModal();
  refreshCategoryUI();
  renderTasks();
}

/* ══════════════════════════ Day layouts (dispositions) ══════════════════════════ */
var DAY_LABELS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
var DAY_LABELS_FULL = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
var MONTHS_FR_FULL = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
function fmtTodayFull(){
  var d = new Date();
  return DAY_LABELS_FULL[d.getDay()]+' '+d.getDate()+' '+MONTHS_FR_FULL[d.getMonth()];
}
var DAY_DISPLAY_ORDER = [1,2,3,4,5,6,0];
var viewingLayoutId = null; /* session-only override; null = always show today's layout */

function getTodayLayout(){
  var todayDow = new Date().getDay();
  return state.dayLayouts.find(function(l){ return l.days.indexOf(todayDow) !== -1; }) || null;
}
function getActiveLayout(){
  if(viewingLayoutId){
    var found = state.dayLayouts.find(function(l){ return l.id === viewingLayoutId; });
    if(found) return found;
  }
  return getTodayLayout();
}
function viewLayout(id){
  viewingLayoutId = id;
  closeLayoutsModal();
  renderSchedule();
}
function returnToToday(){
  viewingLayoutId = null;
  renderSchedule();
}
function openLayoutsModal(){
  renderLayoutsManageList();
  document.getElementById('layouts-modal-overlay').classList.add('open');
}
function closeLayoutsModal(){
  document.getElementById('layouts-modal-overlay').classList.remove('open');
}
function handleLayoutAddClick(){
  var input = document.getElementById('layout-add-name');
  var btn = document.getElementById('layout-add-btn');
  if(input.style.display === 'none'){
    input.style.display = '';
    input.value = '';
    input.focus();
    btn.textContent = 'Confirmer';
  } else {
    var name = input.value.trim();
    if(!name){ input.focus(); return; }
    var layout = { id: uid('lay'), name: name, days: [], blocks: [] };
    state.dayLayouts.push(layout);
    persist();
    input.style.display = 'none';
    input.value = '';
    btn.textContent = '+ Nouvelle disposition';
    renderLayoutsManageList();
  }
}
function toggleLayoutDay(layoutId, dayIndex){
  var owner = state.dayLayouts.find(function(l){ return l.days.indexOf(dayIndex) !== -1; });
  if(owner){ owner.days = owner.days.filter(function(d){ return d !== dayIndex; }); }
  if(!owner || owner.id !== layoutId){
    var target = state.dayLayouts.find(function(l){ return l.id === layoutId; });
    target.days.push(dayIndex);
    target.days.sort();
  }
  persist();
  renderLayoutsManageList();
}
function renderLayoutsManageList(){
  var container = document.getElementById('layouts-manage-list');
  if(!container) return;
  var todayDow = new Date().getDay();
  container.innerHTML = state.dayLayouts.map(function(l){
    var isPendingDelete = pendingDelete.type === 'layout' && pendingDelete.id === l.id;
    if(isPendingDelete){
      return '<div class="layout-row pending">'+
        '<span>Supprimer « '+escapeHtml(l.name)+' » ?</span>'+
        '<button type="button" class="mini danger" onclick="confirmDelete(\'layout\',\''+l.id+'\')">Oui</button>'+
        '<button type="button" class="mini" onclick="cancelDelete()">Non</button>'+
      '</div>';
    }
    var isToday = l.days.indexOf(todayDow) !== -1;
    var dayButtons = DAY_DISPLAY_ORDER.map(function(d){
      var owner = state.dayLayouts.find(function(x){ return x.days.indexOf(d) !== -1; });
      var isMine = owner && owner.id === l.id;
      var taken = owner && !isMine;
      var cls = 'layout-day-btn' + (isMine ? ' assigned' : '') + (taken ? ' taken' : '');
      var title = taken ? 'Actuellement dans « '+escapeHtml(owner.name)+' » — cliquer pour la déplacer ici' : '';
      return '<button type="button" class="'+cls+'" title="'+title+'" onclick="toggleLayoutDay(\''+l.id+'\','+d+')">'+DAY_LABELS[d]+'</button>';
    }).join('');
    var del = state.dayLayouts.length > 1
      ? '<button type="button" class="icon-btn tiny" title="Supprimer" aria-label="Supprimer cette disposition" onclick="requestDelete(\'layout\',\''+l.id+'\')">'+icon('trash')+'</button>'
      : '';
    return '<div class="layout-row">'+
      '<div class="layout-row-head">'+
        '<div><strong>'+escapeHtml(l.name)+'</strong>'+(isToday?'<span class="layout-today-tag">aujourd\'hui</span>':'')+'</div>'+
        '<div class="layout-row-actions">'+
          '<button type="button" class="mini" onclick="viewLayout(\''+l.id+'\')">Voir / modifier les créneaux</button>'+
          del+
        '</div>'+
      '</div>'+
      '<div class="layout-days">'+dayButtons+'</div>'+
    '</div>';
  }).join('');
}

/* ══════════════════════════ Schedule ══════════════════════════ */
var editingBlockId = null;

var AGENDA_HOUR_PX = 34.65; /* +10% then +5% vs original 30 — baseline rate for gaps and 30-60min blocks */
var AGENDA_LABEL_STEP = 2;
var AGENDA_START_HOUR = 7; /* grid window starts at 07:00 */
var AGENDA_SPAN_HOURS = 18; /* ...and covers 18h, i.e. until 01:00 the next day */
var AGENDA_RATE_NORMAL = AGENDA_HOUR_PX / 60;
var AGENDA_RATE_SHORT = AGENDA_RATE_NORMAL * 1.7;  /* <=30min blocks: more room per minute */
var AGENDA_RATE_LONG = AGENDA_RATE_NORMAL * 0.8;   /* >=60min blocks: less room per minute */
function agendaRateForDuration(duration){
  if(duration <= 30) return AGENDA_RATE_SHORT;
  if(duration >= 60) return AGENDA_RATE_LONG;
  return AGENDA_RATE_NORMAL;
}
/* Builds a non-linear time→pixel mapping: minutes covered by short blocks get more
   vertical room, minutes covered by long blocks get less. Where blocks overlap
   (side-by-side columns), the most generous applicable rate wins so short blocks
   always stay legible. Returns { timeToY(minute), totalHeight }. */
function buildAgendaTimeScale(blocks, spanMin){
  var cuts = {};
  cuts[0] = true; cuts[spanMin] = true;
  var ranges = blocks.map(function(b){
    var s = Math.max(0, b.winStart);
    var e = Math.min(spanMin, b.winEnd);
    return { start:s, end:e, rate: agendaRateForDuration(b.winEnd - b.winStart) };
  }).filter(function(r){ return r.end > r.start; });
  ranges.forEach(function(r){ cuts[r.start] = true; cuts[r.end] = true; });
  var points = Object.keys(cuts).map(Number).sort(function(a,b){ return a-b; });

  var segs = [];
  for(var i = 0; i < points.length - 1; i++){
    var segStart = points[i], segEnd = points[i+1];
    var mid = (segStart + segEnd) / 2;
    var covering = [];
    ranges.forEach(function(r){
      if(mid >= r.start && mid < r.end) covering.push(r.rate);
    });
    var rate = covering.length ? Math.max.apply(null, covering) : AGENDA_RATE_NORMAL;
    segs.push({ start:segStart, end:segEnd, rate:rate });
  }
  var cumY = [0];
  for(var i = 0; i < segs.length; i++){
    cumY.push(cumY[i] + segs[i].rate * (segs[i].end - segs[i].start));
  }
  function timeToY(t){
    t = Math.max(0, Math.min(spanMin, t));
    for(var i = 0; i < segs.length; i++){
      if(t <= segs[i].end) return cumY[i] + segs[i].rate * (t - segs[i].start);
    }
    return cumY[cumY.length - 1];
  }
  return { timeToY: timeToY, totalHeight: cumY[cumY.length - 1] };
}
function timeToMinutes(t){
  var p = t.split(':');
  return (+p[0]) * 60 + (+p[1]);
}
function timeToMinutesEnd(t){
  return t === '00:00' ? 1440 : timeToMinutes(t); /* treat 00:00 as end-of-day/midnight when used as a block's end time */
}
function toWindowMinutes(rawMin){
  var startWindow = AGENDA_START_HOUR * 60;
  var adjusted = rawMin < startWindow ? rawMin + 1440 : rawMin;
  return adjusted - startWindow;
}
function computeAgendaLayout(blocks){
  var sorted = blocks.slice().sort(function(a,b){ return a.startMin - b.startMin || a.endMin - b.endMin; });
  var clusters = [];
  var current = [];
  var clusterEnd = -1;
  sorted.forEach(function(b){
    if(current.length && b.startMin >= clusterEnd){
      clusters.push(current);
      current = [];
      clusterEnd = -1;
    }
    current.push(b);
    clusterEnd = Math.max(clusterEnd, b.endMin);
  });
  if(current.length) clusters.push(current);

  var layout = {};
  clusters.forEach(function(cluster){
    var columns = [];
    cluster.forEach(function(b){
      var placed = false;
      for(var c = 0; c < columns.length; c++){
        if(columns[c] <= b.startMin){ columns[c] = b.endMin; layout[b.id] = { col:c }; placed = true; break; }
      }
      if(!placed){ columns.push(b.endMin); layout[b.id] = { col: columns.length - 1 }; }
    });
    var totalCols = columns.length;
    cluster.forEach(function(b){ layout[b.id].cols = totalCols; });
  });
  return layout;
}
function formatDuration(mins){
  var h = Math.floor(mins / 60), m = mins % 60;
  if(h && m) return h+'h'+pad(m);
  if(h) return h+'h';
  return m+'min';
}
function renderAgendaBlock(b, layout, timeScale){
  var isPendingDelete = pendingDelete.type === 'schedule' && pendingDelete.id === b.id;
  var duration = b.endMin - b.startMin;
  var winStart = toWindowMinutes(b.startMin);
  var yTop = timeScale.timeToY(winStart);
  var yBottom = timeScale.timeToY(winStart + duration);
  var rawSlot = yBottom - yTop;
  var gap = Math.min(4, rawSlot * 0.25);
  var height = Math.max(2, rawSlot - gap);
  var top = yTop + gap / 2;
  var widthPct = 100 / layout.cols;
  var leftPct = layout.col * widthPct;
  var color = b.color || '#7c3aed';
  var compact = height < 32;
  var minimal = duration <= 15; /* 15min-or-shorter slots keep the bare-minimum treatment */
  var durationLabel = formatDuration(duration);
  var lineFontSize = Math.max(6, Math.min(13, height * 0.55));

  var content;
  if(isPendingDelete){
    content = '<div class="agenda-block-confirm">'+
      '<button class="agenda-confirm-btn yes" onclick="event.stopPropagation();confirmDelete(\'schedule\',\''+b.id+'\')" title="Confirmer la suppression" aria-label="Confirmer la suppression">'+icon('check')+'</button>'+
      '<button class="agenda-confirm-btn no" onclick="event.stopPropagation();cancelDelete()" title="Annuler" aria-label="Annuler">'+icon('x')+'</button>'+
    '</div>';
  } else if(minimal){
    var minimalText = height < 20 ? escapeHtml(b.label) : escapeHtml(b.label)+' <span class="agenda-block-duration">'+durationLabel+'</span>';
    content = '<div class="agenda-block-oneline" style="font-size:'+lineFontSize+'px">'+minimalText+'</div>';
  } else {
    content = '<div class="agenda-block-row" style="font-size:'+lineFontSize+'px">'+
      '<span class="ab-name">'+escapeHtml(b.label)+'</span>'+
      '<span class="ab-time">'+escapeHtml(b.start)+'–'+escapeHtml(b.end)+'</span>'+
      '<span class="ab-leader"></span>'+
      '<span class="ab-duration">'+durationLabel+'</span>'+
    '</div>';
  }
  var delBtn = isPendingDelete ? '' :
    '<button type="button" class="agenda-block-del" title="Supprimer" aria-label="Supprimer le créneau" onclick="event.stopPropagation();requestDelete(\'schedule\',\''+b.id+'\')">'+icon('trash')+'</button>';

  var bg1 = hexToRgba(color, 0.38);
  var bg2 = hexToRgba(color, 0.16);
  var bd = hexToRgba(color, 0.6);
  var style = 'top:'+top+'px;height:'+height+'px;left:calc('+leftPct+'% + 2px);width:calc('+widthPct+'% - 4px);'+
    '--c:'+color+';--blk-bg1:'+bg1+';--blk-bg2:'+bg2+';--blk-bd:'+bd;

  return '<div class="agenda-block'+(compact?' compact':'')+(isPendingDelete?' pending-delete':'')+'" style="'+style+'" onclick="openScheduleModal(\''+b.id+'\')" data-tip-label="'+escapeHtml(b.label)+'" data-tip-time="'+escapeHtml(b.start)+'–'+escapeHtml(b.end)+'" data-tip-duration="'+escapeHtml(durationLabel)+'">'+
    '<div class="agenda-block-content">'+content+'</div>'+
    delBtn+
  '</div>';
}
function renderSchedule(){
  var container = document.getElementById('schedule-list');
  var subtitleEl = document.getElementById('schedule-subtitle');
  var dateBadgeEl = document.getElementById('today-date-badge');
  if(dateBadgeEl) dateBadgeEl.textContent = fmtTodayFull();
  var dayName = DAY_LABELS[new Date().getDay()];
  var todayLayout = getTodayLayout();
  var activeLayout = getActiveLayout();
  var viewingOther = viewingLayoutId && activeLayout && (!todayLayout || activeLayout.id !== todayLayout.id);

  if(subtitleEl){
    subtitleEl.textContent = todayLayout
      ? 'Aujourd\'hui ('+dayName+') : '+todayLayout.name
      : 'Aujourd\'hui ('+dayName+') : aucune disposition assignée';
  }

  var banner = viewingOther
    ? '<div class="agenda-banner">Vous consultez « '+escapeHtml(activeLayout.name)+' » <button type="button" class="mini" onclick="returnToToday()">Revenir à aujourd\'hui</button></div>'
    : '';

  if(!activeLayout){
    container.innerHTML = banner + '<div class="agenda-empty">Aucune disposition n\'est assignée à aujourd\'hui. <button type="button" class="mini" onclick="openLayoutsModal()">Ouvrir Dispositions</button></div>';
    return;
  }

  var spanMin = AGENDA_SPAN_HOURS * 60;
  var blocks = activeLayout.blocks.map(function(b){
    return Object.assign({}, b, { startMin: timeToMinutes(b.start), endMin: timeToMinutesEnd(b.end) });
  }).filter(function(b){
    var w = toWindowMinutes(b.startMin);
    return w >= 0 && w < spanMin;
  });

  var scaleInput = blocks.map(function(b){
    var winStart = toWindowMinutes(b.startMin);
    return { winStart: winStart, winEnd: winStart + (b.endMin - b.startMin) };
  });
  var timeScale = buildAgendaTimeScale(scaleInput, spanMin);

  var hourMarks = '';
  for(var h = 0; h < AGENDA_SPAN_HOURS; h++){
    var actualHour = (AGENDA_START_HOUR + h) % 24;
    var y = timeScale.timeToY(h * 60);
    hourMarks += '<div class="agenda-hour-line" style="top:'+y+'px"></div>';
    if(h % AGENDA_LABEL_STEP === 0){
      hourMarks += '<div class="agenda-hour-label" style="top:'+y+'px">'+pad(actualHour)+':00</div>';
    }
  }

  var blocksHtml = '';
  var emptyMsg = '';
  if(blocks.length === 0){
    emptyMsg = '<div class="agenda-empty">Aucun créneau dans « '+escapeHtml(activeLayout.name)+' ». Ajoutez-en un avec le bouton "+ Créneau" !</div>';
  } else {
    var agendaLayout = computeAgendaLayout(blocks);
    blocksHtml = blocks.map(function(b){ return renderAgendaBlock(b, agendaLayout[b.id], timeScale); }).join('');
  }

  var now = new Date();
  var rawNowMin = now.getHours() * 60 + now.getMinutes();
  var winNowMin = toWindowMinutes(rawNowMin);
  var nowLine = (winNowMin >= 0 && winNowMin < spanMin)
    ? '<div class="agenda-now-line" style="top:'+timeScale.timeToY(winNowMin)+'px"><span class="agenda-now-dot"></span></div>'
    : '';

  container.innerHTML = banner +
    '<div class="agenda-grid" style="height:'+timeScale.totalHeight+'px">'+
      hourMarks+
      '<div class="agenda-lane">'+blocksHtml+nowLine+'</div>'+
    '</div>'+emptyMsg;
}

function renderSchedColorPicker(selected){
  var container = document.getElementById('sched-color-picker');
  container.innerHTML = CATEGORY_PALETTE.map(function(c){
    return '<button type="button" class="color-swatch'+(c===selected?' selected':'')+'" style="background:'+c+'" onclick="selectSchedColor(\''+c+'\')" aria-label="Choisir cette couleur"></button>';
  }).join('');
}
function selectSchedColor(c){
  document.getElementById('sched-color').value = c;
  renderSchedColorPicker(c);
}
function openScheduleModal(id){
  var layout = getActiveLayout();
  if(!layout) return;
  editingBlockId = id;
  document.getElementById('schedule-modal-error').textContent = '';
  if(id){
    var b = layout.blocks.find(function(x){ return x.id === id; });
    if(!b) return;
    document.getElementById('schedule-modal-title').textContent = 'Modifier le créneau';
    document.getElementById('sched-start').value = b.start;
    document.getElementById('sched-end').value = b.end;
    document.getElementById('sched-label').value = b.label;
    document.getElementById('sched-color').value = b.color || '#7c3aed';
    renderSchedColorPicker(b.color || '#7c3aed');
  } else {
    document.getElementById('schedule-modal-title').textContent = 'Nouveau créneau';
    document.getElementById('sched-start').value = '';
    document.getElementById('sched-end').value = '';
    document.getElementById('sched-label').value = '';
    document.getElementById('sched-color').value = '#7c3aed';
    renderSchedColorPicker('#7c3aed');
  }
  document.getElementById('schedule-modal-overlay').classList.add('open');
  document.getElementById('sched-start').focus();
}
function closeScheduleModal(){
  document.getElementById('schedule-modal-overlay').classList.remove('open');
  editingBlockId = null;
}
function saveScheduleBlockFromModal(){
  var start = document.getElementById('sched-start').value;
  var end = document.getElementById('sched-end').value;
  var label = document.getElementById('sched-label').value.trim();
  var color = document.getElementById('sched-color').value;
  var errEl = document.getElementById('schedule-modal-error');
  if(!start || !end){ errEl.textContent = 'Heure de début et de fin requises.'; return; }
  if(timeToMinutes(start) >= timeToMinutesEnd(end)){ errEl.textContent = "L'heure de fin doit être après l'heure de début."; return; }
  if(!label){ errEl.textContent = 'Le libellé est obligatoire.'; return; }
  errEl.textContent = '';
  var activeLayoutForSave = getActiveLayout();
  if(!activeLayoutForSave) return;
  var activeBlocks = activeLayoutForSave.blocks;
  if(editingBlockId){
    var b = activeBlocks.find(function(x){ return x.id === editingBlockId; });
    Object.assign(b, { start:start, end:end, label:label, color:color });
  } else {
    activeBlocks.push({ id: uid('b'), start:start, end:end, label:label, color:color, order: activeBlocks.length });
  }
  persist();
  closeScheduleModal();
  renderSchedule();
}

/* ══════════════════════════ Init ══════════════════════════ */
function initAgendaTooltip(){
  var tooltip = document.getElementById('agenda-tooltip');
  if(!tooltip) return;
  var hideTimer = null;
  document.addEventListener('mouseover', function(e){
    var block = e.target.closest('.agenda-block');
    if(!block) return;
    var label = block.getAttribute('data-tip-label');
    if(!label) return;
    var time = block.getAttribute('data-tip-time');
    var duration = block.getAttribute('data-tip-duration');
    clearTimeout(hideTimer);
    tooltip.innerHTML = '';
    var tag = document.createElement('span'); tag.className = 'tip-tag'; tag.textContent = 'Créneau';
    var title = document.createElement('div'); title.className = 'tip-title'; title.textContent = label;
    var meta = document.createElement('div'); meta.className = 'tip-time'; meta.textContent = time + ' · ' + duration;
    tooltip.appendChild(tag); tooltip.appendChild(title); tooltip.appendChild(meta);
    tooltip.classList.add('visible');
    requestAnimationFrame(function(){
      var rect = block.getBoundingClientRect();
      var tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
      var x = rect.left;
      var y = rect.top - th - 8;
      if(y < 8) y = rect.bottom + 8;
      if(x + tw > window.innerWidth - 12) x = window.innerWidth - tw - 12;
      if(x < 8) x = 8;
      tooltip.style.left = x + 'px';
      tooltip.style.top = y + 'px';
    });
  });
  document.addEventListener('mouseout', function(e){
    if(!e.target.closest('.agenda-block')) return;
    hideTimer = setTimeout(function(){ tooltip.classList.remove('visible'); }, 120);
  });
}
function bindGlobalEvents(){
  document.getElementById('quick-add-form').addEventListener('submit', function(e){
    e.preventDefault();
    var inp = document.getElementById('quick-add-input');
    var v = inp.value.trim();
    if(!v) return;
    quickAddTask(v);
    inp.value = '';
  });
  document.getElementById('filter-search').addEventListener('input', function(e){ uiState.taskSearch = e.target.value; renderTasks(); });
  document.getElementById('filter-category').addEventListener('change', function(e){ uiState.categoryFilter = e.target.value; renderTasks(); });
  document.getElementById('filter-priority').addEventListener('change', function(e){ uiState.priorityFilter = e.target.value; renderTasks(); });
  document.getElementById('filter-sort').addEventListener('change', function(e){ uiState.taskSort = e.target.value; renderTasks(); });
  document.querySelectorAll('.filter-pill').forEach(function(btn){
    btn.addEventListener('click', function(){
      uiState.taskFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-pill').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      renderTasks();
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(function(ov){
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.classList.remove('open'); });
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      document.querySelectorAll('.modal-overlay.open').forEach(function(ov){ ov.classList.remove('open'); });
      return;
    }
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if(typing || e.ctrlKey || e.metaKey || e.altKey) return;
    var anyModalOpen = document.querySelector('.modal-overlay.open');
    if(anyModalOpen) return;
    var k = e.key.toLowerCase();
    if(k === 'a'){ switchTab('schedule'); }
    else if(k === 'z'){ switchTab('tasks'); }
    else if(k === 'r'){ if (window.parent !== window) window.parent.postMessage({ type: 'toggle_app' }, '*'); }
    else if(k === 'p'){ if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'polymarket' }, '*'); }
    else if(k === 'b'){ if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'budget' }, '*'); }
    else if(k === 't'){ if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'trading' }, '*'); }
    else if(k === 'l'){ if (window.parent !== window) window.parent.postMessage({ type: 'switch_app', app: 'tdl' }, '*'); }
  });

  // Synchro hub : reçoit les changements d'onglet déclenchés depuis la barre du
  // hub, et la visibilité réelle de l'iframe (celle-ci reste "visible" au sens
  // document.hidden même quand un autre onglet du hub est affiché par-dessus —
  // cf. trading_dashboard.html/budget.js pour le même pattern).
  window.addEventListener('message', function(e){
    if(!e.data) return;
    if(e.data.type === 'switch_tab'){ switchTab(e.data.tab); return; }
    if(e.data.type === 'open_settings'){ openSettingsModal(); return; }
  });
}

/* ══════════════════════════ TEMPS — dashboard du temps libre (V1) ══════════════════════════ */
var TEMPS_SUB = 'today';            // 'today' | 'week' | 'routines'
var editingRoutineId = null;
var modalRoutineWeekdays = [];

function nowMinutes(){ var d = new Date(); return d.getHours()*60 + d.getMinutes(); }
function hhmmToMin(s){ if(!s) return null; var p = s.split(':'); return (+p[0])*60 + (+p[1]); }
function fmtHM(min){ min = Math.max(0, Math.round(min)); var h = Math.floor(min/60), m = min%60; return h>0 ? (h+'h'+(m>0 ? (m<10?'0'+m:''+m) : '')) : (m+'min'); }
function fmtHMsigned(min){ return (min<0?'−':'') + fmtHM(Math.abs(min)); }
function dateStrForDate(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }

function timeRoutinesForDay(dow){ return (state.timeRoutines||[]).filter(function(r){ return r.weekdays && r.weekdays.indexOf(dow) !== -1; }); }
function timeSleepForDay(dow){ return timeRoutinesForDay(dow).find(function(r){ return r.isSleep; }) || null; }
/* ── État par jour : fait (avec réel), sauté, ponctuel ── */
function timeDoneMap(dateStr){
  if(!state.timeDone) state.timeDone = {};
  var v = state.timeDone[dateStr];
  if(Array.isArray(v)){ var m = {}; v.forEach(function(id){ m[id] = null; }); state.timeDone[dateStr] = m; return m; } // migration ancien format (tableau d'ids)
  if(!v || typeof v !== 'object'){ v = {}; state.timeDone[dateStr] = v; }
  return v;
}
// Entrée « fait » normalisée : { n:occurrences faites, real:min|null } — rétrocompat (null / number)
function doneEntry(dateStr, id){
  var v = timeDoneMap(dateStr)[id];
  if(v === undefined) return null;
  if(v === null) return { n:1, real:null };
  if(typeof v === 'number') return { n:1, real:v };
  return v;
}
function progressOf(dateStr, id){ var e = doneEntry(dateStr, id); return e ? (e.n||0) : 0; }
function isRoutineDone(dateStr, id){ return progressOf(dateStr, id) >= 1; }                 // au moins une occurrence
function isFullyDone(dateStr, id, count){ return progressOf(dateStr, id) >= (count||1); }
function realMinFor(dateStr, id, plannedMin){ var e = doneEntry(dateStr, id); return (e && e.real != null) ? e.real : plannedMin; }
// Un clic = +1 occurrence ; au-delà de count on remet à 0 (annule tout)
function advanceRoutine(dateStr, id, count, plannedMin){
  var m = timeDoneMap(dateStr), e = doneEntry(dateStr, id);
  var n = (e ? (e.n||0) : 0) + 1;
  count = count || 1;
  var full;
  if(n > count){ delete m[id]; full = false; }
  else { m[id] = { n:n, real:(e ? e.real : null) }; unskipRoutine(dateStr, id, true); full = (n >= count); }
  // Récurrence par intervalle : reprogrammer à la validation complète (sinon redû aujourd'hui)
  var r = (state.timeRoutines||[]).find(function(x){ return x.id === id; });
  if(r && r.recur === 'interval'){ r.nextDue = full ? addDays(dateStr, Math.max(1, r.everyDays||1)) : dateStr; }
  persist(); renderTemps();
}
function setRealMin(dateStr, id, val){
  var m = timeDoneMap(dateStr), e = doneEntry(dateStr, id);
  if(!e) return;
  m[id] = { n:e.n||1, real:Math.max(0, parseInt(val, 10) || 0) };
  persist(); renderTemps();
}
function timeSkipList(dateStr){ if(!state.timeSkip) state.timeSkip = {}; return state.timeSkip[dateStr] || []; }
function isSkipped(dateStr, id){ return timeSkipList(dateStr).indexOf(id) !== -1; }
function skipRoutine(dateStr, id){
  if(!state.timeSkip) state.timeSkip = {};
  var a = (state.timeSkip[dateStr] || []).slice();
  if(a.indexOf(id) === -1) a.push(id);
  state.timeSkip[dateStr] = a;
  var m = timeDoneMap(dateStr); if(Object.prototype.hasOwnProperty.call(m, id)) delete m[id]; // sauté ⇒ plus « fait »
  persist(); renderTemps();
}
function unskipRoutine(dateStr, id, silent){
  if(!state.timeSkip) return;
  state.timeSkip[dateStr] = (state.timeSkip[dateStr] || []).filter(function(x){ return x !== id; });
  if(!silent){ persist(); renderTemps(); }
}
function timeExtraList(dateStr){ if(!state.timeExtra) state.timeExtra = {}; return state.timeExtra[dateStr] || []; }
function addExtra(dateStr, data){
  if(!state.timeExtra) state.timeExtra = {};
  var a = (state.timeExtra[dateStr] || []).slice();
  data.id = data.id || uid('ex');
  a.push(data);
  state.timeExtra[dateStr] = a;
  persist(); renderTemps();
}
function deleteExtra(dateStr, id){
  if(!state.timeExtra) return;
  state.timeExtra[dateStr] = (state.timeExtra[dateStr] || []).filter(function(e){ return e.id !== id; });
  var m = timeDoneMap(dateStr); if(Object.prototype.hasOwnProperty.call(m, id)) delete m[id];
  persist(); renderTemps();
}
// Reporter à demain en 1 clic : saute (ou retire) aujourd'hui + crée l'activité ponctuelle demain
function reportTomorrow(dateStr, id){
  var tmr = addDays(dateStr, 1), def = null;
  var r = (state.timeRoutines||[]).find(function(x){ return x.id === id; });
  if(r && r.recur === 'interval'){ skipRoutine(dateStr, id); return; } // se represente demain, en retard
  if(r && !r.isSleep){
    def = { emoji:r.emoji, name:r.name, durationMin:r.durationMin, type:r.type, startTime:r.startTime||null, count:Math.max(1, r.count||1) };
    skipRoutine(dateStr, id);
  } else {
    var ex = timeExtraList(dateStr).find(function(e){ return e.id === id; });
    if(!ex) return;
    def = { emoji:ex.emoji, name:ex.name, durationMin:ex.durationMin, type:ex.type||'flexible', startTime:ex.startTime||null, count:Math.max(1, ex.count||1) };
    deleteExtra(dateStr, id);
  }
  addExtra(tmr, def);
}

// Une routine à intervalle est « due » ce jour-là ? (uniquement pour aujourd'hui — dynamique)
function intervalRoutineActive(r, dateStr){
  if(dateStr !== todayStr()) return false;        // les routines à intervalle ne sont évaluées que pour aujourd'hui
  return !r.nextDue || dateStr >= r.nextDue;       // due ou en retard
}
// Items actionnables du jour = routines (hors sommeil) + ponctuels, avec drapeau « sauté »
function tempsItemsForDay(dateStr, dow){
  var items = [];
  (state.timeRoutines||[]).forEach(function(r){
    if(r.isSleep) return;
    var active = (r.recur === 'interval') ? intervalRoutineActive(r, dateStr) : (r.weekdays && r.weekdays.indexOf(dow) !== -1);
    if(!active) return;
    items.push({ id:r.id, emoji:r.emoji, name:r.name, durationMin:r.durationMin||0, type:r.type, startTime:r.startTime||null, count:Math.max(1, r.count||1), interval:(r.recur==='interval'), everyDays:r.everyDays||null, extra:false, skipped:isSkipped(dateStr, r.id) });
  });
  timeExtraList(dateStr).forEach(function(e){
    items.push({ id:e.id, emoji:e.emoji, name:e.name, durationMin:e.durationMin||0, type:e.type||'flexible', startTime:e.startTime||null, count:Math.max(1, e.count||1), interval:false, everyDays:null, extra:true, skipped:false });
  });
  return items;
}
// Minutes encore à faire pour un item (proportionnel aux occurrences restantes)
function itemRemainingMin(dateStr, it){
  var count = it.count || 1;
  var prog = Math.min(count, progressOf(dateStr, it.id));
  return it.durationMin * (count - prog) / count;
}

// Stats statiques d'un jour de semaine (template — vue Semaine)
function tempsDayStats(dow){
  var rs = timeRoutinesForDay(dow);
  var committed = rs.reduce(function(s, r){ return s + (r.durationMin||0); }, 0);
  var sleep = timeSleepForDay(dow);
  var sleepMin = sleep ? (sleep.durationMin||0) : 0;
  return { rs:rs, committed:committed, sleepMin:sleepMin, awake:1440-sleepMin, plannedFree:Math.max(0, 1440-committed), sleep:sleep };
}
// Stats du jour réel (tient compte des sautés et des ponctuels)
function tempsTodayStats(dateStr, dow){
  var items = tempsItemsForDay(dateStr, dow);
  var sleep = timeSleepForDay(dow);
  var sleepMin = sleep ? (sleep.durationMin||0) : 0;
  var committed = items.reduce(function(s, it){ return s + (it.skipped ? 0 : it.durationMin); }, 0);
  return { items:items, sleep:sleep, sleepMin:sleepMin, awake:1440-sleepMin, committed:committed, plannedFree:Math.max(0, 1440-sleepMin-committed) };
}
// Temps libre dynamique « maintenant » : temps jusqu'au coucher − ce qu'il reste à faire
function tempsFreeNow(dateStr, dow){
  var ts = tempsTodayStats(dateStr, dow);
  var now = nowMinutes();
  // Pas de coucher défini → simple « jusqu'à la fin de journée »
  if(!(ts.sleep && ts.sleep.startTime)){
    return Math.max(0, 1440 - now) - ts.items.reduce(function(s, it){
      if(it.skipped || isFullyDone(dateStr, it.id, it.count)) return s;
      if(it.startTime && (hhmmToMin(it.startTime) + it.durationMin) <= now) return s;
      return s + itemRemainingMin(dateStr, it);
    }, 0);
  }
  // Timeline « jour de veille » : réveil = coucher + durée de sommeil.
  // Si le coucher (ou l'heure actuelle) est après minuit, on le place +1 jour pour éviter le repli à minuit.
  var bed  = hhmmToMin(ts.sleep.startTime);
  var wake = (bed + (ts.sleep.durationMin || 0)) % 1440;
  var bedEff = (bed >= wake) ? bed : bed + 1440;
  var nowEff = (now >= wake) ? now : now + 1440;
  var untilBed = bedEff - nowEff;                 // négatif = heure du coucher dépassée (retard)
  var pastBed  = nowEff >= bedEff;
  var remaining = ts.items.reduce(function(s, it){
    if(it.skipped || isFullyDone(dateStr, it.id, it.count)) return s;
    if(it.startTime){
      var stEff = hhmmToMin(it.startTime); stEff = (stEff >= wake) ? stEff : stEff + 1440;
      if(stEff + it.durationMin <= nowEff) return s;   // déjà passée
      if(stEff >= bedEff) return s;                     // après le coucher (appartient à demain)
      return s + itemRemainingMin(dateStr, it);
    }
    if(pastBed) return s;                               // flexibles : plus rien à caser une fois couché
    return s + itemRemainingMin(dateStr, it);
  }, 0);
  return untilBed - remaining;
}
// Temps libre RÉEL d'une date (fait = réel, sauté = libéré, sinon = prévu) — sert aux stats & au bilan
function tempsRealFree(dateStr, dow){
  var ts = tempsTodayStats(dateStr, dow);
  var used = ts.items.reduce(function(s, it){
    if(it.skipped) return s;
    return s + (isRoutineDone(dateStr, it.id) ? realMinFor(dateStr, it.id, it.durationMin) : it.durationMin);
  }, 0);
  return ts.awake - used;
}

/* ── Minuteur d'activité (onglet Temps) ── */
var activeTimer = null;      // { id, durationSec, endTime(ms), paused, remainingSec }
var timerInterval = null;
function loadTimer(){
  try{
    var raw = localStorage.getItem('tdl_timer');
    if(!raw){ activeTimer = null; return; }
    activeTimer = JSON.parse(raw);
    if(activeTimer && !activeTimer.paused && activeTimer.endTime <= Date.now()){ activeTimer = null; localStorage.removeItem('tdl_timer'); } // expiré pendant l'absence
  }catch(e){ activeTimer = null; }
}
function saveTimer(){ try{ if(activeTimer) localStorage.setItem('tdl_timer', JSON.stringify(activeTimer)); else localStorage.removeItem('tdl_timer'); }catch(e){} }
function timerRemainingSec(){
  if(!activeTimer) return 0;
  if(activeTimer.paused) return activeTimer.remainingSec;
  return Math.max(0, Math.round((activeTimer.endTime - Date.now())/1000));
}
function fmtClock(sec){ sec = Math.max(0, sec); var m = Math.floor(sec/60), s = sec%60; return m+':'+(s<10?'0'+s:s); }
function ensureTimerTick(){ if(!timerInterval) timerInterval = setInterval(timerTick, 1000); }
function timerTick(){
  if(!activeTimer){ if(timerInterval){ clearInterval(timerInterval); timerInterval = null; } return; }
  if(activeTimer.paused) return;
  var rem = timerRemainingSec();
  var el = document.getElementById('timer-count'); if(el) el.textContent = fmtClock(rem);
  if(rem <= 0) onTimerComplete();
}
function startItemTimer(id, durationMin){
  var sec = Math.max(1, Math.round(durationMin*60));
  activeTimer = { id:id, durationSec:sec, endTime: Date.now()+sec*1000, paused:false, remainingSec:sec };
  saveTimer(); ensureTimerTick();
  try{ if('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }catch(e){}
  renderTemps();
}
function pauseTimer(){ if(!activeTimer || activeTimer.paused) return; activeTimer.remainingSec = timerRemainingSec(); activeTimer.paused = true; saveTimer(); renderTemps(); }
function resumeTimer(){ if(!activeTimer || !activeTimer.paused) return; activeTimer.endTime = Date.now()+activeTimer.remainingSec*1000; activeTimer.paused = false; saveTimer(); ensureTimerTick(); renderTemps(); }
function stopTimer(){ activeTimer = null; saveTimer(); if(timerInterval){ clearInterval(timerInterval); timerInterval = null; } renderTemps(); }
function onTimerComplete(){
  if(!activeTimer) return;
  var id = activeTimer.id;
  var d = new Date(), dateStr = dateStrForDate(d), dow = d.getDay();
  var it = tempsItemsForDay(dateStr, dow).find(function(x){ return x.id === id; });
  stopTimer();
  var nom = it ? it.name : 'Activité';
  try{ if('Notification' in window && Notification.permission === 'granted') new Notification('⏱ Temps écoulé', { body: nom+' — minuteur terminé' }); }catch(e){}
  if(it && confirm('⏱ Minuteur terminé pour « '+nom+' ».\nLa marquer comme faite ?')){
    advanceRoutine(dateStr, id, it.count||1, it.durationMin);
  } else { renderTemps(); }
}

function setTempsSub(s){ TEMPS_SUB = s; renderTemps(); }
function renderTemps(){
  var body = document.getElementById('temps-body'); if(!body) return;
  document.querySelectorAll('#temps-subtabs .temps-subtab').forEach(function(b){ b.classList.toggle('active', b.dataset.sub === TEMPS_SUB); });
  if(TEMPS_SUB === 'today') body.innerHTML = renderTempsToday();
  else if(TEMPS_SUB === 'week') body.innerHTML = renderTempsWeek();
  else if(TEMPS_SUB === 'stats') body.innerHTML = renderTempsStats();
  else body.innerHTML = renderTempsRoutines();
}

// Dates (date+dow) d'une semaine (lundi→dimanche), offsetWeeks=0 pour cette semaine, -1 pour la précédente
function weekDates(offsetWeeks){
  var d = new Date(); d.setHours(0,0,0,0);
  var dow = d.getDay(), toMon = (dow === 0 ? -6 : 1 - dow);
  d.setDate(d.getDate() + toMon + offsetWeeks*7);
  var arr = [];
  for(var i=0;i<7;i++){ var x = new Date(d); x.setDate(d.getDate()+i); arr.push({ date:dateStrForDate(x), dow:x.getDay() }); }
  return arr;
}
// ② Statistiques
function renderTempsStats(){
  var cur = weekDates(0), prev = weekDates(-1);
  function sumReal(week){ return week.reduce(function(s, day){ return s + tempsRealFree(day.date, day.dow); }, 0); }
  function sumPlanned(week){ return week.reduce(function(s, day){ return s + tempsDayStats(day.dow).plannedFree; }, 0); }
  var realCur = sumReal(cur), planCur = sumPlanned(cur), realPrev = sumReal(prev);
  var wk = realPrev > 0 ? Math.round((realCur - realPrev)/realPrev*100) : 0;
  // Moyenne semaine (Lun–Ven) vs week-end (réel)
  var wdVals = cur.filter(function(x){ return x.dow>=1 && x.dow<=5; }).map(function(x){ return tempsRealFree(x.date, x.dow); });
  var weVals = cur.filter(function(x){ return x.dow===0 || x.dow===6; }).map(function(x){ return tempsRealFree(x.date, x.dow); });
  function avg(a){ return a.length ? a.reduce(function(s,v){return s+v;},0)/a.length : 0; }
  // Prévu vs réel par activité (cette semaine)
  var perAct = {};
  cur.forEach(function(day){
    tempsItemsForDay(day.date, day.dow).forEach(function(it){
      if(it.skipped) return;
      var key = it.extra ? '__extra' : it.id;
      var label = it.extra ? '✨ Ponctuel' : (it.emoji+' '+it.name);
      if(!perAct[key]) perAct[key] = { label:label, planned:0, real:0, done:0 };
      var count = it.count||1, prog = Math.min(count, progressOf(day.date, it.id));
      perAct[key].planned += it.durationMin;
      if(prog > 0){
        perAct[key].real += (count>1) ? (it.durationMin * prog/count) : realMinFor(day.date, it.id, it.durationMin);
        if(prog >= count) perAct[key].done++;
      }
    });
  });
  var actRows = Object.keys(perAct).map(function(k){
    var a = perAct[k], d = a.real - a.planned;
    return '<div class="sta-arow"><div class="sta-aname">'+escapeHtml(a.label)+'</div>'+
      '<div class="sta-abars"><span class="sta-plan">prévu '+fmtHM(a.planned)+'</span><span class="sta-real">réel '+fmtHM(a.real)+'</span>'+
      (a.real>0 && d!==0 ? '<span class="sta-delta '+(d>0?'neg':'pos')+'">'+(d>0?'+':'−')+fmtHM(Math.abs(d))+'</span>' : '')+'</div></div>';
  }).join('') || '<div class="sta-empty">Coche des activités dans « Aujourd\'hui » pour alimenter les stats.</div>';

  return '<div class="sta">'+
    '<div class="sta-cards">'+
      '<div class="sta-card"><div class="sta-big">'+fmtHM(realCur)+'</div><div class="sta-lbl">libre réel cette semaine</div></div>'+
      '<div class="sta-card"><div class="sta-big">'+fmtHM(planCur)+'</div><div class="sta-lbl">libre prévu cette semaine</div></div>'+
      '<div class="sta-card"><div class="sta-big '+(wk>=0?'pos':'neg')+'">'+(wk>=0?'+':'')+wk+'%</div><div class="sta-lbl">vs semaine précédente</div></div>'+
    '</div>'+
    '<div class="sta-two">'+
      '<div class="sta-mini"><div class="sta-mn">'+fmtHM(avg(wdVals))+'</div><div class="sta-ml">moy. / jour (Lun–Ven)</div></div>'+
      '<div class="sta-mini"><div class="sta-mn">'+fmtHM(avg(weVals))+'</div><div class="sta-ml">moy. / jour (week-end)</div></div>'+
    '</div>'+
    '<div class="sta-title">Prévu vs réel par activité — cette semaine</div>'+
    actRows+
  '</div>';
}

function renderTempsToday(){
  var d = new Date(), dow = d.getDay(), dateStr = dateStrForDate(d);
  var ts = tempsTodayStats(dateStr, dow);
  var free = tempsFreeNow(dateStr, dow);
  var over = free < 0;
  var usedFrac = Math.min(1, (ts.committed + ts.sleepMin)/1440);
  var R = 84, C = 2*Math.PI*R, offset = C*(1-usedFrac);
  var dateHuman = DAY_LABELS_FULL[dow]+' '+d.getDate()+' '+MONTHS_FR_FULL[d.getMonth()];
  var gauge =
    '<div class="tg-wrap">'+
      '<svg viewBox="0 0 200 200" class="tg-svg">'+
        '<circle class="tg-track" cx="100" cy="100" r="'+R+'"/>'+
        '<circle class="tg-prog'+(over?' over':'')+'" cx="100" cy="100" r="'+R+'" style="stroke-dasharray:'+C.toFixed(1)+';stroke-dashoffset:'+offset.toFixed(1)+'"/>'+
      '</svg>'+
      '<div class="tg-center">'+
        '<div class="tg-big'+(over?' neg':'')+'">'+fmtHMsigned(free)+'</div>'+
        '<div class="tg-lbl">'+(over ? 'de retard' : 'de libre restant')+'</div>'+
      '</div>'+
    '</div>';
  var head =
    '<div class="tg-head">'+
      '<div class="tg-today">Aujourd\'hui — '+dateHuman+'</div>'+
      '<div class="tg-clock">'+pad(d.getHours())+':'+pad(d.getMinutes())+'</div>'+
    '</div>';
  var usage = '<div class="tg-usage">Journée : <b>'+fmtHM(ts.committed)+'</b> engagées / 24h · <span class="tg-planned">'+fmtHM(ts.plannedFree)+' libre prévu</span></div>';
  return head + gauge + usage + renderTempsSuggest(dateStr, dow, free) + renderTempsTimeline(dateStr, dow, ts, free) + renderTempsBilan(dateStr, dow, ts);
}

function renderTempsTimeline(dateStr, dow, ts, free){
  var fixed = ts.items.filter(function(it){ return it.startTime; }).sort(function(a,b){ return hhmmToMin(a.startTime) - hhmmToMin(b.startTime); });
  var flex  = ts.items.filter(function(it){ return !it.startTime; });
  function row(it){
    var count = it.count || 1;
    var prog = Math.min(count, progressOf(dateStr, it.id));
    var full = prog >= count;
    var planned = it.durationMin;
    var real = realMinFor(dateStr, it.id, planned);
    var cls = 'tl-item'+(full?' done':(prog>0?' partial':''))+(it.skipped?' skipped':'')+(it.extra?' extra':'');
    var tag = it.extra ? '<span class="tl-tag">ponctuel</span>' : '';
    var cnt = count>1 ? '<span class="tl-count">×'+count+'</span>' : '';
    var intHint = it.interval ? '<span class="tl-count" title="Se represente tous les '+(it.everyDays||1)+' jours après validation">↻'+(it.everyDays||1)+'j</span>' : '';
    var main = '<div class="tl-main"><span class="tl-emoji">'+escapeHtml(it.emoji||'•')+'</span><span class="tl-name">'+escapeHtml(it.name)+tag+cnt+intHint+'</span><span class="tl-dur">'+fmtHM(planned)+'</span></div>';
    var time = '<div class="tl-time">'+escapeHtml(it.startTime || '·')+'</div>';
    var isTimed = activeTimer && activeTimer.id === it.id;
    var acts;
    if(it.skipped){
      acts = '<div class="tl-acts"><span class="tl-skiplbl">sautée</span><button class="tl-mini" title="Annuler" onclick="unskipRoutine(\''+dateStr+'\',\''+it.id+'\')">↩</button></div>';
    } else {
      var chkLabel = count>1 ? (prog+'/'+count) : icon('check');
      var chkCls = 'tl-chk'+(count>1?' multi':'')+(full?' checked':(prog>0?' partial':''));
      var chkTitle = count>1 ? ('Pointer une occurrence ('+prog+'/'+count+')') : (full?'Fait — cliquer pour annuler':'Marquer comme fait');
      var chk = '<button class="'+chkCls+'" title="'+chkTitle+'" onclick="advanceRoutine(\''+dateStr+'\',\''+it.id+'\','+count+','+planned+')" aria-label="'+chkTitle+'">'+chkLabel+'</button>';
      var play = (!full && !isTimed) ? '<button class="tl-mini play" title="Lancer un minuteur ('+fmtHM(planned)+')" onclick="startItemTimer(\''+it.id+'\','+planned+')">▶</button>' : '';
      var second = it.extra
        ? '<button class="tl-mini" title="Reporter à demain" onclick="reportTomorrow(\''+dateStr+'\',\''+it.id+'\')">→</button><button class="tl-mini danger" title="Supprimer" onclick="deleteExtra(\''+dateStr+'\',\''+it.id+'\')">🗑</button>'
        : '<button class="tl-mini" title="Reporter à demain" onclick="reportTomorrow(\''+dateStr+'\',\''+it.id+'\')">→</button><button class="tl-mini" title="Passer (pas fait aujourd\'hui)" onclick="skipRoutine(\''+dateStr+'\',\''+it.id+'\')">⤫</button>';
      acts = '<div class="tl-acts">'+play+second+chk+'</div>';
    }
    var realLine = (full && !it.skipped && count === 1)
      ? '<div class="tl-real">réel <input type="number" min="0" step="5" value="'+real+'" onchange="setRealMin(\''+dateStr+'\',\''+it.id+'\',this.value)"> min'+(real!==planned ? ' <span class="tl-delta '+(real>planned?'neg':'pos')+'">'+(real>planned?'+':'−')+fmtHM(Math.abs(real-planned))+'</span>' : '')+'</div>'
      : '';
    var timerLine = isTimed
      ? '<div class="tl-timer"><span class="tl-timer-ic">⏱</span><span id="timer-count" class="tl-timer-count">'+fmtClock(timerRemainingSec())+'</span>'+
          (activeTimer.paused
            ? '<button class="tl-mini" title="Reprendre" onclick="resumeTimer()">▶</button>'
            : '<button class="tl-mini" title="Pause" onclick="pauseTimer()">⏸</button>')+
          '<button class="tl-mini danger" title="Arrêter le minuteur" onclick="stopTimer()">✕</button></div>'
      : '';
    return '<div class="'+cls+'"><div class="tl-row">'+time+main+acts+'</div>'+realLine+timerLine+'</div>';
  }
  var rows = '';
  fixed.forEach(function(it){ rows += row(it); });
  if(flex.length){ rows += '<div class="tl-sep">Flexibles — à caser</div>'; flex.forEach(function(it){ rows += row(it); }); }
  if(!fixed.length && !flex.length) rows = emptyState('Aucune activité aujourd\'hui. Ajoute des routines, ou une activité ponctuelle ci-dessous.');
  rows += '<div class="tl-item"><div class="tl-row free"><div class="tl-time">🟢</div><div class="tl-main"><span class="tl-name">Temps libre</span><span class="tl-dur">'+fmtHMsigned(free)+'</span></div><div class="tl-chk-sp"></div></div></div>';
  if(ts.sleep) rows += '<div class="tl-item"><div class="tl-row sleep"><div class="tl-time">'+escapeHtml(ts.sleep.startTime||'·')+'</div><div class="tl-main"><span class="tl-emoji">😴</span><span class="tl-name">'+escapeHtml(ts.sleep.name)+'</span><span class="tl-dur">'+fmtHM(ts.sleep.durationMin)+'</span></div><div class="tl-chk-sp"></div></div></div>';
  return '<div class="tl">'+rows+'</div>'+
    '<button class="tl-addextra" onclick="openExtraModal()">+ Activité ponctuelle</button>';
}

// Flexibles restant à caser aujourd'hui (occurrences restantes, non sautés, sans créneau passé)
function tempsPendingFlex(dateStr, dow){
  var now = nowMinutes();
  return tempsTodayStats(dateStr, dow).items.filter(function(it){
    if(it.skipped || isFullyDone(dateStr, it.id, it.count)) return false;
    if(it.startTime && (hhmmToMin(it.startTime) + it.durationMin) <= now) return false;
    return !it.startTime;
  });
}
// ③ Que puis-je faire maintenant ?
function renderTempsSuggest(dateStr, dow, free){
  var pend = tempsPendingFlex(dateStr, dow).slice().sort(function(a,b){ return itemRemainingMin(dateStr,a) - itemRemainingMin(dateStr,b); });
  if(!pend.length || free <= 0) return '';
  var chips = pend.map(function(it){
    var count = it.count||1, prog = Math.min(count, progressOf(dateStr, it.id));
    var need = itemRemainingMin(dateStr, it), ok = need <= free;
    var badge = count>1 ? ' ('+prog+'/'+count+')' : '';
    return '<button class="sg-chip'+(ok?'':' no')+'" onclick="advanceRoutine(\''+dateStr+'\',\''+it.id+'\','+count+','+it.durationMin+')" title="'+(ok?'Ça rentre — pointer une occurrence':'Pas assez de temps libre')+'">'+escapeHtml(it.emoji||'•')+' '+escapeHtml(it.name)+badge+' · '+fmtHM(need)+'</button>';
  }).join('');
  return '<div class="sg"><div class="sg-head">Que faire maintenant ? <span class="sg-sub">'+fmtHM(free)+' de libre</span></div>'+
    '<div class="sg-chips">'+chips+'</div>'+
    '<button class="sg-plan" onclick="showTempsPlan()">🗓️ Planifier ma soirée</button><div id="temps-plan"></div></div>';
}
function minToHHMM(m){ m = ((Math.round(m)%1440)+1440)%1440; return pad(Math.floor(m/60))+':'+pad(m%60); }
// Cale les flexibles restants dans les trous entre maintenant et le coucher
function computeEveningPlan(dateStr, dow){
  var ts = tempsTodayStats(dateStr, dow), now = nowMinutes();
  var bed = (ts.sleep && ts.sleep.startTime) ? hhmmToMin(ts.sleep.startTime) : 1440;
  var busy = ts.items.filter(function(it){ return !it.skipped && it.startTime; })
    .map(function(it){ var s = hhmmToMin(it.startTime); return { s:s, e:s+it.durationMin }; })
    .filter(function(b){ return b.e > now && b.s < bed; }).sort(function(a,b){ return a.s - b.s; });
  var gaps = [], cur = now;
  busy.forEach(function(b){ if(b.s > cur) gaps.push({ s:cur, e:Math.min(b.s, bed) }); cur = Math.max(cur, b.e); });
  if(cur < bed) gaps.push({ s:cur, e:bed });
  var pend = tempsPendingFlex(dateStr, dow).map(function(it){ return { name:it.name, emoji:it.emoji, dur:itemRemainingMin(dateStr, it) }; })
    .sort(function(a,b){ return b.dur - a.dur; });
  var plan = [];
  pend.forEach(function(it){
    for(var i=0;i<gaps.length;i++){
      if(gaps[i].e - gaps[i].s >= it.dur){ plan.push({ name:it.name, emoji:it.emoji, start:gaps[i].s, dur:it.dur }); gaps[i].s += it.dur; break; }
    }
  });
  return plan.sort(function(a,b){ return a.start - b.start; });
}
function showTempsPlan(){
  var d = new Date(), dow = d.getDay(), dateStr = dateStrForDate(d);
  var el = document.getElementById('temps-plan'); if(!el) return;
  var plan = computeEveningPlan(dateStr, dow);
  if(!plan.length){ el.innerHTML = '<div class="pl-empty">Rien à caser (ou pas assez de place d\'ici le coucher).</div>'; return; }
  el.innerHTML = '<div class="pl">'+plan.map(function(p){
    return '<div class="pl-row"><span class="pl-time">'+minToHHMM(p.start)+'</span><span class="pl-name">'+escapeHtml(p.emoji||'•')+' '+escapeHtml(p.name)+'</span><span class="pl-dur">'+fmtHM(p.dur)+'</span></div>';
  }).join('')+'</div>';
}
// ④ Bilan du jour
function renderTempsBilan(dateStr, dow, ts){
  var realFree = tempsRealFree(dateStr, dow), planned = ts.plannedFree, diff = realFree - planned;
  var doneCount = ts.items.filter(function(it){ return !it.skipped && isFullyDone(dateStr, it.id, it.count); }).length;
  var skipCount = ts.items.filter(function(it){ return it.skipped; }).length;
  var emo = diff >= 30 ? '🎉' : (diff >= 0 ? '🙂' : (diff > -60 ? '😐' : '😬'));
  var line = diff > 0 ? ('Tu as récupéré <b>'+fmtHM(diff)+'</b> sur ton prévu')
    : (diff < 0 ? ('Tu as grignoté <b>'+fmtHM(-diff)+'</b> de libre') : 'Pile sur ton prévu');
  return '<div class="bilan">'+
    '<div class="bilan-head">'+emo+' Bilan du jour</div>'+
    '<div class="bilan-grid">'+
      '<div class="bilan-cell"><div class="bilan-n">'+fmtHM(realFree)+'</div><div class="bilan-l">libre réel</div></div>'+
      '<div class="bilan-cell"><div class="bilan-n">'+fmtHM(planned)+'</div><div class="bilan-l">libre prévu</div></div>'+
      '<div class="bilan-cell"><div class="bilan-n '+(diff>=0?'pos':'neg')+'">'+fmtHMsigned(diff)+'</div><div class="bilan-l">écart</div></div>'+
    '</div>'+
    '<div class="bilan-line">'+line+' · <b>'+doneCount+'</b> fait'+(skipCount ? (' · <b>'+skipCount+'</b> sauté') : '')+'</div>'+
  '</div>';
}

/* Modal « activité ponctuelle » (ajoutée à aujourd'hui seulement) */
var editingExtraDate = null;
function openExtraModal(){
  editingExtraDate = dateStrForDate(new Date());
  document.getElementById('extra-modal-error').textContent = '';
  document.getElementById('ex-emoji').value = '';
  document.getElementById('ex-name').value = '';
  document.getElementById('ex-dur-h').value = 0;
  document.getElementById('ex-dur-m').value = 30;
  document.getElementById('ex-start').value = '';
  document.getElementById('extra-modal-overlay').classList.add('open');
}
function closeExtraModal(){ document.getElementById('extra-modal-overlay').classList.remove('open'); }
function saveExtraFromModal(){
  var name = document.getElementById('ex-name').value.trim();
  var err = document.getElementById('extra-modal-error');
  if(!name){ err.textContent = 'Le nom est obligatoire.'; return; }
  var h = Math.max(0, parseInt(document.getElementById('ex-dur-h').value, 10) || 0);
  var m = Math.max(0, Math.min(59, parseInt(document.getElementById('ex-dur-m').value, 10) || 0));
  var start = document.getElementById('ex-start').value || null;
  addExtra(editingExtraDate || dateStrForDate(new Date()), {
    emoji: document.getElementById('ex-emoji').value.trim() || '✨',
    name: name, durationMin: h*60 + m, type: start ? 'fixed' : 'flexible', startTime: start
  });
  closeExtraModal();
}

function renderTempsWeek(){
  var maxFree = 1;
  var vals = DAY_DISPLAY_ORDER.map(function(dow){ var f = tempsDayStats(dow).plannedFree; if(f > maxFree) maxFree = f; return { dow:dow, free:f }; });
  var total = vals.reduce(function(s, v){ return s + v.free; }, 0);
  var rows = vals.map(function(v){
    var pct = Math.round(v.free/maxFree*100);
    return '<div class="wk-row'+(v.dow===new Date().getDay()?' today':'')+'"><div class="wk-day">'+DAY_LABELS[v.dow]+'</div><div class="wk-bar"><div class="wk-fill" style="width:'+pct+'%"></div></div><div class="wk-val">'+fmtHM(v.free)+'</div></div>';
  }).join('');
  return '<div class="wk"><div class="wk-title">Temps libre prévu — cette semaine</div>'+rows+'<div class="wk-total">Total : <b>'+fmtHM(total)+'</b> de libre sur la semaine</div></div>';
}

function renderTempsRoutines(){
  var cards = (state.timeRoutines||[]).map(function(r){
    var days = DAY_DISPLAY_ORDER.filter(function(d){ return r.weekdays && r.weekdays.indexOf(d) !== -1; }).map(function(d){ return DAY_LABELS[d]; }).join(' ');
    var typeLbl = r.isSleep ? 'Sommeil' : (r.type === 'fixed' ? 'Fixe' : 'Flexible');
    var cntLbl = (r.count && r.count > 1) ? ' · ×'+r.count : '';
    var sched = (r.recur === 'interval') ? ('tous les '+Math.max(1, r.everyDays||1)+' j') : (days||'aucun jour');
    return '<div class="rt-card '+(r.isSleep ? 'sleep' : (r.type||'flexible'))+'">'+
      '<div class="rt-emoji">'+escapeHtml(r.emoji||'•')+'</div>'+
      '<div class="rt-main"><div class="rt-name">'+escapeHtml(r.name)+'</div><div class="rt-meta">'+typeLbl+cntLbl+' · '+fmtHM(r.durationMin)+(r.startTime ? ' · '+escapeHtml(r.startTime) : '')+' · '+sched+'</div></div>'+
      '<button class="icon-btn tiny" onclick="openRoutineModal(\''+r.id+'\')" aria-label="Modifier">'+icon('pencil')+'</button>'+
      '<button class="icon-btn tiny danger" onclick="deleteRoutine(\''+r.id+'\')" aria-label="Supprimer">'+icon('trash')+'</button>'+
    '</div>';
  }).join('');
  return '<div class="rt-list">'+(cards || emptyState('Aucune routine.'))+'</div>'+
    '<button class="btn-primary" style="width:100%;margin-top:12px" onclick="openRoutineModal(null)">+ Nouvelle routine</button>';
}

function deleteRoutine(id){
  state.timeRoutines = (state.timeRoutines||[]).filter(function(r){ return r.id !== id; });
  persist(); renderTemps();
}
function renderRoutineWeekdayPicker(){
  var c = document.getElementById('rt-weekdays'); if(!c) return;
  c.innerHTML = DAY_DISPLAY_ORDER.map(function(dow){ return '<button type="button" class="wd-chip'+(modalRoutineWeekdays.indexOf(dow)!==-1?' active':'')+'" onclick="toggleRoutineWeekday('+dow+')">'+DAY_LABELS[dow]+'</button>'; }).join('');
}
function toggleRoutineWeekday(dow){ var i = modalRoutineWeekdays.indexOf(dow); if(i === -1) modalRoutineWeekdays.push(dow); else modalRoutineWeekdays.splice(i, 1); renderRoutineWeekdayPicker(); }
function openRoutineModal(id){
  editingRoutineId = id;
  document.getElementById('routine-modal-error').textContent = '';
  if(id){
    var r = (state.timeRoutines||[]).find(function(x){ return x.id === id; }); if(!r) return;
    document.getElementById('routine-modal-title').textContent = 'Modifier la routine';
    document.getElementById('rt-emoji').value = r.emoji || '';
    document.getElementById('rt-name').value = r.name || '';
    document.getElementById('rt-type').value = r.isSleep ? 'sommeil' : (r.type || 'flexible');
    document.getElementById('rt-dur-h').value = Math.floor((r.durationMin||0)/60);
    document.getElementById('rt-dur-m').value = (r.durationMin||0)%60;
    document.getElementById('rt-start').value = r.startTime || '';
    document.getElementById('rt-count').value = Math.max(1, r.count||1);
    document.getElementById('rt-recur').value = r.recur || 'weekly';
    document.getElementById('rt-every').value = Math.max(1, r.everyDays||2);
    modalRoutineWeekdays = (r.weekdays||[]).slice();
  } else {
    document.getElementById('routine-modal-title').textContent = 'Nouvelle routine';
    document.getElementById('rt-emoji').value = '';
    document.getElementById('rt-name').value = '';
    document.getElementById('rt-type').value = 'flexible';
    document.getElementById('rt-dur-h').value = 0;
    document.getElementById('rt-dur-m').value = 30;
    document.getElementById('rt-start').value = '';
    document.getElementById('rt-count').value = 1;
    document.getElementById('rt-recur').value = 'weekly';
    document.getElementById('rt-every').value = 2;
    modalRoutineWeekdays = [1,2,3,4,5];
  }
  onRoutineTypeChange();
  renderRoutineWeekdayPicker();
  document.getElementById('routine-modal-overlay').classList.add('open');
}
// Affiche l'horaire seulement pour Fixe/Sommeil ; le masque pour Flexible (pas de créneau imposé)
function onRoutineTypeChange(){
  var typeSel = document.getElementById('rt-type').value;
  var sommeil = typeSel === 'sommeil';
  document.getElementById('rt-start-field').style.display = (typeSel === 'flexible') ? 'none' : '';
  document.getElementById('rt-start-label').textContent = sommeil ? 'Heure du coucher' : 'Horaire';
  document.getElementById('rt-count-field').style.display = sommeil ? 'none' : '';
  var recurField = document.getElementById('rt-recur-field');
  if(recurField) recurField.style.display = sommeil ? 'none' : '';
  if(sommeil) document.getElementById('rt-recur').value = 'weekly';   // le sommeil est quotidien
  onRoutineRecurChange();
}
// Bascule entre « jours de la semaine » et « tous les N jours »
function onRoutineRecurChange(){
  var interval = document.getElementById('rt-recur').value === 'interval';
  var wd = document.getElementById('rt-weekdays-field');
  var ev = document.getElementById('rt-every-field');
  if(wd) wd.style.display = interval ? 'none' : '';
  if(ev) ev.style.display = interval ? '' : 'none';
}
function closeRoutineModal(){ document.getElementById('routine-modal-overlay').classList.remove('open'); editingRoutineId = null; }
function saveRoutineFromModal(){
  var name = document.getElementById('rt-name').value.trim();
  var err = document.getElementById('routine-modal-error');
  if(!name){ err.textContent = 'Le nom est obligatoire.'; return; }
  err.textContent = '';
  var durH = Math.max(0, parseInt(document.getElementById('rt-dur-h').value, 10) || 0);
  var durM = Math.max(0, Math.min(59, parseInt(document.getElementById('rt-dur-m').value, 10) || 0));
  var typeSel = document.getElementById('rt-type').value;
  var isSleep = typeSel === 'sommeil';
  var type = isSleep ? 'fixed' : typeSel;   // le sommeil est un créneau fixe (heure de coucher)
  var count = isSleep ? 1 : Math.max(1, Math.min(20, parseInt(document.getElementById('rt-count').value, 10) || 1));
  var recur = isSleep ? 'weekly' : document.getElementById('rt-recur').value;
  var everyDays = Math.max(1, Math.min(60, parseInt(document.getElementById('rt-every').value, 10) || 2));
  var existing = editingRoutineId ? state.timeRoutines.find(function(x){ return x.id === editingRoutineId; }) : null;
  var data = {
    emoji: document.getElementById('rt-emoji').value.trim() || '•',
    name: name,
    type: type,
    durationMin: durH*60 + durM,
    startTime: (typeSel === 'flexible') ? null : (document.getElementById('rt-start').value || null),
    isSleep: isSleep,
    count: count,
    recur: recur,
    everyDays: everyDays,
    weekdays: modalRoutineWeekdays.slice()
  };
  if(recur === 'interval'){ data.nextDue = (existing && existing.nextDue) ? existing.nextDue : todayStr(); } // dû aujourd'hui à la création
  if(editingRoutineId){ var ex = existing; if(ex) Object.assign(ex, data); }
  else { data.id = uid('rt'); if(!state.timeRoutines) state.timeRoutines = []; state.timeRoutines.push(data); }
  persist(); closeRoutineModal(); renderTemps();
}

function init(){
  try{
    state = loadState();
    document.getElementById('quick-add-submit').innerHTML = icon('plus');
    // Fond : constellation statique (constellation_bg.js) — s'initialise tout seul
    refreshCategoryUI();
    renderTasks();
    renderSchedule();
    loadTimer();
    if(activeTimer && !activeTimer.paused) ensureTimerTick();
    renderTemps();
    // Mode « app » (PWA installée / ?app=1) : uniquement l'onglet Temps
    var appOnly = document.documentElement.classList.contains('app-only');
    switchTab(appOnly ? 'temps' : (state.settings.lastTab || 'tasks'));
    bindGlobalEvents();
    initAgendaTooltip();

    if (window.parent !== window) window.parent.postMessage({ type: 'request_app_visible' }, '*');

    // tick à la minute : met à jour le planning, les notifs, et le compteur de temps libre dynamique
    setInterval(function(){ renderSchedule(); updateTaskNotifications(); if(TEMPS_SUB === 'today') renderTemps(); }, 60000);
  }catch(e){
    logError('init', e);
  }
}
init();
