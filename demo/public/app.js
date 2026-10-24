'use strict';

const $ = (id) => document.getElementById(id);
const P = Huella.PARAMS;
const FS = P.fs; // 8000 Hz
const HOP = P.hop;
const KMAX = 256; // se muestran 0–2 kHz
const RANGO_DB = 70;

let catalogo = [];
const cacheAudio = new Map();
let ctxAudio = null;
let ocupado = false;
let vista3d = null; // instancia de spectro3d.js (si WebGL está disponible)
let modoVista = '3d';
let ultima = null; // { x, h:{S,picos,huellas}, pares, resultado, cache2d }
let reproduccion = null;

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const mmss = (s) => (s < 0 ? '—' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
const pausa = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const obtenerCtx = () => (ctxAudio = ctxAudio || new (window.AudioContext || window.webkitAudioContext)());
const fmt = (n, d = 0) => Number(n).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });

function estado(msg) {
  $('estado').textContent = msg || '';
}

/* ================================================================== tema */
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  try { localStorage.setItem('tema', t); } catch (e) { /* sin almacenamiento */ }
  $('tema-ico').setAttribute(
    'd',
    t === 'oscuro'
      ? 'M12 4V2m0 20v-2M4 12H2m20 0h-2M5.6 5.6 4.2 4.2m15.6 15.6-1.4-1.4M5.6 18.4l-1.4 1.4m15.6-15.6-1.4 1.4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z'
      : 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'
  );
  $('tema-ico').setAttribute('fill', t === 'oscuro' ? 'none' : 'currentColor');
  $('tema-ico').setAttribute('stroke', t === 'oscuro' ? 'currentColor' : 'none');
  $('tema-ico').setAttribute('stroke-width', '2');
  $('tema-ico').setAttribute('stroke-linecap', 'round');
  vista3d?.aplicarTema();
  redibujar();
}
$('tema').addEventListener('click', () => aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro'));

/* ================================================================== audio */
function parsearWav(buffer) {
  const v = new DataView(buffer);
  const txt = (o, n) => String.fromCharCode(...new Uint8Array(buffer, o, n));
  if (txt(0, 4) !== 'RIFF' || txt(8, 4) !== 'WAVE') throw new Error('WAV inválido');
  const n = (buffer.byteLength - 44) / 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = v.getInt16(44 + 2 * i, true) / 32767;
  return { x, fs: v.getUint32(24, true) };
}

async function cargarCancion(c) {
  if (!cacheAudio.has(c.id)) {
    const resp = await fetch(`/audio/${c.archivo}`);
    if (!resp.ok) throw new Error('No se pudo descargar el audio de la canción');
    cacheAudio.set(c.id, parsearWav(await resp.arrayBuffer()).x);
  }
  return cacheAudio.get(c.id);
}

/** Convierte un AudioBuffer cualquiera a mono de 8 kHz (remuestreo con OfflineAudioContext). */
async function a8k(audioBuffer) {
  const n = Math.max(1, Math.ceil(audioBuffer.duration * FS));
  const off = new OfflineAudioContext(1, n, FS);
  const fuente = off.createBufferSource();
  fuente.buffer = audioBuffer;
  fuente.connect(off.destination);
  fuente.start();
  return (await off.startRendering()).getChannelData(0);
}

async function decodificar(arrayBuffer) {
  let buf;
  try {
    buf = await obtenerCtx().decodeAudioData(arrayBuffer);
  } catch (e) {
    throw new Error('No se pudo decodificar el audio. Prueba con otro formato (WAV, MP3, OGG).');
  }
  return a8k(buf);
}

function agregarRuido(x, snrDb) {
  let pot = 0;
  for (let i = 0; i < x.length; i++) pot += x[i] * x[i];
  pot /= x.length || 1;
  const sigma = Math.sqrt(pot / 10 ** (snrDb / 10));
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const u = Math.max(Math.random(), 1e-12);
    y[i] = x[i] + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
  }
  return y;
}

