'use strict';
/* =====================================================================
   WebGL effect engine: multi-pass fragment shader pipeline with
   ping-pong framebuffers. Each effect is a GLSL fragment shader whose
   uniforms are generated from a parameter schema.
   ===================================================================== */
const GL = (() => {
  let canvas = null, gl = null, ok = null, quad = null, srcTex = null, fbs = [], W = 0, H = 0;
  const progs = new Map();
  const VS = 'attribute vec2 p; varying vec2 v; void main(){ v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }';
  const HEAD = `precision highp float;
varying vec2 v; uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_time;
float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
float lum(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
vec4 T(vec2 uv){ return texture2D(u_tex, clamp(uv, 0., 1.)); }
vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0., -1./3., 2./3., -1.); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6. * d + e)), d / (q.x + e), q.x); }
vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1., 2./3., 1./3., 3.); vec3 p = abs(fract(c.xxx + K.xyz) * 6. - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0., 1.), c.y); }
`;
  function init() {
    if (ok !== null) return ok;
    try {
      canvas = document.createElement('canvas');
      gl = canvas.getContext('webgl', { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: true, antialias: false });
      if (!gl) return ok = false;
      quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      srcTex = mkTex();
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ok = null; progs.clear(); fbs = []; W = H = 0; });
      return ok = true;
    } catch (e) { console.warn('WebGL niet beschikbaar', e); return ok = false; }
  }
  function mkTex() {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function size(w, h) {
    if (w === W && h === H) return;
    W = w; H = h; canvas.width = w; canvas.height = h;
    fbs.forEach(f => { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); });
    fbs = [0, 1].map(() => {
      const tex = mkTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fb, tex };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  function shader(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  }
  function program(key, frag) {
    if (progs.has(key)) return progs.get(key);
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, HEAD + frag));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const o = { p, loc: {} }; progs.set(key, o); return o;
  }
  function loc(pr, name) { if (!(name in pr.loc)) pr.loc[name] = gl.getUniformLocation(pr.p, name); return pr.loc[name]; }
  /** Run passes [{key, frag, u:{name:value}}] over `source`; returns the GL canvas (or null). */
  function run(source, w, h, passes, time) {
    if (!passes.length || !init()) return null;
    try {
      size(w, h);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.BLEND);
      let input = srcTex;
      passes.forEach((ps, i) => {
        const last = i === passes.length - 1, target = last ? null : fbs[i % 2];
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
        gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        const pr = program(ps.key, ps.frag); gl.useProgram(pr.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input);
        gl.uniform1i(loc(pr, 'u_tex'), 0); gl.uniform2f(loc(pr, 'u_res'), w, h); gl.uniform1f(loc(pr, 'u_time'), time || 0);
        for (const [n, val] of Object.entries(ps.u || {})) {
          const l = loc(pr, n); if (!l) continue;
          if (Array.isArray(val)) val.length === 3 ? gl.uniform3f(l, val[0], val[1], val[2]) : gl.uniform2f(l, val[0], val[1]);
          else gl.uniform1f(l, +val || 0);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        input = target ? target.tex : null;
      });
      return canvas;
    } catch (e) { console.warn(e); return null; }
  }
  return { run, available: () => init() };
})();

/* ---------------- effect registry ---------------- */
// param: [label, min, max, step, default]  |  ['color', label, default]
const FX = {};
function defFx(key, name, icon, cat, params, body) {
  const decl = Object.entries(params).map(([k, p]) => `uniform ${p[0] === 'color' ? 'vec3' : 'float'} u_${k};`).join('\n');
  FX[key] = { key, name, icon, cat, params, frag: decl + '\n' + body };
}
function fxDefaults(key) { const o = {}; for (const [k, p] of Object.entries(FX[key].params)) o[k] = p[0] === 'color' ? p[2] : p[4]; return o; }
function fxUniforms(key, p) { const u = {}; for (const [k, d] of Object.entries(FX[key].params)) u['u_' + k] = d[0] === 'color' ? hex2vec(p[k] ?? d[2]) : (p[k] ?? d[4]); return u; }

