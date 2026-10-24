'use strict';

/**
 * Genera la "base de datos musical" de la demo: 12 canciones sintéticas de 30 s (WAV 8 kHz, 16 bits)
 * y public/audio/catalogo.json. Uso: node scripts/generar_canciones.js
 */

const fs = require('node:fs');
const path = require('node:path');
const { cancion, escribirWav, FS } = require('../lib/sintesis');

const CARPETA = path.join(__dirname, '..', 'public', 'audio');
const N_CANCIONES = 12;
const DURACION = 30;

fs.mkdirSync(CARPETA, { recursive: true });
const catalogo = [];
for (let i = 1; i <= N_CANCIONES; i++) {
  const { x, meta } = cancion(i, { dur: DURACION });
  const id = `tema${String(i).padStart(2, '0')}`;
  escribirWav(path.join(CARPETA, `${id}.wav`), x, FS);
  catalogo.push({
    id,
    nombre: `Tema ${String(i).padStart(2, '0')}`,
    descripcion: meta.descripcion,
    archivo: `${id}.wav`,
    duracion_s: DURACION,
    semilla: i,
  });
  console.log(id, meta.descripcion);
}
fs.writeFileSync(path.join(CARPETA, 'catalogo.json'), JSON.stringify(catalogo, null, 2));
console.log(`Listo: ${N_CANCIONES} canciones en ${CARPETA}`);
