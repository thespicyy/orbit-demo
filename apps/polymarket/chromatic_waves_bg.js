// Fond animé "Chromatic Waves" — portage vanilla-JS/WebGL2 (sans lib ogl) du kit
// fourni par l'utilisateur. Pipeline 2 passes : bruit de Perlin animé -> render
// target, puis post-traitement "halftone" qui échantillonne cette texture par
// cellules et dessine un point teinté par une palette de couleurs Orbit.
(function () {
  function init() {
    try {
      var host = document.createElement('div');
      host.id = 'chromaticWavesBg';
      host.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;';
      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:100%;height:100%;display:block;';
      host.appendChild(canvas);
      document.body.insertBefore(host, document.body.firstChild);

      var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false });
      if (!gl) { host.remove(); return; }

      var perlinVertexShader = '#version 300 es\n' +
        'in vec2 uv;\n' +
        'in vec2 position;\n' +
        'out vec2 vUv;\n' +
        'void main() {\n' +
        '  vUv = uv;\n' +
        '  gl_Position = vec4(position, 0., 1.);\n' +
        '}';

      var perlinFragmentShader = '#version 300 es\n' +
        'precision mediump float;\n' +
        'uniform float uFrequency;\n' +
        'uniform float uTime;\n' +
        'uniform float uSpeed;\n' +
        'uniform float uValue;\n' +
        'uniform vec2 uResolution;\n' +
        'in vec2 vUv;\n' +
        'out vec4 fragColor;\n' +
        '\n' +
        'vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }\n' +
        'vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }\n' +
        'vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }\n' +
        'vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }\n' +
        '\n' +
        'float snoise(vec3 v) {\n' +
        '  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;\n' +
        '  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);\n' +
        '  vec3 i  = floor(v + dot(v, C.yyy));\n' +
        '  vec3 x0 = v - i + dot(i, C.xxx);\n' +
        '  vec3 g = step(x0.yzx, x0.xyz);\n' +
        '  vec3 l = 1.0 - g;\n' +
        '  vec3 i1 = min( g.xyz, l.zxy );\n' +
        '  vec3 i2 = max( g.xyz, l.zxy );\n' +
        '  vec3 x1 = x0 - i1 + C.xxx;\n' +
        '  vec3 x2 = x0 - i2 + C.yyy;\n' +
        '  vec3 x3 = x0 - D.yyy;\n' +
        '  i = mod289(i);\n' +
        '  vec4 p = permute( permute( permute(\n' +
        '             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))\n' +
        '           + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))\n' +
        '           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));\n' +
        '  float n_ = 0.142857142857;\n' +
        '  vec3  ns = n_ * D.wyz - D.xzx;\n' +
        '  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);\n' +
        '  vec4 x_ = floor(j * ns.z);\n' +
        '  vec4 y_ = floor(j - 7.0 * x_ );\n' +
        '  vec4 x = x_ *ns.x + ns.yyyy;\n' +
        '  vec4 y = y_ *ns.x + ns.yyyy;\n' +
        '  vec4 h = 1.0 - abs(x) - abs(y);\n' +
        '  vec4 b0 = vec4( x.xy, y.xy );\n' +
        '  vec4 b1 = vec4( x.zw, y.zw );\n' +
        '  vec4 s0 = floor(b0)*2.0 + 1.0;\n' +
        '  vec4 s1 = floor(b1)*2.0 + 1.0;\n' +
        '  vec4 sh = -step(h, vec4(0.0));\n' +
        '  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;\n' +
        '  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;\n' +
        '  vec3 p0 = vec3(a0.xy,h.x);\n' +
        '  vec3 p1 = vec3(a0.zw,h.y);\n' +
        '  vec3 p2 = vec3(a1.xy,h.z);\n' +
        '  vec3 p3 = vec3(a1.zw,h.w);\n' +
        '  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));\n' +
        '  p0 *= norm.x;\n' +
        '  p1 *= norm.y;\n' +
        '  p2 *= norm.z;\n' +
        '  p3 *= norm.w;\n' +
        '  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);\n' +
        '  m = m * m;\n' +
        '  return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );\n' +
        '}\n' +
        '\n' +
        'vec3 hsv2rgb(vec3 c) {\n' +
        '  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);\n' +
        '  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);\n' +
        '  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);\n' +
        '}\n' +
        '\n' +
        'void main() {\n' +
        '  vec2 uv = vUv;\n' +
        '  float aspect = uResolution.x / max(uResolution.y, 1.0);\n' +
        '  uv = (uv - 0.5) * vec2(aspect, 1.0) + 0.5;\n' +
        '  float hue = abs(snoise(vec3(uv * uFrequency, uTime * uSpeed)));\n' +
        '  vec3 rainbowColor = hsv2rgb(vec3(hue, 1.0, uValue));\n' +
        '  fragColor = vec4(rainbowColor, 1.0);\n' +
        '}';

      var dotVertexShader = '#version 300 es\n' +
        'in vec2 uv;\n' +
        'in vec2 position;\n' +
        'out vec2 vUv;\n' +
        'void main() {\n' +
        '  vUv = uv;\n' +
        '  gl_Position = vec4(position, 0., 1.);\n' +
        '}';

      var dotFragmentShader = '#version 300 es\n' +
        'precision highp float;\n' +
        'uniform vec2 uResolution;\n' +
        'uniform sampler2D uTexture;\n' +
        'uniform int uPaletteCount;\n' +
        'uniform vec3 uPalette[10];\n' +
        'uniform float uPaletteAlpha[10];\n' +
        'uniform float uCellSize;\n' +
        'uniform float uGamma;\n' +
        'uniform float uPaletteBias;\n' +
        'out vec4 fragColor;\n' +
        '\n' +
        'void main() {\n' +
        '  vec2 pix = gl_FragCoord.xy;\n' +
        '  float cell = max(uCellSize, 1.0);\n' +
        '\n' +
        '  vec2 cellIdx = floor(pix / cell);\n' +
        '  vec2 cellCenter = (cellIdx + 0.5) * cell;\n' +
        '  vec3 col = texture(uTexture, cellCenter / uResolution.xy).rgb;\n' +
        '  float gray = 0.3 * col.r + 0.59 * col.g + 0.11 * col.b;\n' +
        '  gray = pow(clamp(gray, 0.0001, 1.0), uGamma);\n' +
        '\n' +
        '  vec2 cellUV = fract(pix / cell) - 0.5;\n' +
        '  float dist = length(cellUV);\n' +
        '  float radius = clamp(gray + uPaletteBias, 0.0, 1.0) * 0.5;\n' +
        '  float aa = fwidth(dist) + 1e-4;\n' +
        '  float mark = 1.0 - smoothstep(radius - aa, radius + aa, dist);\n' +
        '\n' +
        '  float g2 = clamp(gray + uPaletteBias, 0.0, 1.0);\n' +
        '  int cnt = max(uPaletteCount, 1);\n' +
        '  vec3 dotCol;\n' +
        '  float dotOpacity;\n' +
        '  if (cnt <= 1) {\n' +
        '    dotCol = uPalette[0];\n' +
        '    dotOpacity = uPaletteAlpha[0];\n' +
        '  } else {\n' +
        '    float scaled = g2 * float(cnt - 1);\n' +
        '    int seg = int(floor(scaled));\n' +
        '    seg = clamp(seg, 0, cnt - 2);\n' +
        '    float f = clamp(scaled - float(seg), 0.0, 1.0);\n' +
        '    dotCol = mix(uPalette[seg], uPalette[seg + 1], f);\n' +
        '    dotOpacity = mix(uPaletteAlpha[seg], uPaletteAlpha[seg + 1], f);\n' +
        '  }\n' +
        '  fragColor = vec4(dotCol, mark * dotOpacity);\n' +
        '}';

      function compile(type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          console.error('[ChromaticWaves] shader compile error:', gl.getShaderInfoLog(sh));
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      }

      function createProgram(vsSrc, fsSrc) {
        var vs = compile(gl.VERTEX_SHADER, vsSrc);
        var fs = compile(gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return null;
        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, 'position');
        gl.bindAttribLocation(prog, 1, 'uv');
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
          console.error('[ChromaticWaves] program link error:', gl.getProgramInfoLog(prog));
          return null;
        }
        return prog;
      }

      var perlinProgram = createProgram(perlinVertexShader, perlinFragmentShader);
      var dotProgram = createProgram(dotVertexShader, dotFragmentShader);
      if (!perlinProgram || !dotProgram) { host.remove(); return; }

      // Triangle plein écran (évite la couture d'un quad à 2 triangles)
      var quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 0, 0,
         3, -1, 2, 0,
        -1,  3, 0, 2,
      ]), gl.STATIC_DRAW);
      var quadVAO = gl.createVertexArray();
      gl.bindVertexArray(quadVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
      gl.bindVertexArray(null);

      var rtTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, rtTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      var fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtTexture, 0);
      var fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) { host.remove(); return; }

      // Réglages ajustables via la roue de settings (apps/polymarket/polymarket_capital.js)
      // — valeurs par défaut reprises du kit fourni, persistées en localStorage.
      function mapLinear(v, inMin, inMax, outMin, outMax) {
        if (inMax === inMin) return outMin;
        var t = (v - inMin) / (inMax - inMin);
        return outMin + t * (outMax - outMin);
      }
      function hexToRgb01(hex) {
        hex = hex.replace('#', '');
        return [
          parseInt(hex.slice(0, 2), 16) / 255,
          parseInt(hex.slice(2, 4), 16) / 255,
          parseInt(hex.slice(4, 6), 16) / 255,
        ];
      }

      var LS_KEY = 'polymarket_bg_settings';
      var DEFAULTS = {
        frequency: 1, speed: 4, cellSize: 34, gamma: 6, paletteBias: -3,
        color1: '#c4b5fd', alpha1: 0.45,
        color2: '#a78bfa', alpha2: 0.50,
        color3: '#06b6d4', alpha3: 0.40,
      };
      function loadSettings() {
        var s = Object.assign({}, DEFAULTS);
        try {
          var raw = localStorage.getItem(LS_KEY);
          if (raw) Object.assign(s, JSON.parse(raw));
        } catch (e) {}
        return s;
      }
      function persistSettings() {
        try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {}
      }
      var settings = loadSettings();

      var MAX_COLORS = 10;
      var paletteRgb = new Float32Array(MAX_COLORS * 3);
      var paletteAlpha = new Float32Array(MAX_COLORS);

      var perlinU = {
        uTime: gl.getUniformLocation(perlinProgram, 'uTime'),
        uFrequency: gl.getUniformLocation(perlinProgram, 'uFrequency'),
        uSpeed: gl.getUniformLocation(perlinProgram, 'uSpeed'),
        uValue: gl.getUniformLocation(perlinProgram, 'uValue'),
        uResolution: gl.getUniformLocation(perlinProgram, 'uResolution'),
      };
      var dotU = {
        uResolution: gl.getUniformLocation(dotProgram, 'uResolution'),
        uTexture: gl.getUniformLocation(dotProgram, 'uTexture'),
        uPaletteCount: gl.getUniformLocation(dotProgram, 'uPaletteCount'),
        uPalette: gl.getUniformLocation(dotProgram, 'uPalette'),
        uPaletteAlpha: gl.getUniformLocation(dotProgram, 'uPaletteAlpha'),
        uCellSize: gl.getUniformLocation(dotProgram, 'uCellSize'),
        uGamma: gl.getUniformLocation(dotProgram, 'uGamma'),
        uPaletteBias: gl.getUniformLocation(dotProgram, 'uPaletteBias'),
      };

      function applyUniforms() {
        var cols = [
          { hex: settings.color1, alpha: settings.alpha1 },
          { hex: settings.color2, alpha: settings.alpha2 },
          { hex: settings.color3, alpha: settings.alpha3 },
        ];
        for (var i = 0; i < cols.length; i++) {
          var rgb = hexToRgb01(cols[i].hex);
          paletteRgb[i * 3] = rgb[0];
          paletteRgb[i * 3 + 1] = rgb[1];
          paletteRgb[i * 3 + 2] = rgb[2];
          paletteAlpha[i] = cols[i].alpha;
        }

        gl.useProgram(perlinProgram);
        gl.uniform1f(perlinU.uFrequency, mapLinear(settings.frequency, 1, 10, 0.3, 6));
        gl.uniform1f(perlinU.uSpeed, settings.speed * 0.05);
        gl.uniform1f(perlinU.uValue, 1);

        gl.useProgram(dotProgram);
        gl.uniform1i(dotU.uPaletteCount, cols.length);
        gl.uniform3fv(dotU.uPalette, paletteRgb);
        gl.uniform1fv(dotU.uPaletteAlpha, paletteAlpha);
        gl.uniform1f(dotU.uCellSize, mapLinear(settings.cellSize, 1, 100, 6, 60));
        gl.uniform1f(dotU.uGamma, mapLinear(settings.gamma, 1, 20, 0.5, 8));
        gl.uniform1f(dotU.uPaletteBias, settings.paletteBias * 0.05);
      }
      applyUniforms();

      window.ChromaticWaves = {
        defaults: Object.assign({}, DEFAULTS),
        getSettings: function () { return Object.assign({}, settings); },
        setSettings: function (partial) {
          Object.assign(settings, partial);
          applyUniforms();
          persistSettings();
        },
        resetSettings: function () {
          settings = Object.assign({}, DEFAULTS);
          applyUniforms();
          persistSettings();
          return Object.assign({}, settings);
        },
      };

      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      function resize() {
        var w = Math.max(1, Math.floor(host.clientWidth * dpr));
        var h = Math.max(1, Math.floor(host.clientHeight * dpr));
        if (canvas.width === w && canvas.height === h) return;
        canvas.width = w;
        canvas.height = h;
        gl.bindTexture(gl.TEXTURE_2D, rtTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      resize();
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(resize).observe(host);
      }
      window.addEventListener('resize', resize);

      var lastTime = 0;
      var frameInterval = 1000 / 30;
      function frame(time) {
        requestAnimationFrame(frame);
        if (time - lastTime < frameInterval) return;
        lastTime = time;
        resize();
        var w = canvas.width, h = canvas.height;

        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(perlinProgram);
        gl.uniform1f(perlinU.uTime, time * 0.001);
        gl.uniform2f(perlinU.uResolution, w, h);
        gl.bindVertexArray(quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(dotProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, rtTexture);
        gl.uniform1i(dotU.uTexture, 0);
        gl.uniform2f(dotU.uResolution, w, h);
        gl.bindVertexArray(quadVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      requestAnimationFrame(frame);
    } catch (e) {
      console.error('[ChromaticWaves] init failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