/* ================================================================== pares de picos (mismos que forman los hashes) */
function calcularPares(p) {
  const { fan, dtMax } = P;
  const out = [];
  for (let i = 0; i < p.t.length; i++) {
    if (p.k[i] >= KMAX) continue;
    let cuenta = 0;
    for (let j = i + 1; j < p.t.length && cuenta < fan; j++) {
      const dt = p.t[j] - p.t[i];
      if (dt > dtMax) break;
      if (dt < 1) continue;
      cuenta++;
      if (p.k[j] < KMAX) out.push([i, j]);
    }
  }
  return out;
}

/* ================================================================== etapas didácticas */
const EXPLICACIONES = () => ({
  1: ['Señal', `El audio se convierte a mono y se remuestrea a ${fmt(FS)} Hz: solo importa la banda de 0 a ${fmt(FS / 2000)} kHz, donde viven la melodía y sus primeros armónicos.`],
  2: ['FFT', `Se corta la señal en ventanas de Hann de ${P.N} muestras (${fmt((1000 * P.N) / FS)} ms), una cada ${fmt((1000 * HOP) / FS)} ms, y a cada una se le aplica la FFT. Apiladas forman el espectrograma: color y altura = potencia en dB.`],
  3: ['Picos', 'Se conservan solo los máximos locales del espectrograma (esferas rojas). Es la «constelación» de la canción: resiste el ruido porque los picos fuertes siguen siendo los más fuertes.'],
  4: ['Hashes', `Cada pico (ancla) se une con los siguientes de una zona objetivo (líneas azules). Cada par (f₁, f₂, Δt) da un hash de 24 bits que no depende del instante absoluto del fragmento.`],
  5: ['Votación', 'Cada hash recupera en el servidor las canciones que lo contienen y vota por el desplazamiento t_bd − t_consulta. La canción verdadera concentra los votos en un solo desplazamiento.'],
});

function marcarPasos(activo, hechos) {
  document.querySelectorAll('#pasos button').forEach((b) => {
    const n = Number(b.dataset.paso);
    b.classList.toggle('activo', n === activo);
    b.classList.toggle('hecho', hechos.includes(n));
  });
}

function mostrarExplicacion(n) {
  const e = EXPLICACIONES()[n];
  $('explica').innerHTML = n ? `<b>${n}. ${e[0]}.</b> ${e[1]}` : 'Elige una fuente de audio y pulsa <b>Reconocer</b>. Después puedes pulsar cada etapa para ver qué hace el algoritmo.';
}

function irAPaso(n, { desdeUsuario = false } = {}) {
  mostrarExplicacion(n);
  const hechos = ultima?.resultado ? [1, 2, 3, 4, 5] : ultima?.h ? [1, 2, 3, 4] : [];
  marcarPasos(n, hechos);
  if (!desdeUsuario || !ultima?.h) return;
  // Cada etapa muestra lo que corresponde en el visor
  if (n === 1) $('cv-onda').scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (n === 2) { $('ver-picos').checked = false; $('ver-pares').checked = false; }
  if (n === 3) { $('ver-picos').checked = true; $('ver-pares').checked = false; }
  if (n === 4) { $('ver-picos').checked = true; $('ver-pares').checked = true; }
  if (n === 5) $('cv-hist').scrollIntoView({ behavior: 'smooth', block: 'center' });
  aplicarOverlays();
}
document.querySelectorAll('#pasos button').forEach((b) => b.addEventListener('click', () => irAPaso(Number(b.dataset.paso), { desdeUsuario: true })));

function metricas(h, r) {
  $('m1').textContent = ultima ? `${fmt(ultima.x.length / FS, 1)} s · ${fmt(FS / 1000)} kHz` : `${fmt(FS / 1000)} kHz`;
  $('m2').textContent = h ? `${h.S.length} ventanas` : 'ventana Hann';
  $('m3').textContent = h ? `${h.picos.t.length} picos` : 'máximos locales';
  $('m4').textContent = h ? `${h.huellas.length} hashes` : 'pares de picos';
  $('m5').textContent = r ? (r.mejor ? `${r.mejor.puntaje} votos` : 'sin votos') : 'índice invertido';
}

/* ================================================================== visor: 3D / 2D */
function duracionEspectro() {
  return (ultima.h.S.length * HOP) / FS;
}