defFx('grade', 'Kleurcorrectie', '🎛', 'Kleur', { exposure: ['Belichting', -2, 2, .01, 0], temp: ['Temperatuur', -1, 1, .01, 0], tint: ['Tint (groen/magenta)', -1, 1, .01, 0], vibrance: ['Levendigheid', -1, 1, .01, 0], shadows: ['Schaduwen', -1, 1, .01, 0], highlights: ['Hoge lichten', -1, 1, .01, 0], gamma: ['Gamma', .3, 2.5, .01, 1] }, `
void main(){ vec4 c = T(v); vec3 x = c.rgb * pow(2., u_exposure);
 x += vec3(u_temp * .1, u_tint * -.08, -u_temp * .1);
 float l = lum(x); x += u_shadows * .35 * (1. - smoothstep(0., .5, l)); x += u_highlights * .35 * smoothstep(.5, 1., l);
 float mx = max(x.r, max(x.g, x.b)), mn = min(x.r, min(x.g, x.b)); float sat = mx - mn; x = mix(vec3(lum(x)), x, 1. + u_vibrance * (1. - sat));
 x = pow(clamp(x, 0., 1.), vec3(1. / u_gamma)); gl_FragColor = vec4(x, c.a); }`);
defFx('duotone', 'Duotoon', '🌓', 'Kleur', { c1: ['color', 'Schaduwkleur', '#1b0a4a'], c2: ['color', 'Lichtkleur', '#ffb36b'], amount: ['Sterkte', 0, 1, .01, 1] }, `
void main(){ vec4 c = T(v); vec3 d = mix(u_c1, u_c2, lum(c.rgb)); gl_FragColor = vec4(mix(c.rgb, d, u_amount), c.a); }`);
defFx('posterize', 'Posterize', '🎨', 'Kleur', { levels: ['Niveaus', 2, 16, 1, 5] }, `
void main(){ vec4 c = T(v); gl_FragColor = vec4(floor(c.rgb * u_levels + .5) / u_levels, c.a); }`);
defFx('rainbow', 'Regenboog-shift', '🌈', 'Kleur', { speed: ['Snelheid', 0, 3, .01, .5], amount: ['Sterkte', 0, 1, .01, 1] }, `
void main(){ vec4 c = T(v); vec3 h = rgb2hsv(c.rgb); h.x = fract(h.x + u_time * u_speed + v.x * .3); gl_FragColor = vec4(mix(c.rgb, hsv2rgb(h), u_amount), c.a); }`);
defFx('thermal', 'Warmtecamera', '🌡', 'Kleur', {}, `
void main(){ vec4 c = T(v); float l = lum(c.rgb); vec3 a = vec3(0., 0., .5), b = vec3(.9, 0., .9), d = vec3(1., .2, 0.), e = vec3(1., 1., .2);
 vec3 o = l < .33 ? mix(a, b, l * 3.) : l < .66 ? mix(b, d, (l - .33) * 3.) : mix(d, e, (l - .66) * 3.); gl_FragColor = vec4(o, c.a); }`);
defFx('night', 'Nachtzicht', '🌙', 'Kleur', { amount: ['Ruis', 0, 1, .01, .3] }, `
void main(){ vec4 c = T(v); float l = lum(c.rgb) * 1.6; l += (rnd(v * u_res + u_time) - .5) * u_amount * .5; float vg = 1. - smoothstep(.35, .75, length(v - .5));
 gl_FragColor = vec4(vec3(.1, 1., .2) * l * vg, c.a); }`);
