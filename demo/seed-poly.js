/* demo seed (only if empty) */
if(!localStorage.getItem('polymarket_capital_history')){
(function seedPolymarketDemo(){
  try { localStorage.setItem('tjournal_theme', 'dark'); } catch(e){}
  try { document.documentElement.setAttribute('data-theme', 'dark'); } catch(e){}
  var END = new Date('2026-08-05T00:00:00');
  var DAYS = 57;
  var capital = 1024.60;
  var seed = 20260805;
  function rnd(){ seed = (seed*1103515245 + 12345) & 0x7fffffff; return seed/0x7fffffff; }
  var history = [];
  for (var i = DAYS - 1; i >= 0; i--) {
    var d = new Date(END); d.setDate(END.getDate() - i);
    var drift = 0.013;
    var shock = (rnd() - 0.45) * 0.055;
    if (rnd() > 0.9) shock += (rnd() - 0.35) * 0.08;
    capital = capital * (1 + drift + shock);
    var cents = Math.round((capital + (rnd()*0.9)) * 100) / 100;
    history.push({ date: d.toISOString().slice(0, 10), capital: cents });
  }
  history[history.length - 1].capital = 2853.20;
  try { localStorage.setItem('polymarket_capital_history', JSON.stringify(history)); } catch(e){}
  try { if (typeof render === 'function') render(); } catch(e){}
})();

}