async function iniciar3D() {
  try {
    const mod = await import('/spectro3d.js');
    vista3d = mod.crearEspectro3D($('lienzo3d'), { alPasar: mostrarTip });
    vista3d.fijarEscala(Number($('altura').value));
    vista3d.giroAutomatico($('giro').checked);
    vista3d.visible(modoVista === '3d');
  } catch (e) {
    console.warn('No se pudo iniciar el espectrograma 3D:', e);
    vista3d = null;
    $('aviso3d').hidden = false;
    $('aviso3d').textContent = 'No se pudo iniciar la vista 3D (¿WebGL desactivado?). Se muestra la vista 2D.';
    cambiarVista('2d');
    document.querySelector('[data-vista="3d"]').disabled = true;
  }
}

function cambiarVista(v) {
  modoVista = v;
  document.querySelectorAll('[data-vista]').forEach((b) => b.classList.toggle('activa', b.dataset.vista === v));
  $('lienzo3d').hidden = v !== '3d';
  $('cv-espectro').hidden = v !== '2d';
  $('controles3d').hidden = v !== '3d';
  $('ayuda-3d').hidden = v !== '3d';
  $('escala').hidden = v !== '3d' || !ultima?.h;
  vista3d?.visible(v === '3d');
  mostrarTip(null);
  if (v === '2d') dibujar2D();
}

function aplicarOverlays() {
  vista3d?.mostrarPicos($('ver-picos').checked);
  vista3d?.mostrarPares($('ver-pares').checked);
  if (modoVista === '2d') dibujar2D();
}

function actualizarEspectro() {
  const h = ultima.h;
  $('vacio').hidden = true;
  $('escala').hidden = modoVista !== '3d';
  ultima.cache2d = null;
  vista3d?.actualizar({ S: h.S, picos: h.picos, pares: ultima.pares, duracionS: duracionEspectro(), fs: FS, hop: HOP, N: P.N });
  aplicarOverlays();
  if (modoVista === '2d') dibujar2D();
  $('info-espectro').textContent =
    `${h.S.length} ventanas de ${P.N} muestras (${fmt((1000 * P.N) / FS)} ms), salto ${fmt((1000 * HOP) / FS)} ms · ≈ ${fmt(duracionEspectro(), 1)} s · ` +
    `eje de frecuencia 0–2 kHz (resolución ${fmt(FS / P.N, 2)} Hz/bin) · ${h.picos.t.length} picos · ${ultima.pares.length} pares`;
}

function cacheEspectrograma() {
  if (ultima.cache2d) return ultima.cache2d;
  const S = ultima.h.S;
  const T = S.length;
  let gmax = -Infinity;
  for (const f of S) for (let k = 0; k < KMAX; k++) if (f[k] > gmax) gmax = f[k];
  const cv = document.createElement('canvas');
  cv.width = T;
  cv.height = KMAX;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(T, KMAX);
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < KMAX; k++) {
      const [r, g, b] = Colores.colorMapa(Math.min(1, Math.max(0, (S[t][k] - (gmax - RANGO_DB)) / RANGO_DB)));
      const o = ((KMAX - 1 - k) * T + t) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ultima.gmax = gmax;
  return (ultima.cache2d = cv);
}

