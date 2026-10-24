'use strict';

/**
 * Genera el informe: paper.template.html -> paper.html -> Informe_IEEE.pdf
 *  - Ecuaciones: KaTeX ([[eq:id]]...[[/eq]] numeradas, $...$ en línea)
 *  - Figuras SVG/PNG calculadas con lib/huella.js, lib/sintesis.js y resultados.json
 *  - Referencias numeradas por orden de primera cita ([[cite:clave]])
 *  - PDF: Microsoft Edge en modo headless
 * Uso: (en demo) npm run experimentos; (en informe) npm run build
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { procesarMatematicas, htmlAPdf } = require('./comun');
const H = require('../demo/lib/huella');
const S = require('../demo/lib/sintesis');
const { colorMapa } = require('../demo/lib/colores');
const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados.json'), 'utf8'));

const SALIDA_HTML = path.join(__dirname, 'paper.html');
const SALIDA_PDF = path.join(__dirname, 'Informe_IEEE.pdf');
const FS = H.PARAMS.fs;
const HOP = H.PARAMS.hop;

/* ------------------------------------------------------------------ utilidades */
const f = (x, d = 2) =>
  x.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '\u2212');
const pct = (x) => f(100 * x, 0);
const sci = (x) => {
  const [m, e] = x.toExponential(1).split('e');
  return `${m.replace('.', ',')}&times;10<sup>${Number(e)}</sup>`;
};
/* ------------------------------------------------------------------ referencias */
const REFS = {
  wang: 'A. Wang, &ldquo;An industrial-strength audio search algorithm,&rdquo; in <i>Proc. 4th Int. Conf. Music Information Retrieval (ISMIR)</i>, Baltimore, MD, USA, Oct. 2003, pp. 7&ndash;13.',
  cooley: 'J. W. Cooley and J. W. Tukey, &ldquo;An algorithm for the machine calculation of complex Fourier series,&rdquo; <i>Math. Comput.</i>, vol. 19, no. 90, pp. 297&ndash;301, Apr. 1965.',
  oppenheim: 'A. V. Oppenheim and R. W. Schafer, <i>Discrete-Time Signal Processing</i>, 3rd ed. Upper Saddle River, NJ, USA: Pearson, 2010.',
  shannon: 'C. E. Shannon, &ldquo;Communication in the presence of noise,&rdquo; <i>Proc. IRE</i>, vol. 37, no. 1, pp. 10&ndash;21, Jan. 1949.',
  harris: 'F. J. Harris, &ldquo;On the use of windows for harmonic analysis with the discrete Fourier transform,&rdquo; <i>Proc. IEEE</i>, vol. 66, no. 1, pp. 51&ndash;83, Jan. 1978.',
  gabor: 'D. Gabor, &ldquo;Theory of communication,&rdquo; <i>J. Inst. Electr. Eng.</i>, vol. 93, no. 26, pp. 429&ndash;457, 1946.',
  haitsma: 'J. Haitsma and T. Kalker, &ldquo;A highly robust audio fingerprinting system,&rdquo; in <i>Proc. 3rd Int. Conf. Music Information Retrieval (ISMIR)</i>, Paris, France, Oct. 2002, pp. 107&ndash;115.',
  cano: 'P. Cano, E. Batlle, T. Kalker, and J. Haitsma, &ldquo;A review of audio fingerprinting,&rdquo; <i>J. VLSI Signal Process. Syst.</i>, vol. 41, no. 3, pp. 271&ndash;284, Nov. 2005.',
  webaudio: 'P. Adenot and R. Toy, Eds., &ldquo;Web Audio API,&rdquo; W3C Recommendation, Jun. 2021. [Online]. Available: https://www.w3.org/TR/webaudio/',
  threejs: '&ldquo;three.js: JavaScript 3D library.&rdquo; [Online]. Available: https://threejs.org',
  express: '&ldquo;Express: Fast, unopinionated, minimalist web framework for Node.js.&rdquo; [Online]. Available: https://expressjs.com',
};