defFx('lumakey', 'Luma-key (zwart weg)', '⬛', 'Sleutel', { threshold: ['Drempel', 0, 1, .01, .1], soft: ['Zachtheid', 0, .5, .01, .1], invert: ['Omkeren (wit weg)', 0, 1, 1, 0] }, `
void main(){ vec4 c = T(v); float l = lum(c.rgb); if (u_invert > .5) l = 1. - l; float a = smoothstep(u_threshold, u_threshold + u_soft + .001, l); gl_FragColor = vec4(c.rgb, c.a * a); }`);
defFx('pixelate', 'Pixeleren', '🟪', 'Stijl', { size: ['Blokgrootte', 2, 80, 1, 14] }, `
void main(){ vec2 b = u_size / u_res; gl_FragColor = T((floor(v / b) + .5) * b); }`);
defFx('halftone', 'Rasterpunten', '⚫', 'Stijl', { size: ['Puntgrootte', 3, 40, 1, 9], color: ['Kleur behouden', 0, 1, 1, 1] }, `
void main(){ vec2 px = v * u_res; float s = u_size; mat2 r = mat2(.707, -.707, .707, .707); vec2 q = r * px; vec2 cell = (floor(q / s) + .5) * s; vec2 ctr = (cell * r);
 vec4 c = T(ctr / u_res); float l = lum(c.rgb); float d = length(q - cell) / (s * .5); float dot_ = 1. - smoothstep(sqrt(1. - l) - .1, sqrt(1. - l) + .05, d);
 vec3 ink = u_color > .5 ? c.rgb : vec3(0.); gl_FragColor = vec4(mix(vec3(1.), ink, dot_ * .95), c.a); }`);
defFx('edges', 'Randen', '✏️', 'Stijl', { strength: ['Sterkte', 0, 5, .01, 2], mixv: ['Mengen', 0, 1, .01, 1] }, `
void main(){ vec2 p = 1. / u_res; float tl = lum(T(v + p * vec2(-1, 1)).rgb), t = lum(T(v + p * vec2(0, 1)).rgb), tr = lum(T(v + p * vec2(1, 1)).rgb), l = lum(T(v + p * vec2(-1, 0)).rgb), r = lum(T(v + p * vec2(1, 0)).rgb), bl = lum(T(v + p * vec2(-1, -1)).rgb), b = lum(T(v + p * vec2(0, -1)).rgb), br = lum(T(v + p * vec2(1, -1)).rgb);
 float gx = -tl - 2. * l - bl + tr + 2. * r + br, gy = -tl - 2. * t - tr + bl + 2. * b + br; float e = clamp(length(vec2(gx, gy)) * u_strength, 0., 1.);
 vec4 c = T(v); gl_FragColor = vec4(mix(c.rgb, vec3(e), u_mixv), c.a); }`);
defFx('sketch', 'Potloodschets', '📝', 'Stijl', { strength: ['Sterkte', 0, 6, .01, 3] }, `
void main(){ vec2 p = 1. / u_res; float gx = lum(T(v + vec2(p.x, 0)).rgb) - lum(T(v - vec2(p.x, 0)).rgb), gy = lum(T(v + vec2(0, p.y)).rgb) - lum(T(v - vec2(0, p.y)).rgb);
 float e = 1. - clamp(length(vec2(gx, gy)) * u_strength * 4., 0., 1.); float paper = .95 + rnd(floor(v * u_res / 2.)) * .05; gl_FragColor = vec4(vec3(e * paper), T(v).a); }`);
defFx('emboss', 'Reliëf', '🗿', 'Stijl', { strength: ['Sterkte', 0, 5, .01, 2] }, `
void main(){ vec2 p = 1. / u_res; vec3 a = T(v - p).rgb, b = T(v + p).rgb; float e = .5 + lum(b - a) * u_strength; gl_FragColor = vec4(vec3(e), T(v).a); }`);
defFx('oldfilm', 'Oude film', '🎞', 'Retro', { amount: ['Sterkte', 0, 1, .01, .8] }, `
void main(){ vec4 c = T(v); float l = lum(c.rgb); vec3 sep = vec3(l * 1.07, l * .87, l * .65); float t = floor(u_time * 18.);
 float flick = 1. + (rnd(vec2(t, 1.)) - .5) * .18 * u_amount; float scratch = step(.996, rnd(vec2(floor(v.x * 300.), t))) * u_amount;
 float dust = step(.9993, rnd(floor(v * u_res / 3.) + t)) * u_amount; float vg = 1. - smoothstep(.3, .8, length(v - .5)) * .7 * u_amount + .0;
 vec3 o = mix(c.rgb, sep, u_amount) * flick * (1. - .3 * u_amount + .3 * u_amount * vg) + scratch * .5 - dust;
 gl_FragColor = vec4(o, c.a); }`);