/** Lienzo con resolución real de pantalla (nítido en pantallas HiDPI). */
function preparar(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const MARGEN = { l: 46, b: 36, t: 8, r: 10 };

function dibujar2D(playF = null) {
  if (!ultima?.h || modoVista !== '2d') return;
  const cv = $('cv-espectro');
  const { ctx, w, h } = preparar(cv);
  const S = ultima.h.S;
  const T = S.length;
  const pw = w - MARGEN.l - MARGEN.r;
  const ph = h - MARGEN.t - MARGEN.b;
  ctx.fillStyle = css('--lienzo3d');
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cacheEspectrograma(), MARGEN.l, MARGEN.t, pw, ph);
  const X = (t) => MARGEN.l + (t / Math.max(1, T - 1)) * pw;
  const Y = (k) => MARGEN.t + ph - ((k + 0.5) / KMAX) * ph;
  const { picos } = ultima.h;

  if ($('ver-pares').checked) {
    ctx.strokeStyle = 'rgba(53, 214, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of ultima.pares) {
      ctx.moveTo(X(picos.t[a]), Y(picos.k[a]));
      ctx.lineTo(X(picos.t[b]), Y(picos.k[b]));
    }
    ctx.stroke();
  }
  if ($('ver-picos').checked) {
    ctx.fillStyle = '#ff3030';
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    for (let i = 0; i < picos.t.length; i++) {
      if (picos.k[i] >= KMAX) continue;
      ctx.beginPath();
      ctx.arc(X(picos.t[i]), Y(picos.k[i]), 3.2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }
  // Ejes
  ctx.fillStyle = css('--texto-suave');
  ctx.strokeStyle = css('--rejilla');
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const seg = duracionEspectro();
  const paso = seg > 12 ? 2 : 1;
  for (let s = 0; s <= seg + 1e-6; s += paso) {
    const x = X((s * FS) / HOP);
    if (x > MARGEN.l + pw + 1) continue;
    ctx.beginPath(); ctx.moveTo(x, MARGEN.t + ph); ctx.lineTo(x, MARGEN.t + ph + 4); ctx.stroke();
    ctx.fillText(String(s), x, MARGEN.t + ph + 16);
  }
  ctx.textAlign = 'right';
  for (const khz of [0, 0.5, 1, 1.5, 2]) {
    const y = MARGEN.t + ph - (khz * 1000 * P.N / FS / KMAX) * ph;
    ctx.beginPath(); ctx.moveTo(MARGEN.l - 4, y); ctx.lineTo(MARGEN.l, y); ctx.stroke();
    ctx.fillText(String(khz).replace('.', ','), MARGEN.l - 7, y + 4);
  }
  ctx.textAlign = 'center';
  ctx.fillText('Tiempo (s)', MARGEN.l + pw / 2, h - 5);
  ctx.save();
  ctx.translate(11, MARGEN.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Frecuencia (kHz)', 0, 0);
  ctx.restore();
  if (playF !== null) {
    const x = MARGEN.l + Math.min(1, Math.max(0, playF)) * pw;
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, MARGEN.t); ctx.lineTo(x, MARGEN.t + ph); ctx.stroke();
  }
}

$('cv-espectro').addEventListener('pointermove', (e) => {
  if (!ultima?.h) return;
  const r = e.currentTarget.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  const pw = r.width - MARGEN.l - MARGEN.r;
  const ph = r.height - MARGEN.t - MARGEN.b;
  const u = (px - MARGEN.l) / pw;
  const v = 1 - (py - MARGEN.t) / ph;
  if (u < 0 || u > 1 || v < 0 || v > 1) return mostrarTip(null);
  const t = Math.round(u * (ultima.h.S.length - 1));
  const k = Math.min(KMAX - 1, Math.floor(v * KMAX));
  mostrarTip({ t_s: (t * HOP) / FS, f_hz: (k * FS) / P.N, db: ultima.h.S[t][k], px, py });
});
$('cv-espectro').addEventListener('pointerleave', () => mostrarTip(null));

function mostrarTip(info) {
  const tip = $('tip');
  if (!info) { tip.hidden = true; return; }
  tip.hidden = false;
  tip.textContent = `t = ${fmt(info.t_s, 2)} s · f = ${fmt(info.f_hz)} Hz · ${fmt(info.db, 1)} dB`;
  const ancho = $('visor').clientWidth;
  tip.style.left = `${Math.min(info.px, ancho - 210)}px`;
  tip.style.top = `${info.py}px`;
}

/* ================================================================== forma de onda e histograma */
function dibujarOnda(playF = null, senal = ultima?.x) {
  if (!senal) return;
  const { ctx, w, h } = preparar($('cv-onda'));
  ctx.fillStyle = css('--lienzo');
  ctx.fillRect(0, 0, w, h);
  const x = senal;
  const mid = h / 2;
  ctx.strokeStyle = css('--rejilla');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
  const color = css('--acento');
  ctx.fillStyle = color;
  const cols = Math.floor(w);
  for (let i = 0; i < cols; i++) {
    const a = Math.floor((i / cols) * x.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / cols) * x.length));
    let mn = 1, mx = -1;
    for (let j = a; j < b; j++) { if (x[j] < mn) mn = x[j]; if (x[j] > mx) mx = x[j]; }
    const y1 = mid - mx * (mid - 4), y2 = mid - mn * (mid - 4);
    ctx.fillRect(i, y1, 1, Math.max(1, y2 - y1));
  }
  ctx.fillStyle = css('--texto-suave');
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(`${fmt(x.length / FS, 1)} s · ${fmt(FS)} Hz`, 8, 14);
  if (playF !== null) {
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 2;
    const px = Math.min(1, Math.max(0, playF)) * w;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
  }
}

