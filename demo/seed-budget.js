/* demo seed (only if empty) */
if(!localStorage.getItem('nx_comptes')){
(function () {
  var J = function (k, v) { localStorage.setItem(k, JSON.stringify(v)); };
  var R = function (k, v) { localStorage.setItem(k, v); };
  function ym(off) { var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function iso(off) { var d = new Date(); d.setDate(d.getDate() - off); return d.toISOString().slice(0, 10); }
  var months = [5, 4, 3, 2, 1, 0].map(ym);
  var _c = 0;
  function sid() { return Date.now().toString(36) + (_c++).toString(36) + Math.random().toString(36).slice(2, 5); }
  var cats = [
    { id: 'loyer',   name: 'Loyer & Charges',    emoji: '🏠', budget: 900, color: 'purple' },
    { id: 'food',    name: 'Alimentation',        emoji: '🛒', budget: 450, color: 'teal'   },
    { id: 'transp',  name: 'Transport & Voiture', emoji: '🚗', budget: 260, color: 'yellow' },
    { id: 'abos',    name: 'Abonnements',         emoji: '📱', budget: 110, color: 'orange' },
    { id: 'sante',   name: 'Santé',               emoji: '🏥', budget: 90,  color: 'red'    },
    { id: 'loisirs', name: 'Loisirs & Sorties',   emoji: '🎬', budget: 220, color: 'teal'   },
    { id: 'habits',  name: 'Vêtements',           emoji: '👕', budget: 110, color: 'purple' },
    { id: 'divers',  name: 'Divers',              emoji: '💰', budget: 150, color: 'green'  }
  ];
  var pools = {
    loyer:   ['Loyer', 'Charges & EDF'],
    food:    ['Courses Lidl', 'Courses Carrefour', 'Boulangerie'],
    transp:  ['Essence', 'Assurance auto', 'Péage'],
    abos:    ['Netflix', 'Spotify', 'Forfait mobile'],
    sante:   ['Pharmacie', 'Consultation', 'Mutuelle'],
    loisirs: ['Restaurant', 'Cinéma', 'Bar entre amis'],
    habits:  ['Zara', 'Chaussures', 'Uniqlo'],
    divers:  ['Amazon', 'Cadeau', 'Imprévu']
  };
  var salaires = [2780, 2780, 2850, 2850, 2850, 2910];
  var spend = {
    loyer:   [900, 900, 900, 900, 900, 900],
    food:    [365, 410, 385, 395, 372, 405],
    transp:  [205, 240, 210, 225, 198, 215],
    abos:    [95, 95, 95, 95, 95, 95],
    sante:   [40, 0, 120, 55, 30, 68],
    loisirs: [150, 185, 160, 210, 175, 168],
    habits:  [60, 120, 0, 90, 45, 110],
    divers:  [95, 130, 110, 140, 100, 118]
  };
  function splitItems(catId, amount) {
    if (amount <= 0) return [];
    var labels = pools[catId] || ['Dépense'];
    var a = Math.round(amount * 0.58);
    var items = [{ id: sid(), label: labels[0], amount: a }];
    var rest = Math.round((amount - a) * 100) / 100;
    if (rest > 0) items.push({ id: sid(), label: labels[1] || labels[0], amount: rest });
    return items;
  }
  var budget = {};
  months.forEach(function (m, mi) {
    var md = { salaire: salaires[mi], cats: {}, items: {} };
    cats.forEach(function (c) {
      var v = spend[c.id][mi];
      md.cats[c.id] = v;
      md.items[c.id] = splitItems(c.id, v);
    });
    budget[m] = md;
  });
  var comptes = [
    { id: 'cpt_courant', nom: 'Compte courant', type: 'courant', solde: 2450.80, couleur: '#7c3aed' },
    { id: 'cpt_joint',   nom: 'Compte joint',   type: 'courant', solde: 1250.40, couleur: '#8b5cf6' },
    { id: 'cpt_livreta', nom: 'Livret A',       type: 'epargne', solde: 12800.00, couleur: '#06b6d4' },
    { id: 'cpt_ldds',    nom: 'LDDS',           type: 'epargne', solde: 6400.00,  couleur: '#10b981' },
    { id: 'cpt_pel',     nom: 'PEL',            type: 'epargne', solde: 8900.00,  couleur: '#f59e0b' }
  ];
  var oid = Date.now();
  function nextId() { return ++oid; }
  var assets = [
    { compte: 'crypto', actif: 'BTC',        inv: 3000, cur: 4800, date: '2022-11-05' },
    { compte: 'crypto', actif: 'ETH',        inv: 2000, cur: 2600, date: '2023-02-18' },
    { compte: 'crypto', actif: 'SOL',        inv: 800,  cur: 1450, date: '2023-09-12' },
    { compte: 'pea',    actif: 'ETF SP500',  q: 12, px: 500, cur: 7350, date: '2022-06-20' },
    { compte: 'pea',    actif: 'ETF WORLD',  q: 20, px: 90,  cur: 2100, date: '2023-04-10' },
    { compte: 'cto',    actif: 'ETF NASDAQ', q: 8,  px: 285, cur: 2850, date: '2023-07-01' }
  ];
  var ops = [];
  assets.forEach(function (a) {
    var isActions = a.compte === 'pea' || a.compte === 'cto';
    var montant = isActions ? +(a.q * a.px).toFixed(2) : a.inv;
    ops.push({
      id: nextId(), date: a.date, compte: a.compte, actif: a.actif, actifCible: null,
      type: 'achat', note: '', montant: montant,
      quantite: isActions ? a.q : null, prixUnit: isActions ? a.px : null,
      valeurCapital: null, devise: 'EUR', valeurBrute: null
    });
    ops.push({
      id: nextId(), date: iso(2), compte: a.compte, actif: a.actif, actifCible: null,
      type: 'valorisation', note: 'Valorisation', montant: 0,
      quantite: null, prixUnit: null,
      valeurCapital: a.cur, devise: 'EUR', valeurBrute: a.cur
    });
  });
  ops.sort(function (x, y) { return y.date.localeCompare(x.date); });
  var snaps = [
    { date: ym(4) + '-05', total: 16800, investi: 13600, byCompte: { crypto: 6400, pea: 8000, cto: 2400 } },
    { date: ym(3) + '-05', total: 18250, investi: 14200, byCompte: { crypto: 7100, pea: 8550, cto: 2600 } },
    { date: ym(2) + '-05', total: 19400, investi: 15100, byCompte: { crypto: 7700, pea: 9000, cto: 2700 } },
    { date: ym(1) + '-05', total: 20350, investi: 15600, byCompte: { crypto: 8300, pea: 9250, cto: 2800 } },
    { date: iso(2),        total: 21150, investi: 15880, byCompte: { crypto: 8850, pea: 9450, cto: 2850 } }
  ].map(function (s, i) { return { id: Date.now() + i, date: s.date, total: s.total, investi: s.investi, byCompte: s.byCompte }; });
  var proj = {
    apport: 800, pct: 65,
    bst_v: 1500, bst_m: 8,
    pea_k: 12300, pea_r: 8.5, pea_a: 45, pea_ret: 4,
    cry_k: 8850,  cry_r: 20,  cry_a: 45, cry_ret: 4
  };
  var rebal = { invest: 2000, etf1_name: 'SP500', etf1_units: 12, etf1_price: 505, etf2_name: 'NS100', etf2_units: 8, etf2_price: 288, target1: 80 };
  J('nx_cats', cats);
  J('nx_budget', budget);
  J('nx_comptes', comptes);
  J('nexus_ops', ops);
  J('nexus_prices', {});
  J('nexus_snaps', snaps);
  J('nx_proj_v1', proj);
  J('nx_rebal', rebal);
  J('nx_tombstone', []);
  R('nx_last_cat', 'food');
  R('nx_theme', 'dark');
  R('nx_tab', 'actifs');
})();

}