defFx('vhs', 'VHS', '📼', 'Retro', { amount: ['Sterkte', 0, 1, .01, .7] }, `
void main(){ vec2 uv = v; float t = u_time; uv.x += sin(uv.y * 40. + t * 6.) * .0018 * u_amount + (rnd(vec2(floor(uv.y * 120.), floor(t * 20.))) - .5) * .004 * u_amount;
 float s = .004 * u_amount; vec4 c = T(uv); vec3 o = vec3(T(uv + vec2(s, 0)).r, c.g, T(uv - vec2(s, 0)).b);
 o = mix(vec3(lum(o)), o, 1. - .3 * u_amount); o *= 1. - .12 * u_amount * (.5 + .5 * sin(uv.y * u_res.y * 1.5)); o += (rnd(uv * u_res + t) - .5) * .12 * u_amount;
 float band = smoothstep(.0, .02, abs(fract(uv.y - t * .1) - .5)); o *= mix(1., .85 + .15 * band, u_amount); gl_FragColor = vec4(o, c.a); }`);
defFx('crt', 'CRT-monitor', '📺', 'Retro', { curve: ['Kromming', 0, .5, .01, .2], lines: ['Scanlijnen', 0, 1, .01, .5] }, `
void main(){ vec2 uv = v * 2. - 1.; uv *= 1. + u_curve * dot(uv, uv) * .25; uv = uv * .5 + .5; if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) { gl_FragColor = vec4(0, 0, 0, 1); return; }
 vec4 c = T(uv); vec3 o = c.rgb * (1. - u_lines * .5 * (.5 + .5 * sin(uv.y * u_res.y * 3.1416))); float m = mod(floor(uv.x * u_res.x), 3.);
 o *= mix(vec3(1.), vec3(m == 0. ? 1.2 : .8, m == 1. ? 1.2 : .8, m == 2. ? 1.2 : .8), u_lines * .6); o *= 1. - .6 * pow(length(v - .5) * 1.3, 3.); gl_FragColor = vec4(o, c.a); }`);
defFx('scanlines', 'Scanlijnen', '〰', 'Retro', { amount: ['Sterkte', 0, 1, .01, .4], count: ['Aantal', 50, 800, 1, 300] }, `
void main(){ vec4 c = T(v); gl_FragColor = vec4(c.rgb * (1. - u_amount * (.5 + .5 * sin(v.y * u_count * 6.2832))), c.a); }`);
defFx('grain', 'Filmkorrel', '🌫', 'Retro', { amount: ['Sterkte', 0, .5, .005, .12], size: ['Korrelgrootte', 1, 6, .1, 1.5] }, `
void main(){ vec4 c = T(v); float n = rnd(floor(v * u_res / u_size) + fract(u_time * 7.13) * 100.) - .5; gl_FragColor = vec4(c.rgb + n * u_amount, c.a); }`);
defFx('glitch', 'Glitch', '⚡', 'Vervorming', { amount: ['Sterkte', 0, 1, .01, .5], speed: ['Snelheid', 0, 10, .1, 4] }, `
void main(){ float t = floor(u_time * u_speed * 3.); vec2 uv = v; float line = floor(uv.y * 28.); float r = rnd(vec2(line, t));
 if (r < u_amount * .45) uv.x += (rnd(vec2(t, line * 1.7)) - .5) * u_amount * .25;
 float blk = step(1. - u_amount * .08, rnd(floor(v * vec2(10., 14.)) + t)); float s = u_amount * .025 * (rnd(vec2(t, 3.)) + .2);
 vec4 c = T(uv); vec3 o = vec3(T(uv + vec2(s, 0)).r, c.g, T(uv - vec2(s, 0)).b); o = mix(o, 1. - o, blk); gl_FragColor = vec4(o, c.a); }`);
