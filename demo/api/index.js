'use strict';

// Punto de entrada serverless de Vercel. El índice se construye una vez por instancia (≈1 s en arranque en frío).
const { construirIndice, crearApp } = require('../server');

module.exports = crearApp(construirIndice());