function dibujarHistograma() {
  const { ctx, w, h } = preparar($('cv-hist'));
  ctx.fillStyle = css('--lienzo');
  ctx.fillRect(0, 0, w, h);
  const r = ultima?.resultado;
  ctx.font = '11px system-ui, sans-serif';
  if (!r || !r.histograma.length) {
    ctx.fillStyle = css('--texto-suave');
    ctx.fillText(r ? 'Sin coincidencias de hash' : 'Aparecerá tras reconocer', 12, h / 2);
    return;
  }
  const hist = r.histograma;
  const mejorOff = r.mejor ? r.mejor.desplazamiento : 0;
  const mL = 30, mB = 18, mT = 6;
  const xs = hist.map((p) => p[0]);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymax = Math.max(...hist.map((p) => p[1]), 5);
  const X = (o) => mL + ((o - xmin) / Math.max(1, xmax - xmin)) * (w - mL - 8);
  const Y = (c) => h - mB - (c / ymax) * (h - mB - mT);
  ctx.strokeStyle = css('--rejilla');
  ctx.fillStyle = css('--texto-suave');
  for (let i = 0; i <= 3; i++) {
    const c = Math.round((ymax * i) / 3);
    ctx.beginPath(); ctx.moveTo(mL, Y(c)); ctx.lineTo(w - 8, Y(c)); ctx.stroke();
    ctx.fillText(String(c), 3, Y(c) + 4);
  }
  for (const [o, c] of hist) {
    const gana = Math.abs(o - mejorOff) <= 1;
    ctx.strokeStyle = gana ? '#ffd23f' : css('--acento');
    ctx.lineWidth = gana ? 3 : 1;
    ctx.beginPath(); ctx.moveTo(X(o), Y(0)); ctx.lineTo(X(o), Y(c)); ctx.stroke();
  }
  ctx.lineWidth = 1;
  ctx.fillStyle = css('--texto-suave');
  ctx.textAlign = 'left';
  ctx.fillText(`${fmt((xmin * HOP) / FS, 1)} s`, mL, h - 4);
  ctx.textAlign = 'right';
  ctx.fillText(`${fmt((xmax * HOP) / FS, 1)} s`, w - 8, h - 4);
  ctx.textAlign = 'center';
  ctx.fillText('desplazamiento', w / 2, h - 4);
  ctx.textAlign = 'left';
}

function redibujar() {
  if (ultima?.x) dibujarOnda();
  else { const { ctx, w, h } = preparar($('cv-onda')); ctx.fillStyle = css('--lienzo'); ctx.fillRect(0, 0, w, h); }
  dibujarHistograma();
  if (modoVista === '2d') dibujar2D();
}
let temporizador = null;
window.addEventListener('resize', () => { clearTimeout(temporizador); temporizador = setTimeout(redibujar, 120); });

/* ================================================================== reproducción con cabezal */
const BOTONES_OIR = { oir: '▶ Escuchar', 'oir-frag': '▶ Escuchar fragmento', 'oir-completa': '▶ Canción completa' };

function restaurarBotonesOir() {
  for (const [id, texto] of Object.entries(BOTONES_OIR)) $(id).textContent = texto;
}

function detenerReproduccion() {
  if (!reproduccion) return;
  try { reproduccion.fuente.stop(); } catch (e) { /* ya terminó */ }
  cancelAnimationFrame(reproduccion.raf);
  reproduccion = null;
  vista3d?.fijarCabezal(null);
  restaurarBotonesOir();
  redibujar();
}

/**
 * Reproduce una señal de 8 kHz. Si es la señal ya analizada (`conEspectro`), el cabezal recorre también
 * el espectrograma; en cualquier caso recorre la forma de onda.
 */