defFx('rgbsplit', 'RGB-splitsing', '🔴', 'Vervorming', { amount: ['Afstand', 0, .05, .0005, .01], angle: ['Hoek', 0, 6.283, .01, 0] }, `
void main(){ vec2 o = vec2(cos(u_angle), sin(u_angle)) * u_amount; vec4 c = T(v); gl_FragColor = vec4(T(v + o).r, c.g, T(v - o).b, max(c.a, max(T(v + o).a, T(v - o).a))); }`);
defFx('wave', 'Golf', '🌊', 'Vervorming', { amp: ['Amplitude', 0, .1, .001, .02], freq: ['Frequentie', 1, 60, .1, 12], speed: ['Snelheid', 0, 10, .1, 3] }, `
void main(){ vec2 uv = v; uv.x += sin(uv.y * u_freq + u_time * u_speed) * u_amp; uv.y += cos(uv.x * u_freq * .7 + u_time * u_speed) * u_amp * .5; gl_FragColor = T(uv); }`);
defFx('swirl', 'Draaikolk', '🌀', 'Vervorming', { strength: ['Sterkte', -10, 10, .1, 4], radius: ['Straal', .05, 1, .01, .45] }, `
void main(){ vec2 a = vec2(u_res.x / u_res.y, 1.); vec2 p = (v - .5) * a; float d = length(p); if (d < u_radius) { float k = (u_radius - d) / u_radius; float an = k * k * u_strength; float s = sin(an), cc = cos(an); p = mat2(cc, -s, s, cc) * p; } gl_FragColor = T(p / a + .5); }`);
defFx('bulge', 'Vissenoog / bol', '🐟', 'Vervorming', { strength: ['Sterkte', -1, 1, .01, .5] }, `
void main(){ vec2 a = vec2(u_res.x / u_res.y, 1.); vec2 p = (v - .5) * a; float d = length(p); p *= 1. + u_strength * (d * d - .25); gl_FragColor = T(p / a + .5); }`);
defFx('kaleido', 'Caleidoscoop', '❄️', 'Vervorming', { segments: ['Segmenten', 2, 16, 1, 6], spin: ['Draaisnelheid', -2, 2, .01, .2] }, `
void main(){ vec2 a = vec2(u_res.x / u_res.y, 1.); vec2 p = (v - .5) * a; float r = length(p), th = atan(p.y, p.x) + u_time * u_spin; float seg = 6.2832 / u_segments; th = mod(th, seg); th = abs(th - seg * .5);
 gl_FragColor = T(vec2(cos(th), sin(th)) * r / a + .5); }`);
defFx('mirror', 'Spiegelen', '🪞', 'Vervorming', { mode: ['Modus (0 L, 1 R, 2 B, 3 O, 4 kwart)', 0, 4, 1, 0] }, `
void main(){ vec2 uv = v; float m = u_mode; if (m < .5) uv.x = uv.x > .5 ? 1. - uv.x : uv.x; else if (m < 1.5) uv.x = uv.x < .5 ? 1. - uv.x : uv.x; else if (m < 2.5) uv.y = uv.y < .5 ? 1. - uv.y : uv.y; else if (m < 3.5) uv.y = uv.y > .5 ? 1. - uv.y : uv.y; else { uv = abs(uv - .5) * 2.; uv = 1. - uv; uv *= .5; }
 gl_FragColor = T(uv); }`);
defFx('zoomblur', 'Zoomvervaging', '💫', 'Vervaging', { amount: ['Sterkte', 0, .5, .005, .15] }, `
void main(){ vec4 acc = vec4(0.); vec2 d = v - .5; for (int i = 0; i < 16; i++) { float k = 1. - u_amount * float(i) / 15.; acc += T(.5 + d * k); } gl_FragColor = acc / 16.; }`);
defFx('motionblur', 'Bewegingsvervaging', '💨', 'Vervaging', { amount: ['Lengte', 0, .08, .001, .02], angle: ['Hoek', 0, 6.283, .01, 0] }, `
void main(){ vec4 acc = vec4(0.); vec2 d = vec2(cos(u_angle), sin(u_angle)) * u_amount; for (int i = 0; i < 16; i++) acc += T(v + d * (float(i) / 15. - .5)); gl_FragColor = acc / 16.; }`);
defFx('tiltshift', 'Tilt-shift (miniatuur)', '🏙', 'Vervaging', { focus: ['Focuspositie', 0, 1, .01, .5], width: ['Scherpe zone', 0, .5, .01, .15], blur: ['Vervaging', 0, 20, .1, 8] }, `
void main(){ float k = smoothstep(u_width, u_width + .25, abs(v.y - u_focus)); vec2 p = u_blur * k / u_res; vec4 acc = vec4(0.); float n = 0.;
 for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) { acc += T(v + vec2(float(x), float(y)) * p); n += 1.; } vec4 c = acc / n; c.rgb = mix(vec3(lum(c.rgb)), c.rgb, 1.25); gl_FragColor = c; }`);
