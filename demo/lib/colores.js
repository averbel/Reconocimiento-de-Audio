'use strict';

/**
 * Mapa de color del espectrograma (negro → azul → magenta → naranja → amarillo).
 * Módulo universal: lo usan el navegador (vista 2D y 3D) y el generador del informe (Node).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Colores = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const PARADAS = [
    [0, [8, 10, 30]],
    [0.35, [40, 40, 140]],
    [0.6, [170, 50, 140]],
    [0.82, [240, 130, 40]],
    [1, [255, 240, 120]],
  ];

  /** v en [0, 1] → [r, g, b] en 0–255. */
  function colorMapa(v) {
    for (let i = 1; i < PARADAS.length; i++) {
      if (v <= PARADAS[i][0]) {
        const [a, ca] = PARADAS[i - 1];
        const [b, cb] = PARADAS[i];
        const f = (v - a) / (b - a);
        return ca.map((c, j) => Math.round(c + (cb[j] - c) * f));
      }
    }
    return PARADAS[PARADAS.length - 1][1].slice();
  }

  return { colorMapa };
});