async function reproducirSenal(x, idBoton, { conEspectro = false } = {}) {
  if (reproduccion) {
    const eraEste = reproduccion.idBoton === idBoton;
    detenerReproduccion();
    if (eraEste) return;
  }
  try {
    const ctx = obtenerCtx();
    if (ctx.state !== 'running') await ctx.resume();
    const buf = ctx.createBuffer(1, x.length, FS);
    buf.copyToChannel(x, 0);
    const fuente = ctx.createBufferSource();
    fuente.buffer = buf;
    const ganancia = ctx.createGain();
    ganancia.gain.value = 1;
    fuente.connect(ganancia).connect(ctx.destination);
    const dur = x.length / FS;
    const t0 = ctx.currentTime + 0.05;
    fuente.start(t0);
    reproduccion = { fuente, raf: 0, idBoton };
    $(idBoton).textContent = '■ Detener';
    fuente.onended = () => reproduccion && reproduccion.fuente === fuente && detenerReproduccion();
    const durEsp = conEspectro && ultima?.h ? ((ultima.h.S.length - 1) * HOP) / FS : 1;
    const paso = () => {
      if (!reproduccion || reproduccion.fuente !== fuente) return;
      const t = Math.max(0, ctx.currentTime - t0);
      dibujarOnda(Math.min(1, t / dur), x);
      if (conEspectro) {
        vista3d?.fijarCabezal(Math.min(1, t / durEsp));
        dibujar2D(Math.min(1, t / durEsp));
      }
      reproduccion.raf = requestAnimationFrame(paso);
    };
    paso();
  } catch (e) {
    estado(`⚠ No se pudo reproducir el audio: ${e.message}`);
  }
}

$('oir').addEventListener('click', () => ultima?.x && reproducirSenal(ultima.x, 'oir', { conEspectro: true }));

$('oir-frag').addEventListener('click', async () => {
  try {
    const { clip } = await fragmento();
    await reproducirSenal(clip, 'oir-frag');
  } catch (e) {
    estado(`⚠ ${e.message}`);
  }
});

$('oir-completa').addEventListener('click', async () => {
  try {
    const c = catalogo.find((k) => k.id === $('cancion').value);
    await reproducirSenal(await cargarCancion(c), 'oir-completa');
  } catch (e) {
    estado(`⚠ ${e.message}`);
  }
});

/* ================================================================== reconocimiento */
function mostrarResultado(r, nota) {
  ultima.resultado = r;
  $('resultado').hidden = false;
  const v = $('veredicto');
  if (r.reconocida) {
    v.textContent = `✔ ${r.mejor.nombre}`;
    v.className = 'veredicto ok';
  } else {
    v.textContent = '✖ Sin coincidencia fiable';
    v.className = 'veredicto mal';
  }
  const puntaje = r.mejor ? r.mejor.puntaje : 0;
  const escala = Math.max(puntaje, r.umbral * 3, 1);
  const barra = $('barra-puntaje');
  barra.style.width = '0%';
  barra.className = r.reconocida ? '' : 'bajo';
  requestAnimationFrame(() => requestAnimationFrame(() => (barra.style.width = `${(100 * puntaje) / escala}%`)));
  $('marca-umbral').style.left = `${(100 * r.umbral) / escala}%`;
  $('lg-puntaje').textContent = `${puntaje} votos` + (r.segundo_puntaje ? ` · 2.ª candidata: ${r.segundo_puntaje}` : '');
  $('lg-umbral').textContent = `umbral ${r.umbral}`;

  const partes = [];
  if (r.mejor && r.reconocida) partes.push(`Posición estimada en la canción: ${mmss(r.mejor.posicion_s)} (si la pieza repite frases, puede coincidir con otra aparición).`);
  if (!r.mejor) partes.push('Ningún hash coincide con la base de datos.');
  partes.push(`${r.consultas} huellas enviadas; búsqueda en el servidor: ${fmt(r.tiempo_busqueda_ms, 1)} ms.`);
  if (nota) partes.push(nota);
  $('detalle').textContent = partes.join(' ');

  $('candidatas').innerHTML = '';
  r.candidatos.forEach((c, i) => {
    const tr = document.createElement('tr');
    if (i === 0 && r.reconocida) tr.className = 'gana';
    for (const texto of [c.nombre, String(c.puntaje), mmss(c.posicion_s)]) {
      const td = document.createElement('td');
      td.textContent = texto;
      tr.appendChild(td);
    }
    $('candidatas').appendChild(tr);
  });
  dibujarHistograma();
}