defFx('bloom', 'Gloed (bloom)', '✨', 'Licht', { amount: ['Sterkte', 0, 2, .01, .8], threshold: ['Drempel', 0, 1, .01, .6], radius: ['Straal', 1, 20, .1, 6] }, `
void main(){ vec4 c = T(v); vec3 acc = vec3(0.); float n = 0.; for (int i = 0; i < 24; i++) { float a = float(i) * 2.399; float r = sqrt(float(i) / 24.) * u_radius; vec3 s = T(v + vec2(cos(a), sin(a)) * r * 3. / u_res).rgb; acc += max(s - u_threshold, 0.); n += 1.; }
 gl_FragColor = vec4(c.rgb + acc / n * u_amount * 3., c.a); }`);
defFx('lightleak', 'Lichtlek', '🌅', 'Licht', { amount: ['Sterkte', 0, 1, .01, .6], speed: ['Snelheid', 0, 2, .01, .3], color: ['color', 'Kleur', '#ff7a2f'] }, `
void main(){ vec4 c = T(v); float t = u_time * u_speed; vec2 p1 = vec2(.2 + .3 * sin(t), .8 + .1 * cos(t * 1.3)), p2 = vec2(.9 + .1 * cos(t * .7), .3 + .3 * sin(t * .9));
 float l = smoothstep(.7, 0., length(v - p1)) + .7 * smoothstep(.6, 0., length(v - p2)); vec3 o = c.rgb + u_color * l * u_amount; o = 1. - (1. - c.rgb) * (1. - u_color * l * u_amount); gl_FragColor = vec4(o, c.a); }`);
defFx('sharpen', 'Verscherpen', '🔪', 'Licht', { amount: ['Sterkte', 0, 3, .01, 1] }, `
void main(){ vec2 p = 1. / u_res; vec4 c = T(v); vec3 b = (T(v + vec2(p.x, 0)).rgb + T(v - vec2(p.x, 0)).rgb + T(v + vec2(0, p.y)).rgb + T(v - vec2(0, p.y)).rgb) * .25; gl_FragColor = vec4(c.rgb + (c.rgb - b) * u_amount, c.a); }`);
/* built-in passes used by clip properties (not listed in the effect browser) */
const FX_BUILTIN = {
  chroma: `uniform vec3 u_key; uniform float u_tol; uniform float u_soft;
void main(){ vec4 c = T(v); float cb = -.169 * c.r - .331 * c.g + .5 * c.b, cr = .5 * c.r - .419 * c.g - .081 * c.b; float kcb = -.169 * u_key.r - .331 * u_key.g + .5 * u_key.b, kcr = .5 * u_key.r - .419 * u_key.g - .081 * u_key.b;
 float d = distance(vec2(cb, cr), vec2(kcb, kcr)); float a = smoothstep(u_tol, u_tol + u_soft, d); vec3 o = c.rgb;
 if (u_key.g > u_key.r && u_key.g > u_key.b) o.g = mix(min(o.g, max(o.r, o.b)), o.g, a); if (u_key.b > u_key.r && u_key.b > u_key.g) o.b = mix(min(o.b, max(o.r, o.g)), o.b, a);
 gl_FragColor = vec4(o, c.a * a); }`,
  tint: `uniform vec3 u_col; uniform float u_amt; void main(){ vec4 c = T(v); gl_FragColor = vec4(mix(c.rgb, c.rgb * .4 + u_col * .6 * (.4 + lum(c.rgb)), u_amt), c.a); }`,
  vignette: `uniform float u_amt; void main(){ vec4 c = T(v); vec2 a = vec2(u_res.x / u_res.y, 1.); float d = length((v - .5) * a) / length(.5 * a); gl_FragColor = vec4(c.rgb * (1. - u_amt * smoothstep(.45, 1., d)), c.a); }`,
};
const FX_CATS = ['Kleur', 'Sleutel', 'Stijl', 'Retro', 'Vervorming', 'Vervaging', 'Licht'];
