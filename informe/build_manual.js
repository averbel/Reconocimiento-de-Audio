'use strict';

/**
 * Genera el manual de uso: manual.template.html -> manual.html -> Manual_de_Uso.pdf
 * Las cifras de rendimiento se leen de resultados.json y los parámetros de lib/huella.js.
 * Las capturas están en figuras/manual/. Uso: (en informe) npm run manual
 */

const fs = require('node:fs');
const path = require('node:path');
const { htmlAPdf } = require('./comun');
const H = require('../demo/lib/huella');
const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'resultados.json'), 'utf8'));

const SALIDA_HTML = path.join(__dirname, 'manual.html');
const SALIDA_PDF = path.join(__dirname, 'Manual_de_Uso.pdf');
const P = H.PARAMS;
const celda = (d, s) => res.exactitud.celdas.find((c) => c.dur_s === d && c.snr_db === s);
const pct = (x) => `${Math.round(100 * x)} %`;

const snrs = [null, 10, 0, -5, -10];
const cab = snrs.map((s) => `<th>${s === null ? 'Sin ruido' : `${s} dB`}</th>`).join('');
const filas = [2, 3, 5, 10]
  .map((d) => `<tr><td>${d} s</td>${snrs.map((s) => `<td>${pct(celda(d, s).aceptadas)}</td>`).join('')}</tr>`)
  .join('\n');

const valores = {
  umbral: P.umbral,
  tabla_rendimiento: `<table><thead><tr><th>Duraci&oacute;n</th>${cab}</tr></thead><tbody>${filas}</tbody></table>`,
  votos_5: celda(5, null).puntaje_mediano,
  votos_10: celda(10, null).puntaje_mediano,
  votos_5_0db: celda(5, 0).puntaje_mediano,
  votos_5_m5: celda(5, -5).puntaje_mediano,
  n_can: res.n_canciones,
};

let html = fs.readFileSync(path.join(__dirname, 'manual.template.html'), 'utf8');
html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in valores ? valores[k] : (console.warn('Falta valor:', k), m)));
fs.writeFileSync(SALIDA_HTML, html);
console.log('HTML generado:', SALIDA_HTML);
htmlAPdf(SALIDA_HTML, SALIDA_PDF);
