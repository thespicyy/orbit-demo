/* demo seed (only if empty) */
if(!localStorage.getItem('tjournal_trades')){
(function seedOrbitDemo(){
  function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  const rnd=mulberry32(123456789);
  const R=(a,b)=>a+(b-a)*rnd();
  const RI=(a,b)=>Math.floor(R(a,b+1));
  const pick=a=>a[Math.floor(rnd()*a.length)];
  const round=(x,n=2)=>+x.toFixed(n);
  const hhmm=(h,m)=>String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
  const TICKERS=[
    {s:'BTC',p:[62000,118000],d:0},{s:'ETH',p:[2400,4600],d:0},
    {s:'SOL',p:[110,265],d:2},   {s:'HYPE',p:[18,46],d:2},
    {s:'TAO',p:[300,620],d:1},   {s:'XRP',p:[0.48,1.25],d:4},
    {s:'LINK',p:[11,29],d:2},    {s:'ADA',p:[0.38,0.92],d:4},
    {s:'DOGE',p:[0.09,0.26],d:4},{s:'BNB',p:[440,760],d:1},
  ];
  const GRADES=['A+','A','A','B','B','B','C',''];
  const start=new Date('2026-03-04'), end=new Date('2026-08-04');
  const spanDays=(end-start)/86400000;
  const N=54, idBase=1710000000000, trades=[];
  for(let i=0;i<N;i++){
    const tk=pick(TICKERS);
    const dir=rnd()<0.55?'LONG':'SHORT';
    const dayOffset=Math.max(0,Math.floor(spanDays*(i/N)+R(-2.2,2.2)));
    const dateS=new Date(start.getTime()+dayOffset*86400000).toISOString().slice(0,10);
    const entryH=RI(0,23), entryM=RI(0,59), durMins=RI(18,640);
    const endTot=(entryH*60+entryM+durMins)%1440;
    const timeEnd=hhmm(Math.floor(endTot/60),endTot%60);
    const buy=round(R(tk.p[0],tk.p[1]),tk.d);
    const riskFrac=R(0.008,0.032);
    const sl=dir==='LONG'?round(buy*(1-riskFrac),tk.d):round(buy*(1+riskFrac),tk.d);
    const riskPct=Math.abs((buy-sl)/buy)*100;
    const rrTarget=round(R(1.0,3.6),1);
    const isWin=rnd()<0.575;
    let rrReal;
    if(isWin){ rrReal=round(rrTarget*R(0.72,1.12),2); if(rrReal<0.5)rrReal=round(R(0.5,0.9),2); if(rrReal>4)rrReal=4; }
    else{ rrReal=round(-R(0.72,1.05),2); }
    const lev=RI(2,10), amtIn=round(R(220,1600),2);
    const priceMoveFrac=rrReal*riskFrac;
    const pnlDollar=round(amtIn*lev*priceMoveFrac,2);
    const pnlPct=round(lev*priceMoveFrac*100,3);
    const amtOut=dir==='LONG'?round(amtIn+pnlDollar,2):round(amtIn-pnlDollar,2);
    const sell=dir==='LONG'?round(buy*(1+priceMoveFrac),tk.d):round(buy*(1-priceMoveFrac),tk.d);
    trades.push({
      id:idBase+i*97001, ticker:tk.s, date:dateS,
      time:hhmm(entryH,entryM), timeEnd, dur:durMins, dir,
      buy, sl, sell, amtIn, amtOut, pnlDollar, pnlPct,
      risk:round(riskPct,3), leverage:lev, realRisk:round(R(0.8,2.6),2),
      rrTarget, rrReal, lowBr:'N', highBr:'N', img5:'', img15:'',
      title:'', setupGrade:pick(GRADES), note:'', noteLevels:'',
      isIdea:false, isPaper:false, reviewed:rnd()<0.5, reviewAgain:false,
      reviewComment:'', reviewGrade:'',
    });
  }
  trades.sort((a,b)=>new Date(a.date+'T'+a.time)-new Date(b.date+'T'+b.time));
  trades.reverse();
  const pts=[]; let val=10000; const NP=30;
  for(let i=0;i<NP;i++){
    const d=new Date(start.getTime()+spanDays*(i/(NP-1))*86400000);
    if(i>0){ val=val+R(45,190)+R(-330,285); if(val<9200)val=9200+R(0,200); }
    pts.push({date:d.toISOString().slice(0,10), value:round(val,2)});
  }
  localStorage.setItem('tjournal_trades',    JSON.stringify(trades));
  localStorage.setItem('tjournal_portfolio', JSON.stringify(pts));
  localStorage.setItem('tjournal_theme',        'dark');
  localStorage.setItem('tjournal_pnl_hidden',   '0');
  localStorage.setItem('tjournal_tab',          'dashboard');
  localStorage.setItem('tjournal_atab',         'stats');
  localStorage.setItem('tjournal_rr',           '2');
  localStorage.setItem('tjournal_risk_target',  '2');
  localStorage.setItem('tjournal_calc_capital', String(pts[pts.length-1].value));
  localStorage.setItem('tjournal_type_filter',  'all');
  localStorage.setItem('tjournal_review_filter','all');
  localStorage.setItem('tjournal_mode',         'real');
  localStorage.setItem('tjournal_migr_rr_v1',   '1');
  localStorage.setItem('tjournal_migr_ideas_v1','1');
})();

}