async function reconocerSenal(x, nota) {
  if (x.length < P.N * 2) throw new Error('El audio es demasiado corto (mínimo ≈ 0,25 s).');
  let pot = 0;
  for (let i = 0; i < x.length; i++) pot += x[i] * x[i];
  if (pot / x.length < 1e-10) throw new Error('El audio parece estar en silencio.');
  detenerReproduccion();
  ultima = { x, h: null, pares: [], resultado: null };
  $('oir').disabled = true;
  $('resultado').hidden = true;
  metricas(null, null);

  irAPaso(1);
  estado('1. Preparando la señal…');
  dibujarOnda();
  metricas(null, null);
  await pausa(260);

  irAPaso(2);
  estado('2. Calculando la FFT de cada ventana…');
  await pausa(30);
  const h = Huella.huella(x);
  ultima.h = h;
  ultima.pares = calcularPares(h.picos);
  actualizarEspectro();
  metricas(h, null);
  await pausa(380);

  irAPaso(3);
  estado('3. Detectando picos…');
  $('oir').disabled = false;
  await pausa(380);

  irAPaso(4);
  estado(`4. Formando ${h.huellas.length} hashes…`);
  await pausa(380);

  irAPaso(5);
  estado(`5. Enviando ${h.huellas.length} huellas al servidor…`);
  const resp = await fetch('/api/reconocer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ huellas: h.huellas }),
  });
  const r = await resp.json().catch(() => ({ error: 'Respuesta no válida del servidor' }));
  if (!resp.ok) throw new Error(r.error || 'Error del servidor');
  mostrarResultado(r, nota);
  metricas(h, r);
  irAPaso(5);
  marcarPasos(0, [1, 2, 3, 4, 5]);
  $('explica').innerHTML = r.reconocida
    ? `<b>Listo.</b> La canción más votada es <b>${r.mejor.nombre}</b> con ${r.mejor.puntaje} votos en un mismo desplazamiento. Pulsa cualquier etapa para revisarla.`
    : '<b>Sin coincidencia.</b> Ninguna canción alcanza el umbral de votos en un mismo desplazamiento. Pulsa cualquier etapa para revisarla.';
  estado('');
}

async function ejecutar(fn, botones) {
  if (ocupado) return;
  ocupado = true;
  botones.forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    estado(`⚠ ${e.message}`);
  } finally {
    ocupado = false;
    botones.forEach((b) => (b.disabled = false));
  }
}

/* ---------------------------------------------------------------- modo "fragmento + ruido" */
async function fragmento() {
  const c = catalogo.find((k) => k.id === $('cancion').value);
  const x = await cargarCancion(c);
  const ini = Math.round(Number($('inicio').value) * FS);
  const dur = Math.round(Number($('dur').value) * FS);
  if (ini >= x.length) throw new Error('El inicio está fuera de la canción.');
  let clip = x.slice(ini, Math.min(x.length, ini + dur));
  const sinRuido = $('sinruido').checked;
  if (!sinRuido) clip = agregarRuido(clip, Number($('snr').value));
  return { clip, nota: `Fragmento real: ${c.nombre} desde ${fmt(Number($('inicio').value), 1)} s${sinRuido ? '' : `, SNR ${$('snr').value} dB`}.` };
}

$('reconocer-base').addEventListener('click', () =>
  ejecutar(async () => {
    const { clip, nota } = await fragmento();
    await reconocerSenal(clip, nota);
  }, [$('reconocer-base')])
);

/* ---------------------------------------------------------------- modo archivo */
$('reconocer-archivo').addEventListener('click', () =>
  ejecutar(async () => {
    const f = $('archivo').files[0];
    if (!f) throw new Error('Selecciona un archivo de audio.');
    estado('Decodificando audio…');
    const x = await decodificar(await f.arrayBuffer());
    await reconocerSenal(x, `Archivo: ${f.name} (${fmt(x.length / FS, 1)} s).`);
  }, [$('reconocer-archivo')])
);

