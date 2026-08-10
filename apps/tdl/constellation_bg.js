// Fond "Constellation" STATIQUE — repris de l'onglet trading d'Orbit, sans animation.
// Dessine une fois (nœuds colorés + liens + poussière + halos), redessine au resize.
(function () {
  function init() {
    var host = document.createElement('div');
    host.id = 'constellationBg';
    host.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;';
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;';
    host.appendChild(canvas);
    document.body.insertBefore(host, document.body.firstChild);
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0, dpr = 1, lastW = -1;

    var COLORS = [
      { r:124, g:58,  b:237 }, { r:139, g:71,  b:240 }, { r:167, g:139, b:250 },
      { r:196, g:181, b:253 }, { r:101, g:39,  b:208 }, { r:226, g:232, b:240 }
    ];
    var CONN_DIST = 145;
    var nodes = [], dust = [];
    function rand(a, b) { return a + Math.random() * (b - a); }

    function build() {
      var area = W * H, ref = 1920 * 1080;
      var nCount = Math.max(80, Math.min(400, Math.round(260 * area / ref)));
      nodes = [];
      for (var i = 0; i < nCount; i++) {
        var c = COLORS[Math.floor(Math.random() * COLORS.length)];
        var roll = Math.random(), size, glow;
        if (roll < 0.12)      { size = rand(3.8, 6.0); glow = true;  }
        else if (roll < 0.35) { size = rand(1.8, 3.2); glow = false; }
        else                  { size = rand(0.7, 1.5); glow = false; }
        nodes.push({ x: Math.random() * W, y: Math.random() * H, cr: c.r, cg: c.g, cb: c.b, size: size, glow: glow });
      }
      var dCount = Math.max(30, Math.min(140, Math.round(80 * area / ref)));
      dust = [];
      for (var k = 0; k < dCount; k++) {
        dust.push({ x: Math.random() * W, y: Math.random() * H, r: rand(0.4, 1.4), a: rand(0.12, 0.5) });
      }
    }

    function drawConnections() {
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var a = nodes[i], b = nodes[j];
          var dx = a.x - b.x, dy = a.y - b.y, dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > CONN_DIST) continue;
          var alpha = (1 - dist / CONN_DIST) * 0.55;
          if (alpha < 0.01) continue;
          var n = a.size >= b.size ? a : b;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = 'rgba(' + n.cr + ',' + n.cg + ',' + n.cb + ',' + (alpha * 0.7) + ')';
          ctx.lineWidth = 0.55; ctx.stroke();
        }
      }
    }

    function draw() {
      ctx.fillStyle = '#050816';
      ctx.fillRect(0, 0, W, H);
      for (var d = 0; d < dust.length; d++) {
        ctx.beginPath(); ctx.arc(dust[d].x, dust[d].y, dust[d].r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(200,215,255,' + dust[d].a + ')'; ctx.fill();
      }
      drawConnections();
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        if (nd.glow) {
          var gr = ctx.createRadialGradient(nd.x, nd.y, 0, nd.x, nd.y, nd.size * 5);
          gr.addColorStop(0,   'rgba(' + nd.cr + ',' + nd.cg + ',' + nd.cb + ',0.55)');
          gr.addColorStop(0.4, 'rgba(' + nd.cr + ',' + nd.cg + ',' + nd.cb + ',0.18)');
          gr.addColorStop(1,   'rgba(' + nd.cr + ',' + nd.cg + ',' + nd.cb + ',0)');
          ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.size * 5, 0, Math.PI * 2); ctx.fillStyle = gr; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(nd.x, nd.y, nd.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgb(' + nd.cr + ',' + nd.cg + ',' + nd.cb + ')'; ctx.fill();
      }
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth; H = window.innerHeight;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Ne régénère les nœuds que si la largeur change nettement (rotation) —
      // évite le clignotement quand la barre d'URL mobile change juste la hauteur.
      if (Math.abs(W - lastW) > 40) { lastW = W; build(); }
      draw();
    }
    resize();
    var rt = null;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 200); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
