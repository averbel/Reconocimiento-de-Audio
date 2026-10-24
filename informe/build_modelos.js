'use strict';

/**
 * Genera el PDF de referencia de los modelos matemáticos: modelos.template.html -> modelos.html -> Modelos_Matematicos.pdf
 * Los valores numéricos (parámetros y mediciones) se leen del código y de resultados.json, para no repetirlos a mano.
 * Uso: (en informe) npm run modelos
 */

const fs = require('node:fs');
const path = require('node:path');
const { procesarMatematicas, htmlAPdf } = require('./comun');
const H = require('../demo/lib/huella');
const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados.json'), 'utf8'));

const SALIDA_HTML = path.join(__dirname, 'modelos.html');
const SALIDA_PDF = path.join(__dirname, 'Modelos_Matematicos.pdf');
const P = H.PARAMS;

const f = (x, d = 2) => x.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d }).replace('-', '−');
const sci = (x) => {
  const [m, e] = x.toExponential(1).split('e');
  return `${m.replace('.', ',')}&times;10<sup>${Number(e)}</sup>`;
};

const filasFFT = res.fft_dft
  .map((d) => `<tr><td>${d.N}</td><td>${f(d.fft_ms, 4)}</td><td>${f(d.dft_ms, 3)}</td><td>${f(d.aceleracion, 0)}&times;</td><td>${sci(d.error_max)}</td></tr>`)
  .join('\n');

const c = res.costos;
const valores = {
  fs: P.fs.toLocaleString('es-CO'), nyq: (P.fs / 2).toLocaleString('es-CO'), N: P.N, hop: P.hop,
  df: f(P.fs / P.N, 4), kA: f((440 * P.N) / P.fs, 2), ventana_ms: f((1000 * P.N) / P.fs, 0), hop_ms: f((1000 * P.hop) / P.fs, 0),
  tramas_s: f(P.fs / P.hop, 2), kmax_hz: (256 * P.fs) / P.N, vecf: P.vecF, vect: P.vecT, marg: P.margenDb, kmin: P.kmin, kmin_hz: f((P.kmin * P.fs) / P.N, 1),
  fan: P.fan, dtmax: P.dtMax, umbral: P.umbral, espacio: (2 ** 24).toLocaleString('es-CO'),
  mariposas: ((P.N / 2) * Math.log2(P.N)).toLocaleString('es-CO'), dft_ops: (P.N * P.N).toLocaleString('es-CO'),
  teorica: f((P.N * P.N) / ((P.N / 2) * Math.log2(P.N)), 0),
  medida_1024: f(res.fft_dft.find((d) => d.N === 1024).aceleracion, 0),
  huellas_uni: c.huellas_unicas.toLocaleString('es-CO'), ocup: f(100 * c.ocupacion, 3), azar: f(100 * c.azar_hit, 1), ratio: f(c.azar_hit / c.ocupacion, 0),
  tabla_fft: `<table><thead><tr><th><i>N</i></th><th>FFT (ms)</th><th>DFT (ms)</th><th>Aceleraci&oacute;n</th><th>Error m&aacute;x.</th></tr></thead><tbody>${filasFFT}</tbody></table>`,
};

let html = fs.readFileSync(path.join(__dirname, 'modelos.template.html'), 'utf8');
html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in valores ? valores[k] : (console.warn('Falta valor:', k), m)));
html = procesarMatematicas(html);
fs.writeFileSync(SALIDA_HTML, html);
console.log('HTML generado:', SALIDA_HTML);
htmlAPdf(SALIDA_HTML, SALIDA_PDF);
