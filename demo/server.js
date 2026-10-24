'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const Huella = require('./lib/huella');
const { leerWav } = require('./lib/sintesis');

const PORT = process.env.PORT || 3000;
const CARPETA_AUDIO = path.join(__dirname, 'public', 'audio');
const MAX_HUELLAS = 60000; // protección: una consulta de ~10 s genera ~300

/** Construye el índice invertido leyendo el catálogo de canciones (WAV de 8 kHz). */
function construirIndice() {
  const catalogo = JSON.parse(fs.readFileSync(path.join(CARPETA_AUDIO, 'catalogo.json'), 'utf8'));
  const indice = new Huella.Indice();
  const t0 = Date.now();
  for (const c of catalogo) {
    const { x, fs: frecuencia } = leerWav(path.join(CARPETA_AUDIO, c.archivo));
    if (frecuencia !== Huella.PARAMS.fs) throw new Error(`${c.archivo}: se esperaba ${Huella.PARAMS.fs} Hz`);
    indice.agregar({ nombre: c.nombre, descripcion: c.descripcion, archivo: c.archivo, duracion_s: c.duracion_s }, Huella.huella(x).huellas);
  }
  indice.construccion_ms = Date.now() - t0;
  return indice;
}

function crearApp(indice) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // Módulos compartidos con el navegador (el mismo código calcula las huellas en cliente y servidor)
  for (const archivo of ['huella.js', 'colores.js']) app.get(`/lib/${archivo}`, (_req, res) => res.sendFile(path.join(__dirname, 'lib', archivo)));
  // Three.js (vista 3D) desde node_modules: funciona sin internet una vez hecho `npm install`
  const three = path.join(__dirname, 'node_modules', 'three');
  app.use('/vendor/three', express.static(path.join(three, 'build')));
  app.use('/vendor/three-examples', express.static(path.join(three, 'examples', 'jsm')));

  app.get('/api/canciones', (_req, res) => res.json(indice.canciones));

  app.get('/api/estado', (_req, res) =>
    res.json({
      canciones: indice.canciones.length,
      huellas_totales: indice.total,
      huellas_unicas: indice.mapa.size,
      construccion_ms: indice.construccion_ms,
      parametros: Huella.PARAMS,
    })
  );

  /** Recibe las huellas calculadas en el cliente: { huellas: [[hash, t], ...] } y devuelve la mejor coincidencia. */
  app.post('/api/reconocer', (req, res) => {
    const huellas = req.body && req.body.huellas;
    if (!Array.isArray(huellas)) return res.status(400).json({ error: 'Se esperaba { huellas: [[hash, tiempo], ...] }' });
    if (huellas.length > MAX_HUELLAS) return res.status(413).json({ error: `Demasiadas huellas (máximo ${MAX_HUELLAS})` });
    for (const p of huellas) {
      if (!Array.isArray(p) || p.length !== 2 || !Number.isInteger(p[0]) || !Number.isInteger(p[1]) || p[0] < 0 || p[0] >= 2 ** 24 || p[1] < 0) {
        return res.status(400).json({ error: 'Cada huella debe ser [hash entero de 24 bits, tiempo entero >= 0]' });
      }
    }
    const t0 = process.hrtime.bigint();
    const r = indice.buscar(huellas);
    r.tiempo_busqueda_ms = Number(process.hrtime.bigint() - t0) / 1e6;
    r.parametros = { fs: Huella.PARAMS.fs, hop: Huella.PARAMS.hop };
    res.json(r);
  });

  return app;
}

// Ejecución local: `npm start`. En Vercel, api/index.js importa construirIndice y crearApp.
if (require.main === module) {
  const indice = construirIndice();
  crearApp(indice).listen(PORT, () => {
    console.log(`Índice: ${indice.canciones.length} canciones, ${indice.total} huellas (${indice.construccion_ms} ms)`);
    console.log(`Demo disponible en http://localhost:${PORT}`);
  });
}

module.exports = { construirIndice, crearApp };