/* ------------------------------------------------------------------ PNG (sin dependencias) */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([len, cuerpo, crc]);
}
function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloque('IHDR', ihdr),
    bloque('IDAT', zlib.deflateSync(raw, { level: 9 })),
    bloque('IEND', Buffer.alloc(0)),
  ]);
}
/* ------------------------------------------------------------------ datos de ejemplo (una canción real de la demo) */
const CLIP = S.cancion(4).x.slice(4 * FS, 10 * FS); // Tema 04, de 4 s a 10 s
const EJ = H.huella(CLIP);
const KMAX = 256; // 0-2 kHz
const T_EJ = EJ.S.length;

/* ------------------------------------------------------------------ figura 2: espectrograma + constelación */
function figuraEspectrograma() {
  const esc2 = 2;
  const w = T_EJ * esc2, h = KMAX * esc2;
  let gmax = -Infinity;
  for (const fila of EJ.S) for (let k = 0; k < KMAX; k++) gmax = Math.max(gmax, fila[k]);
  const rgb = new Uint8Array(w * h * 3);
  const poner = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 3;
    rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
  };
  for (let t = 0; t < T_EJ; t++) {
    for (let k = 0; k < KMAX; k++) {
      const c = colorMapa(Math.min(1, Math.max(0, (EJ.S[t][k] - (gmax - 70)) / 70)));
      for (let dy = 0; dy < esc2; dy++) for (let dx = 0; dx < esc2; dx++) poner(t * esc2 + dx, (KMAX - 1 - k) * esc2 + dy, c);
    }
  }
  for (let i = 0; i < EJ.picos.t.length; i++) {
    const cx = EJ.picos.t[i] * esc2 + 1, cy = (KMAX - 1 - EJ.picos.k[i]) * esc2 + 1;
    for (let d = -3; d <= 3; d++) for (const [x, y] of [[cx + d, cy], [cx, cy + d]]) poner(x, y, [255, 40, 40]);
  }
  const uri = 'data:image/png;base64,' + png(w, h, rgb).toString('base64');
  const W = 350, Hh = 205, L = 40, T = 8, ancho = 296, alto = 150;
  const seg = (T_EJ * HOP) / FS;
  let ejes = '';
  for (let s = 0; s <= Math.floor(seg); s++) {
    const x = L + (s / seg) * ancho;
    ejes += `<line x1="${x}" y1="${T + alto}" x2="${x}" y2="${T + alto + 3}" stroke="#222"/><text x="${x}" y="${T + alto + 13}" text-anchor="middle">${s}</text>`;
  }
  for (const khz of [0, 0.5, 1, 1.5, 2]) {
    const y = T + alto - (khz / 2) * alto;
    ejes += `<line x1="${L - 3}" y1="${y}" x2="${L}" y2="${y}" stroke="#222"/><text x="${L - 5}" y="${y + 3}" text-anchor="end">${String(khz).replace('.', ',')}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg" font-family="'Times New Roman',serif" font-size="9.5">
  <image href="${uri}" x="${L}" y="${T}" width="${ancho}" height="${alto}" preserveAspectRatio="none"/>
  <rect x="${L}" y="${T}" width="${ancho}" height="${alto}" fill="none" stroke="#222"/>
  ${ejes}
  <text x="${L + ancho / 2}" y="${Hh - 18}" text-anchor="middle" font-size="10.5">Tiempo (s)</text>
  <text transform="translate(10 ${T + alto / 2}) rotate(-90)" text-anchor="middle" font-size="10.5">Frecuencia (kHz)</text>
  <circle cx="${L + 8}" cy="${Hh - 6}" r="3" fill="#ff2828"/><text x="${L + 15}" y="${Hh - 3}">picos de la constelación (${EJ.picos.t.length})</text>
</svg>`;
}

