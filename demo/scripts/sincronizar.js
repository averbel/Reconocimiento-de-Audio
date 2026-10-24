'use strict';

/**
 * Solo para Vercel (`npm run build`): copia a public/ los archivos que el navegador pide y que, en local,
 * sirve Express desde lib/ y node_modules/ (en Vercel únicamente public/ se sirve como estático).
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const copiar = (de, a) => {
  fs.mkdirSync(path.dirname(a), { recursive: true });
  fs.copyFileSync(path.join(raiz, de), path.join(raiz, a));
};

for (const archivo of ['huella.js', 'colores.js']) copiar(`lib/${archivo}`, `public/lib/${archivo}`);

const three = 'node_modules/three';
copiar(`${three}/build/three.module.js`, 'public/vendor/three/three.module.js');
copiar(`${three}/build/three.core.js`, 'public/vendor/three/three.core.js');
copiar(`${three}/examples/jsm/controls/OrbitControls.js`, 'public/vendor/three-examples/controls/OrbitControls.js');
console.log('Archivos estáticos copiados a public/ (lib y vendor)');
