/* Orbit DEMO guard — no real backend, nothing leaves the page. */
(function(){
  var of = window.fetch ? window.fetch.bind(window) : null;
  function J(o){ return Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'Content-Type':'application/json'}})); }
  window.fetch = function(input, init){
    var u = (typeof input==='string') ? input : (input && input.url) || '';
    if(/127\.0\.0\.1|localhost/i.test(u)) return Promise.reject(new Error('demo: local backend disabled'));
    if(/frankfurter\.app/i.test(u)) return J({amount:1,base:'USD',rates:{EUR:0.92}});
    if(/exchangerate-api\.com/i.test(u)) return J({rates:{EUR:0.92}});
    if(/currency-api|@fawazahmed0/i.test(u)) return J({usd:{eur:0.92}});
    if(/hyperliquid\.xyz/i.test(u)) return Promise.reject(new Error('demo: external api disabled'));
    return of ? of(input, init) : Promise.reject(new Error('no fetch'));
  };
  try{ if(navigator.serviceWorker && navigator.serviceWorker.register){ navigator.serviceWorker.register=function(){return Promise.reject(new Error('demo:sw off'));}; } }catch(e){}
})();