/* ------------------------------------------------------------------ figura 3: pares ancla-objetivo */
function figuraPares() {
  const W = 350, Hh = 175, L = 36, T = 8, ancho = 304, alto = 118;
  const t0 = 30, t1 = 30 + 110; // ventana de tiempo mostrada (frames)
  const p = EJ.picos;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * ancho;
  const Y = (k) => T + alto - (Math.min(k, KMAX) / KMAX) * alto;
  const idx = [];
  for (let i = 0; i < p.t.length; i++) if (p.t[i] >= t0 && p.t[i] <= t1 + 70) idx.push(i);
  // ancla: primer pico de la ventana con al menos 'fan' objetivos disponibles
  let ancla = idx.find((i) => p.t[i] > t0 + 8 && p.t.slice(i + 1, i + 1 + 10).every((t) => t - p.t[i] <= 63));
  if (ancla === undefined) ancla = idx[Math.floor(idx.length / 3)];
  const objetivos = [];
  for (let j = ancla + 1; j < p.t.length && objetivos.length < H.PARAMS.fan; j++) {
    const dt = p.t[j] - p.t[ancla];
    if (dt > H.PARAMS.dtMax) break;
    if (dt >= 1) objetivos.push(j);
  }
  let puntos = '', lineas = '';
  for (const i of idx) if (p.t[i] <= t1 && p.k[i] < KMAX) puntos += `<circle cx="${X(p.t[i]).toFixed(1)}" cy="${Y(p.k[i]).toFixed(1)}" r="2.2" fill="#555"/>`;
  for (const j of objetivos) if (p.t[j] <= t1 && p.k[j] < KMAX) lineas += `<line x1="${X(p.t[ancla])}" y1="${Y(p.k[ancla])}" x2="${X(p.t[j])}" y2="${Y(p.k[j])}" stroke="#0b3d91" stroke-width="0.9"/><circle cx="${X(p.t[j]).toFixed(1)}" cy="${Y(p.k[j]).toFixed(1)}" r="2.8" fill="#0b3d91"/>`;
  const zx0 = X(p.t[ancla] + 1), zx1 = Math.min(L + ancho, X(p.t[ancla] + H.PARAMS.dtMax));
  const j0 = objetivos[0];
  const h0 = j0 !== undefined ? (p.k[ancla] * 512 + p.k[j0]) * 64 + (p.t[j0] - p.t[ancla]) : 0;
  let ejes = '';
  for (let s = 0; s * FS / HOP <= t1 - t0; s++) {
    const tt = t0 + Math.round((s * FS) / HOP);
    ejes += `<text x="${X(tt)}" y="${T + alto + 12}" text-anchor="middle">${(((tt) * HOP) / FS).toFixed(0)}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg" font-family="'Times New Roman',serif" font-size="9.5">
  <rect x="${L}" y="${T}" width="${ancho}" height="${alto}" fill="#fff" stroke="#222"/>
  <rect x="${zx0}" y="${T}" width="${Math.max(0, zx1 - zx0)}" height="${alto}" fill="#dfe9fb" opacity="0.7"/>
  ${puntos}${lineas}
  <circle cx="${X(p.t[ancla])}" cy="${Y(p.k[ancla])}" r="4" fill="#b00020"/>
  <text x="${X(p.t[ancla]) - 3}" y="${Y(p.k[ancla]) - 7}" text-anchor="end" fill="#b00020">ancla (<tspan font-style="italic">t</tspan><tspan font-size="7" dy="2">1</tspan><tspan dy="-2">, </tspan><tspan font-style="italic">f</tspan><tspan font-size="7" dy="2">1</tspan><tspan dy="-2">)</tspan></text>
  <text x="${(zx0 + zx1) / 2}" y="${T + 10}" text-anchor="middle" fill="#0b3d91">zona objetivo (&#916;<tspan font-style="italic">t</tspan> &#8804; ${H.PARAMS.dtMax} ventanas)</text>
  ${ejes}
  <line x1="${L}" y1="${T + alto}" x2="${L + ancho}" y2="${T + alto}" stroke="#222"/>
  <text x="${L + ancho / 2}" y="${Hh - 24}" text-anchor="middle" font-size="10.5">Tiempo (s)</text>
  <text transform="translate(10 ${T + alto / 2}) rotate(-90)" text-anchor="middle" font-size="10.5">Frecuencia (0&#8211;2 kHz)</text>
  <text x="${L}" y="${Hh - 6}" font-size="9.5">Cada par (ancla, objetivo) genera un hash: (<tspan font-style="italic">f</tspan><tspan font-size="7" dy="2">1</tspan><tspan dy="-2">, </tspan><tspan font-style="italic">f</tspan><tspan font-size="7" dy="2">2</tspan><tspan dy="-2">, &#916;</tspan><tspan font-style="italic">t</tspan>)${h0 ? ` = ${h0}` : ''}</text>
</svg>`;
}

/* ------------------------------------------------------------------ figura 4: histograma de desplazamientos */
function figuraHistograma() {
  const e = res.histograma;
  const W = 350, Hh = 190, L = 38, T = 10, ancho = 300, alto = 130;
  const todos = [...e.mejor.hist, ...e.rival.hist];
  const xmin = Math.min(...todos.map((h) => h[0])), xmax = Math.max(...todos.map((h) => h[0]));
  const ymax = Math.max(...e.mejor.hist.map((h) => h[1]));
  const X = (o) => L + ((o - xmin) / (xmax - xmin)) * ancho;
  const Y = (c) => T + alto - (c / ymax) * alto;
  let ejes = '';
  const paso = Math.pow(10, Math.floor(Math.log10(ymax))) * (ymax / Math.pow(10, Math.floor(Math.log10(ymax))) > 5 ? 2 : 1);
  for (let v = 0; v <= ymax; v += paso) ejes += `<line x1="${L}" y1="${Y(v)}" x2="${L + ancho}" y2="${Y(v)}" stroke="#e4e4e4"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>`;
  const sOff = (o) => (o * HOP) / FS;
  for (let s = Math.ceil(sOff(xmin) / 5) * 5; s <= sOff(xmax); s += 5) ejes += `<text x="${X((s * FS) / HOP)}" y="${T + alto + 12}" text-anchor="middle">${s}</text>`;
  let rival = '', mejor = '';
  for (const [o, c] of e.rival.hist) rival += `<line x1="${X(o)}" y1="${Y(0)}" x2="${X(o)}" y2="${Y(c)}" stroke="#888" stroke-width="1"/>`;
  for (const [o, c] of e.mejor.hist) mejor += `<line x1="${X(o)}" y1="${Y(0)}" x2="${X(o)}" y2="${Y(c)}" stroke="${c === Math.max(...e.mejor.hist.map((h) => h[1])) ? '#b00020' : '#0b3d91'}" stroke-width="${c === ymax ? 2 : 1}"/>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg" font-family="'Times New Roman',serif" font-size="9.5">
  ${ejes}
  <rect x="${L}" y="${T}" width="${ancho}" height="${alto}" fill="none" stroke="#222"/>
  ${rival}${mejor}
  <text x="${L + ancho / 2}" y="${Hh - 22}" text-anchor="middle" font-size="10.5">Desplazamiento <tspan font-style="italic">t</tspan><tspan font-size="7" dy="2">bd</tspan><tspan dy="-2"> &#8722; </tspan><tspan font-style="italic">t</tspan><tspan font-size="7" dy="2">consulta</tspan><tspan dy="-2"> (s)</tspan></text>
  <text transform="translate(10 ${T + alto / 2}) rotate(-90)" text-anchor="middle" font-size="10.5">Votos (coincidencias de hash)</text>
  <g font-size="9.5"><line x1="${L + 8}" y1="${Hh - 8}" x2="${L + 24}" y2="${Hh - 8}" stroke="#0b3d91" stroke-width="1.4"/><text x="${L + 28}" y="${Hh - 5}">Tema ${e.mejor.id} (correcta)</text>
  <line x1="${L + 150}" y1="${Hh - 8}" x2="${L + 166}" y2="${Hh - 8}" stroke="#888" stroke-width="1.4"/><text x="${L + 170}" y="${Hh - 5}">Tema ${e.rival.id} (mejor rival)</text></g>
</svg>`;
}

/* ------------------------------------------------------------------ figura 5: exactitud vs SNR */
function figuraExactitud() {
  const W = 350, Hh = 215, L = 40, T = 10, ancho = 296, alto = 135;
  const snrs = [-15, -10, -5, 0, 10, 20, null];
  const X = (i) => L + 10 + (i / (snrs.length - 1)) * (ancho - 20);
  const Y = (v) => T + alto - v * alto;
  const estilos = { 2: ['#b00020', '', 'M-3,-3 L3,3 M-3,3 L3,-3'], 3: ['#e08a00', '6 3', ''], 5: ['#0b3d91', '', ''], 10: ['#1b7f3b', '2 2', ''] };
  let ejes = '';
  for (let v = 0; v <= 1.0001; v += 0.25) ejes += `<line x1="${L}" y1="${Y(v)}" x2="${L + ancho}" y2="${Y(v)}" stroke="#e4e4e4"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v * 100)}</text>`;
  snrs.forEach((s, i) => (ejes += `<text x="${X(i)}" y="${T + alto + 13}" text-anchor="middle">${s === null ? '&#8734;' : s}</text>`));
  let series = '', leyenda = '';
  [2, 3, 5, 10].forEach((d, n) => {
    const [color, dash] = estilos[d];
    const pts = snrs.map((s, i) => {
      const c = res.exactitud.celdas.find((c) => c.dur_s === d && c.snr_db === s);
      return [X(i), Y(c.top1)];
    });
    series += `<path d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')}" fill="none" stroke="${color}" stroke-width="1.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    series += pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.2" fill="${color}"/>`).join('');
    const lx = L + 6 + n * 72;
    leyenda += `<line x1="${lx}" y1="${Hh - 8}" x2="${lx + 16}" y2="${Hh - 8}" stroke="${color}" stroke-width="1.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/><text x="${lx + 20}" y="${Hh - 5}">${d} s</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg" font-family="'Times New Roman',serif" font-size="9.5">
  ${ejes}
  <rect x="${L}" y="${T}" width="${ancho}" height="${alto}" fill="none" stroke="#222"/>
  ${series}
  <text x="${L + ancho / 2}" y="${Hh - 24}" text-anchor="middle" font-size="10.5">Relación señal-ruido (dB)</text>
  <text transform="translate(10 ${T + alto / 2}) rotate(-90)" text-anchor="middle" font-size="10.5">Canción correcta (top-1, %)</text>
  ${leyenda}
</svg>`;
}

/* ------------------------------------------------------------------ figura 6: FFT vs DFT */
function figuraFFT() {
  const W = 350, Hh = 215, L = 44, T = 10, ancho = 292, alto = 135;
  const datos = res.fft_dft;
  const xmin = Math.log2(datos[0].N), xmax = Math.log2(datos[datos.length - 1].N);
  const ymin = -3, ymax = 2;
  const X = (N) => L + ((Math.log2(N) - xmin) / (xmax - xmin)) * ancho;
  const Y = (ms) => T + alto - ((Math.log10(ms) - ymin) / (ymax - ymin)) * alto;
  let ejes = '';
  for (let e = ymin; e <= ymax; e++) ejes += `<line x1="${L}" y1="${Y(10 ** e)}" x2="${L + ancho}" y2="${Y(10 ** e)}" stroke="#e4e4e4"/><text x="${L - 4}" y="${Y(10 ** e) + 3}" text-anchor="end">10<tspan font-size="7" dy="-4">${e}</tspan></text>`;
  for (const d of datos) ejes += `<text x="${X(d.N)}" y="${T + alto + 13}" text-anchor="middle">${d.N}</text>`;
  const trazo = (campo, color, dash) =>
    `<path d="${datos.map((d, i) => `${i ? 'L' : 'M'}${X(d.N).toFixed(1)},${Y(d[campo]).toFixed(1)}`).join('')}" fill="none" stroke="${color}" stroke-width="1.6" ${dash ? `stroke-dasharray="${dash}"` : ''}/>` +
    datos.map((d) => `<circle cx="${X(d.N).toFixed(1)}" cy="${Y(d[campo]).toFixed(1)}" r="2.2" fill="${color}"/>`).join('');
  return `<svg viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg" font-family="'Times New Roman',serif" font-size="9.5">
  ${ejes}
  <rect x="${L}" y="${T}" width="${ancho}" height="${alto}" fill="none" stroke="#222"/>
  ${trazo('dft_ms', '#b00020', '5 3')}${trazo('fft_ms', '#0b3d91', '')}
  <text x="${L + ancho / 2}" y="${Hh - 24}" text-anchor="middle" font-size="10.5">Tamaño de la transformada <tspan font-style="italic">N</tspan></text>
  <text transform="translate(10 ${T + alto / 2}) rotate(-90)" text-anchor="middle" font-size="10.5">Tiempo por transformada (ms)</text>
  <g><line x1="${L + 10}" y1="${Hh - 8}" x2="${L + 30}" y2="${Hh - 8}" stroke="#b00020" stroke-width="1.6" stroke-dasharray="5 3"/><text x="${L + 35}" y="${Hh - 5}">DFT directa, O(<tspan font-style="italic">N</tspan><tspan font-size="7" dy="-4">2</tspan><tspan dy="4">)</tspan></text>
  <line x1="${L + 140}" y1="${Hh - 8}" x2="${L + 160}" y2="${Hh - 8}" stroke="#0b3d91" stroke-width="1.6"/><text x="${L + 165}" y="${Hh - 5}">FFT, O(<tspan font-style="italic">N</tspan> log <tspan font-style="italic">N</tspan>)</text></g>
</svg>`;
}

/* ------------------------------------------------------------------ tablas */
function tablaFFT() {
  const filas = res.fft_dft
    .map((d) => `<tr><td>${d.N}</td><td>${f(d.fft_ms, 4)}</td><td>${f(d.dft_ms, 3)}</td><td>${f(d.aceleracion, 0)}&times;</td><td>${sci(d.error_max)}</td></tr>`)
    .join('\n');
  return `<table><thead><tr><th><i>N</i></th><th>FFT (ms)</th><th>DFT (ms)</th><th>Acel.</th><th>Error m&aacute;x.</th></tr></thead><tbody>${filas}</tbody></table>`;
}
function tablaExactitud() {
  const snrs = res.exactitud.snrs;
  const cab = snrs.map((s) => `<th>${s === null ? '&infin;' : s}</th>`).join('');
  const filas = res.exactitud.durs
    .map((d) => {
      const cel = snrs.map((s) => {
        const c = res.exactitud.celdas.find((c) => c.dur_s === d && c.snr_db === s);
        return `<td>${pct(c.top1)} / ${pct(c.aceptadas)}</td>`;
      });
      return `<tr><td>${d} s</td>${cel.join('')}</tr>`;
    })
    .join('\n');
  return `<table><thead><tr><th>Dur.</th>${cab}</tr></thead><tbody>${filas}</tbody></table>`;
}
function tablaMargen() {
  const filas = res.sensibilidad_margen
    .map((m) => `<tr><td>${m.margen_db}</td><td>${f(m.huellas_por_s, 0)}</td><td>${pct(m.top1_0db)}</td><td>${pct(m.top1_m5db)}</td><td>${m.puntaje_ajeno_max}</td></tr>`)
    .join('\n');
  return `<table><thead><tr><th>&gamma; (dB)</th><th>Hashes/s</th><th>0 dB (%)</th><th>&minus;5 dB (%)</th><th>Punt. ajeno m&aacute;x.</th></tr></thead><tbody>${filas}</tbody></table>`;
}
function tablaFP() {
  const filas = res.falsos_positivos
    .map((r) => `<tr><td>${r.dur_s} s</td><td>${r.snr_db === null ? '&infin;' : r.snr_db + ' dB'}</td><td>${r.n}</td><td>${r.falsos_positivos}</td><td>${r.puntaje_max}</td></tr>`)
    .join('\n');
  return `<table><thead><tr><th>Dur.</th><th>SNR</th><th>Consultas</th><th>Falsos +</th><th>Punt. m&aacute;x.</th></tr></thead><tbody>${filas}</tbody></table>`;
}

/* ------------------------------------------------------------------ plantilla */
let html = fs.readFileSync(path.join(__dirname, 'paper.template.html'), 'utf8');

const cel = (d, s) => res.exactitud.celdas.find((c) => c.dur_s === d && c.snr_db === s);
const c = res.costos;
const P = H.PARAMS;
const m30 = res.sensibilidad_margen.find((m) => m.margen_db === 30);
const valores = {
  n_can: res.n_canciones, seg_ej: f((T_EJ * HOP) / FS, 0),
  marg_alto: m30.margen_db, top_alto: pct(m30.top1_m5db), ajeno_alto: m30.puntaje_ajeno_max,
  fs: f(P.fs, 0), N: P.N, hop: P.hop, ventana_ms: f((1000 * P.N) / P.fs, 0), hop_ms: f((1000 * P.hop) / P.fs, 0), df: f(P.fs / P.N, 2),
  marg: P.margenDb, fan: P.fan, dtmax: P.dtMax, vecf: P.vecF, vect: P.vecT, umbral: P.umbral,
  huellas_tot: c.huellas_totales.toLocaleString('es-CO'), huellas_uni: c.huellas_unicas.toLocaleString('es-CO'),
  hps: f(c.huellas_por_s, 0), huella_ms: f(c.huella_ms_5s, 0), busq_ms: f(c.busqueda_ms_5s, 2), const_ms: f(c.construccion_bd_ms, 0),
  ocup_pct: f(100 * c.ocupacion, 3), azar_pct: f(100 * c.azar_hit, 1), ratio_azar: f(c.azar_hit / c.ocupacion, 0), entradas_hit: f(c.azar_entradas_por_hit, 1),
  fp_max: Math.max(...res.falsos_positivos.map((r) => r.puntaje_max)), fp_n: res.falsos_positivos.reduce((a, r) => a + r.n, 0),
  fp_tot: res.falsos_positivos.reduce((a, r) => a + r.falsos_positivos, 0),
  acc_5_m5: pct(cel(5, -5).top1), acc_5_m10: pct(cel(5, -10).top1), acc_5_m15: pct(cel(5, -15).top1),
  acc_10_m10: pct(cel(10, -10).top1), acc_10_m15: pct(cel(10, -15).top1), acc_2_inf: pct(cel(2, null).top1), acc_2_m5: pct(cel(2, -5).top1),
  acc_3_m5: pct(cel(3, -5).top1), ace_2_inf: pct(cel(2, null).aceptadas), ace_3_inf: pct(cel(3, null).aceptadas), ace_5_m5: pct(cel(5, -5).aceptadas),
  ace_10_m5: pct(cel(10, -5).aceptadas), ace_10_m10: pct(cel(10, -10).aceptadas),
  pm_5_inf: cel(5, null).puntaje_mediano, pm_10_inf: cel(10, null).puntaje_mediano,
  hist_id: res.histograma.mejor.id, hist_puntaje: res.histograma.mejor.puntaje, hist_rival: res.histograma.rival.puntaje,
  acel_4096: f(res.fft_dft[res.fft_dft.length - 1].aceleracion, 0), err_fft: sci(Math.max(...res.fft_dft.map((d) => d.error_max))),
  picos_ej: EJ.picos.t.length, picos_s: f(EJ.picos.t.length / ((T_EJ * HOP) / FS), 1),
  tabla_fft: tablaFFT(), tabla_exactitud: tablaExactitud(), tabla_margen: tablaMargen(), tabla_fp: tablaFP(),
  fig_espectro: figuraEspectrograma(), fig_pares: figuraPares(), fig_hist: figuraHistograma(), fig_exactitud: figuraExactitud(), fig_fft: figuraFFT(),
};
html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in valores ? valores[k] : (console.warn('Falta valor:', k), m)));

// ecuaciones numeradas, referencias a ecuaciones y matemáticas en línea ($...$)
html = procesarMatematicas(html);

// citas por orden de aparición
const orden = [];
html = html.replace(/\[\[cite:([\w,]+)\]\]/g, (_, claves) =>
  claves
    .split(',')
    .map((k) => {
      if (!(k in REFS)) throw new Error('Referencia desconocida: ' + k);
      if (!orden.includes(k)) orden.push(k);
      return `[${orden.indexOf(k) + 1}]`;
    })
    .join(', ')
);
for (const k of Object.keys(REFS)) if (!orden.includes(k)) console.warn('Referencia sin citar:', k);
html = html.replace('[[referencias]]', orden.map((k, i) => `<li><span class="rn">[${i + 1}]</span>${REFS[k]}</li>`).join('\n'));

fs.writeFileSync(SALIDA_HTML, html);
console.log('HTML generado:', SALIDA_HTML);

/* ------------------------------------------------------------------ PDF */
htmlAPdf(SALIDA_HTML, SALIDA_PDF);
