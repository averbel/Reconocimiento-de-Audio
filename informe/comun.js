'use strict';

/**
 * Utilidades compartidas por los generadores de PDF (build.js y build_modelos.js):
 *  - ecuaciones KaTeX numeradas ([[eq:id]]...[[/eq]] y [[ref:id]]) y matemáticas en línea ($...$)
 *  - exportación de HTML a PDF con Edge o Chrome en modo headless
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const katex = require('katex');

const tex = (s, display = false) =>
  katex.renderToString(s, { displayMode: display, throwOnError: true, output: 'html', strict: 'ignore' });

/** Numera las ecuaciones, resuelve las referencias [[ref:id]] y renderiza $...$. */
function procesarMatematicas(html) {
  const numeros = {};
  let n = 0;
  html = html.replace(/\[\[eq:(\w+)\]\]([\s\S]*?)\[\[\/eq\]\]/g, (_, id, latex) => {
    numeros[id] = ++n;
    return `<div class="eq" id="eq-${id}"><div class="eqc">${tex(latex.trim(), true)}</div><div class="eqn">(${n})</div></div>`;
  });
  html = html.replace(/\[\[ref:(\w+)\]\]/g, (_, id) => {
    if (!(id in numeros)) throw new Error('Ecuación no definida: ' + id);
    return `(${numeros[id]})`;
  });
  return html.replace(/\$([^$\n]+)\$/g, (_, latex) => tex(latex));
}

/** Imprime un HTML local a PDF (sin encabezados ni pies). Devuelve true si se generó el archivo. */
function htmlAPdf(rutaHtml, rutaPdf) {
  const candidatos = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const navegador = candidatos.find((p) => fs.existsSync(p));
  if (!navegador) {
    console.error(`No se encontró Edge/Chrome. Abre ${path.basename(rutaHtml)} e imprime a PDF (sin encabezados).`);
    process.exit(1);
  }
  const perfil = path.join(os.tmpdir(), 'informe_pdf_profile_audio');
  fs.rmSync(rutaPdf, { force: true });
  const r = spawnSync(
    navegador,
    ['--headless=new', '--disable-gpu', `--user-data-dir=${perfil}`, '--no-pdf-header-footer', '--virtual-time-budget=15000', `--print-to-pdf=${rutaPdf}`, 'file:///' + rutaHtml.replace(/\\/g, '/')],
    { stdio: 'ignore' }
  );
  const ok = fs.existsSync(rutaPdf);
  console.log(ok ? `PDF generado: ${rutaPdf}` : `No se generó el PDF (código ${r.status})`);
  return ok;
}

module.exports = { tex, procesarMatematicas, htmlAPdf };
