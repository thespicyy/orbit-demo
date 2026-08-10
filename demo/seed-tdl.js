/* demo seed (only if empty) */
if(!localStorage.getItem('tdl_state')){
(function () {
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  var D = function (offset) {
    var d = new Date(); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  var now = Date.now(), DAY = 86400000;
  var cats = [
    { name: 'Perso',  color: '#7c3aed' },
    { name: 'Dev',    color: '#9333ea' },
    { name: 'Admin',  color: '#a78bfa' },
    { name: 'Maison', color: '#6d28d9' },
    { name: 'Sport',  color: '#c4b5fd' }
  ];
  var col = function (name) { for (var i = 0; i < cats.length; i++) if (cats[i].name === name) return cats[i].color; return ''; };
  var order = 0;
  var mk = function (o) {
    return {
      id: 't_demo_' + (order),
      title: o.title, notes: o.notes || '',
      category: o.category || '',
      categoryColor: o.category ? col(o.category) : '',
      priority: o.priority || 'medium',
      dueDate: o.dueDate || null, dueTime: o.dueTime || null,
      subtasks: (o.subtasks || []).map(function (s, i) {
        return { id: 's_demo_' + order + '_' + i, text: s.text, done: !!s.done };
      }),
      status: o.status || 'open',
      recurrenceDays: o.recurrenceDays || 0,
      createdAt: now - (o.ageDays || 0) * DAY,
      completedAt: o.status === 'done' ? now - (o.doneAgo || 0) * DAY : null,
      order: order++
    };
  };
  var tasks = [
    mk({ title: 'Finaliser le rapport trimestriel', category: 'Admin', priority: 'urgent',
         dueDate: D(0), dueTime: '17:00', ageDays: 6, notes: 'Relire les chiffres avant envoi.',
         subtasks: [ { text: 'Compiler les données', done: true }, { text: 'Rédiger la synthèse', done: false }, { text: 'Envoyer à la direction', done: false } ] }),
    mk({ title: 'Corriger le bug de connexion (SSO)', category: 'Dev', priority: 'high',
         dueDate: D(-1), dueTime: '11:30', ageDays: 4, notes: 'Token expiré non rafraîchi côté client.' }),
    mk({ title: 'Payer la facture d’électricité', category: 'Admin', priority: 'high', dueDate: D(2), ageDays: 3 }),
    mk({ title: 'Séance de sport', category: 'Sport', priority: 'medium', dueDate: D(0), dueTime: '07:30', recurrenceDays: 2, ageDays: 10 }),
    mk({ title: 'Déployer la v1.4 en production', category: 'Dev', priority: 'urgent',
         dueDate: D(1), dueTime: '15:00', ageDays: 2,
         subtasks: [ { text: 'Tests de non-régression', done: true }, { text: 'Backup base', done: true }, { text: 'Bascule DNS', done: false } ] }),
    mk({ title: 'Appeler le garagiste pour la révision', category: 'Perso', priority: 'medium', dueDate: D(3), ageDays: 1 }),
    mk({ title: 'Rédiger la doc API v2', category: 'Dev', priority: 'low', dueDate: D(7), ageDays: 5, notes: 'Endpoints /auth et /billing.' }),
    mk({ title: 'Réserver les billets de train', category: 'Perso', priority: 'high', dueDate: D(5), dueTime: '20:00', ageDays: 2 }),
    mk({ title: 'Arroser les plantes', category: 'Maison', priority: 'low', dueDate: D(0), recurrenceDays: 3, ageDays: 12 }),
    mk({ title: 'Préparer la présentation client', category: 'Admin', priority: 'high',
         dueDate: D(4), dueTime: '09:00', ageDays: 3,
         subtasks: [ { text: 'Slides intro', done: true }, { text: 'Démo produit', done: false } ] }),
    mk({ title: 'Mettre à jour le CV', category: 'Perso', priority: 'medium', status: 'done', ageDays: 8, doneAgo: 1 }),
    mk({ title: 'Faire les courses de la semaine', category: 'Maison', priority: 'medium', status: 'done', ageDays: 3, doneAgo: 0 }),
    mk({ title: 'Migrer le dépôt vers le nouveau CI', category: 'Dev', priority: 'high', status: 'done', ageDays: 9, doneAgo: 2 }),
    mk({ title: 'Renouveler l’abonnement cloud', category: 'Admin', priority: 'low', status: 'done', ageDays: 5, doneAgo: 1 })
  ];
  var blocks = [
    { id: 'b_demo_1', start: '07:00', end: '07:45', label: 'Réveil & sport',      color: '#7c3aed', order: 0 },
    { id: 'b_demo_2', start: '08:00', end: '09:00', label: 'Petit-déj & mails',   color: '#a78bfa', order: 1 },
    { id: 'b_demo_3', start: '09:00', end: '12:30', label: 'Travail concentré',   color: '#6d28d9', order: 2 },
    { id: 'b_demo_4', start: '12:30', end: '13:30', label: 'Déjeuner',            color: '#c4b5fd', order: 3 },
    { id: 'b_demo_5', start: '13:30', end: '15:00', label: 'Réunions',            color: '#9333ea', order: 4 },
    { id: 'b_demo_6', start: '15:00', end: '18:00', label: 'Dev & code review',   color: '#8b5cf6', order: 5 },
    { id: 'b_demo_7', start: '18:30', end: '19:30', label: 'Courses / perso',     color: '#7c3aed', order: 6 },
    { id: 'b_demo_8', start: '21:00', end: '22:30', label: 'Lecture',             color: '#5b21b6', order: 7 }
  ];
  var state = {
    version: 1,
    settings: {
      lastTab: 'tasks',
      bg: {
        opacity: 100, characters: ' .:-+*=%@#', elementSize: 16, color: '#ffffff',
        direction: 'left', background: '#000000', invert: false, fontWeight: '400',
        speed: 20, waveTension: 5, noiseScale: 12, intensity: 10,
        hasCursorInteraction: true, interactionIntensity: 15, interactionRadius: 160
      }
    },
    tasks: tasks,
    categories: cats,
    dayLayouts: [
      { id: 'layout_default', name: 'Semaine type', days: [0, 1, 2, 3, 4, 5, 6], blocks: blocks }
    ],
    presets: []
  };
  localStorage.setItem('tdl_state', JSON.stringify(state));
})();

}