/* ---------------------------------------------------------------- modo micrófono */
$('reconocer-mic').addEventListener('click', () =>
  ejecutar(async () => {
    if (!navigator.mediaDevices || !window.MediaRecorder) throw new Error('Este navegador no permite grabar audio.');
    const seg = Number($('grab').value);
    let flujo;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      throw new Error('No se pudo acceder al micrófono. Revisa el permiso del navegador (solo funciona en localhost o HTTPS).');
    }
    const rec = new MediaRecorder(flujo);
    const partes = [];
    rec.ondataavailable = (e) => e.data.size && partes.push(e.data);
    const fin = new Promise((r) => (rec.onstop = r));
    rec.start();
    for (let s = seg; s > 0; s--) {
      estado(`🔴 Grabando… ${s} s`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    rec.stop();
    flujo.getTracks().forEach((t) => t.stop());
    await fin;
    estado('Decodificando grabación…');
    const x = await decodificar(await new Blob(partes).arrayBuffer());
    await reconocerSenal(x, `Grabación de ${seg} s.`);
  }, [$('reconocer-mic')])
);

/* ================================================================== interfaz */
for (const b of document.querySelectorAll('.pestanas [data-modo]')) {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-modo]').forEach((o) => o.classList.toggle('activa', o === b));
    for (const m of ['base', 'archivo', 'mic']) $(`modo-${m}`).hidden = m !== b.dataset.modo;
  });
}
for (const b of document.querySelectorAll('[data-vista]')) b.addEventListener('click', () => cambiarVista(b.dataset.vista));
for (const b of document.querySelectorAll('[data-cam]')) {
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-cam]').forEach((o) => o.classList.toggle('activa', o === b));
    vista3d?.fijarVista(b.dataset.cam);
  });
}
const enlazar = (id, destino, sufijo = '') => $(id).addEventListener('input', () => ($(destino).textContent = `${$(id).value}${sufijo}`));
enlazar('inicio', 'v-inicio', ' s');
enlazar('dur', 'v-dur', ' s');
enlazar('snr', 'v-snr', ' dB');
enlazar('grab', 'v-grab', ' s');
$('sinruido').addEventListener('change', () => ($('snr').disabled = $('sinruido').checked));
$('ver-picos').addEventListener('change', aplicarOverlays);
$('ver-pares').addEventListener('change', aplicarOverlays);
$('altura').addEventListener('input', () => vista3d?.fijarEscala(Number($('altura').value)));
$('giro').addEventListener('change', () => vista3d?.giroAutomatico($('giro').checked));

(async function iniciar() {
  const q = new URLSearchParams(location.search);
  aplicarTema(q.get('tema') === 'oscuro' || q.get('tema') === 'claro' ? q.get('tema') : document.documentElement.dataset.tema || 'claro');
  mostrarExplicacion(0);
  metricas(null, null);
  catalogo = (await (await fetch('/api/canciones')).json()).map((c) => ({ ...c, id: c.archivo.replace('.wav', '') }));
  for (const c of catalogo) $('cancion').add(new Option(`${c.nombre} · ${c.descripcion}`, c.id));

  // Parámetros por URL para precargar un caso: ?cancion=tema03&inicio=8&dur=5&snr=0|inf&auto=1&vista=2d&pares=1&cam=superior
  if (q.get('cancion')) $('cancion').value = q.get('cancion');
  for (const id of ['inicio', 'dur']) if (q.get(id)) { $(id).value = q.get(id); $(id).dispatchEvent(new Event('input')); }
  if (q.get('snr') === 'inf') { $('sinruido').checked = true; $('sinruido').dispatchEvent(new Event('change')); }
  else if (q.get('snr')) { $('snr').value = q.get('snr'); $('snr').dispatchEvent(new Event('input')); }
  if (q.get('pares')) $('ver-pares').checked = q.get('pares') === '1';
  if (q.get('altura')) $('altura').value = q.get('altura');

  if (q.get('vista') === '2d') modoVista = '2d';
  cambiarVista(modoVista);
  await iniciar3D();
  if (q.get('cam') && vista3d) {
    vista3d.fijarVista(q.get('cam'), false);
    document.querySelectorAll('[data-cam]').forEach((o) => o.classList.toggle('activa', o.dataset.cam === q.get('cam')));
  }
  if (q.get('giro') === '1') { $('giro').checked = true; vista3d?.giroAutomatico(true); }
  redibujar();
  if (q.get('auto')) $('reconocer-base').click();
})();
