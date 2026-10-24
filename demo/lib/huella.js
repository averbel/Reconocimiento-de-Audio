'use strict';

/**
 * Huella acústica (audio fingerprinting) basada en la Transformada de Fourier.
 * Módulo universal: se usa en Node (servidor, pruebas, experimentos) y en el navegador (window.Huella).
 *
 * Tubería: señal (8 kHz) -> ventanas de Hann -> FFT -> espectrograma (dB)
 *          -> picos locales (constelación) -> pares de picos -> hashes (f1, f2, dt)
 *          -> índice invertido -> votación por desplazamiento temporal.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Huella = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  const PARAMS = {
    fs: 8000, // frecuencia de muestreo (Hz)
    N: 1024, // tamaño de ventana / FFT
    hop: 256, // salto entre ventanas (muestras)
    vecF: 10, // vecindad de búsqueda de picos en frecuencia (± bins)
    vecT: 8, // vecindad de búsqueda de picos en tiempo (± ventanas)
    margenDb: 12, // un pico debe estar a menos de este margen (dB) del máximo global
    kmin: 4, // se ignoran las frecuencias más bajas (≈ < 31 Hz)
    fan: 10, // pares por ancla
    dtMax: 63, // separación temporal máxima ancla-objetivo (ventanas)
    umbral: 12, // puntaje mínimo para aceptar una coincidencia
  };

  /* ------------------------------------------------------------------ FFT */
  const planes = new Map();
  function plan(n) {
    let p = planes.get(n);
    if (p) return p;
    if (n < 2 || (n & (n - 1)) !== 0) throw new RangeError('La longitud de la FFT debe ser potencia de 2');
    const bits = Math.log2(n) | 0;
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      const a = (-2 * Math.PI * i) / n;
      cos[i] = Math.cos(a);
      sin[i] = Math.sin(a);
    }
    p = { rev, cos, sin };
    planes.set(n, p);
    return p;
  }

  /** FFT radix-2 (Cooley-Tukey, decimación en el tiempo), in situ. Complejidad O(N log N). */
  function fft(re, im) {
    const n = re.length;
    const { rev, cos, sin } = plan(n);
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const paso = n / size;
      for (let ini = 0; ini < n; ini += size) {
        for (let k = 0, t = 0; k < half; k++, t += paso) {
          const a = ini + k;
          const b = a + half;
          const tr = re[b] * cos[t] - im[b] * sin[t];
          const ti = re[b] * sin[t] + im[b] * cos[t];
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }

  /** DFT directa O(N²) (referencia para validar y medir la FFT). Usa tabla de factores de giro. */
  function dft(re, im) {
    const n = re.length;
    const c = new Float64Array(n);
    const s = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      c[i] = Math.cos((-2 * Math.PI * i) / n);
      s[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    const sr = new Float64Array(n);
    const si = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      let ar = 0;
      let ai = 0;
      for (let j = 0; j < n; j++) {
        const m = (j * k) % n;
        ar += re[j] * c[m] - im[j] * s[m];
        ai += re[j] * s[m] + im[j] * c[m];
      }
      sr[k] = ar;
      si[k] = ai;
    }
    return { re: sr, im: si };
  }

  const ventanas = new Map();
  /** Ventana de Hann periódica de longitud n. */
  function hann(n) {
    let w = ventanas.get(n);
    if (!w) {
      w = new Float64Array(n);
      for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      ventanas.set(n, w);
    }
    return w;
  }

  /* ------------------------------------------------------------------ espectrograma */
  /** Espectrograma de potencia en dB: arreglo de `frames` filas, cada una con N/2 bins. */
  function espectrograma(x, opc = {}) {
    const { N, hop } = { ...PARAMS, ...opc };
    const w = hann(N);
    const frames = x.length >= N ? Math.floor((x.length - N) / hop) + 1 : 0;
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    const S = new Array(frames);
    for (let t = 0; t < frames; t++) {
      const o = t * hop;
      for (let i = 0; i < N; i++) {
        re[i] = x[o + i] * w[i];
        im[i] = 0;
      }
      fft(re, im);
      const fila = new Float32Array(N / 2);
      for (let k = 0; k < N / 2; k++) fila[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
      S[t] = fila;
    }
    return S;
  }

  /* ------------------------------------------------------------------ picos (constelación) */
  /** Máximos locales del espectrograma. Devuelve {t:[], k:[]} ordenados por tiempo. */
  function picos(S, opc = {}) {
    const { vecF, vecT, margenDb, kmin } = { ...PARAMS, ...opc };
    const T = S.length;
    if (!T) return { t: [], k: [] };
    const K = S[0].length;
    let gmax = -Infinity;
    for (let t = 0; t < T; t++) for (let k = kmin; k < K; k++) if (S[t][k] > gmax) gmax = S[t][k];
    const umbral = gmax - margenDb;

    // Filtro de máximo separable: primero en frecuencia, luego en tiempo
    const M1 = new Array(T);
    for (let t = 0; t < T; t++) {
      const f = new Float32Array(K);
      for (let k = 0; k < K; k++) {
        let m = -Infinity;
        const a = Math.max(0, k - vecF);
        const b = Math.min(K - 1, k + vecF);
        for (let j = a; j <= b; j++) if (S[t][j] > m) m = S[t][j];
        f[k] = m;
      }
      M1[t] = f;
    }
    const pt = [];
    const pk = [];
    for (let t = 0; t < T; t++) {
      const a = Math.max(0, t - vecT);
      const b = Math.min(T - 1, t + vecT);
      for (let k = kmin; k < K; k++) {
        const v = S[t][k];
        if (v <= umbral) continue;
        let m = -Infinity;
        for (let j = a; j <= b; j++) if (M1[j][k] > m) m = M1[j][k];
        if (v === m) {
          pt.push(t);
          pk.push(k);
        }
      }
    }
    return { t: pt, k: pk };
  }

  /* ------------------------------------------------------------------ hashes */
  /** Pares ancla-objetivo -> hashes de 24 bits [h, t_ancla]. h = f1(9 bits) | f2(9 bits) | dt(6 bits). */
  function hashes(p, opc = {}) {
    const { fan, dtMax } = { ...PARAMS, ...opc };
    const salida = [];
    const n = p.t.length;
    for (let i = 0; i < n; i++) {
      let cuenta = 0;
      for (let j = i + 1; j < n && cuenta < fan; j++) {
        const dt = p.t[j] - p.t[i];
        if (dt > dtMax) break;
        if (dt < 1) continue;
        salida.push([(p.k[i] * 512 + p.k[j]) * 64 + dt, p.t[i]]);
        cuenta++;
      }
    }
    return salida;
  }

  /** Atajo: señal -> {S, picos, huellas}. */
  function huella(x, opc = {}) {
    const S = espectrograma(x, opc);
    const p = picos(S, opc);
    return { S, picos: p, huellas: hashes(p, opc) };
  }

  /* ------------------------------------------------------------------ índice y votación */
  const BASE_T = 2097152; // 2^21: tiempo máximo por canción (ventanas)

  class Indice {
    constructor() {
      this.mapa = new Map();
      this.canciones = [];
      this.total = 0;
    }

    agregar(meta, huellas) {
      const id = this.canciones.length;
      this.canciones.push({ ...meta, id, huellas: huellas.length });
      for (const [h, t] of huellas) {
        let a = this.mapa.get(h);
        if (!a) this.mapa.set(h, (a = []));
        a.push(id * BASE_T + t);
      }
      this.total += huellas.length;
      return id;
    }

    /** Votos por canción: Map(id -> Map(desplazamiento -> cuenta)), con desplazamiento = t_bd - t_consulta. */
    votar(huellas) {
      const votos = new Map();
      for (const [h, tq] of huellas) {
        const a = this.mapa.get(h);
        if (!a) continue;
        for (const e of a) {
          const id = Math.floor(e / BASE_T);
          const off = (e % BASE_T) - tq;
          let m = votos.get(id);
          if (!m) votos.set(id, (m = new Map()));
          m.set(off, (m.get(off) || 0) + 1);
        }
      }
      return votos;
    }

    /** Puntaje = máximo de votos en una ventana de 3 desplazamientos consecutivos (tolera el desfase de ±1 ventana). */
    puntajes(votos) {
      const lista = [];
      for (const [id, m] of votos) {
        let mejor = 0;
        let offMejor = 0;
        for (const off of m.keys()) {
          const s = (m.get(off - 1) || 0) + m.get(off) + (m.get(off + 1) || 0);
          if (s > mejor) {
            mejor = s;
            offMejor = off;
          }
        }
        lista.push({ id, puntaje: mejor, desplazamiento: offMejor });
      }
      return lista.sort((a, b) => b.puntaje - a.puntaje);
    }

    buscar(huellas, opc = {}) {
      const { umbral, fs, hop } = { ...PARAMS, ...opc };
      const votos = this.votar(huellas);
      const lista = this.puntajes(votos).map((r) => ({
        ...r,
        nombre: this.canciones[r.id].nombre,
        posicion_s: (r.desplazamiento * hop) / fs,
      }));
      const mejor = lista[0] || null;
      const segundo = lista[1] || null;
      return {
        reconocida: !!mejor && mejor.puntaje >= umbral,
        umbral,
        mejor,
        segundo_puntaje: segundo ? segundo.puntaje : 0,
        candidatos: lista.slice(0, 5),
        consultas: huellas.length,
        histograma: mejor ? [...votos.get(mejor.id)].sort((a, b) => a[0] - b[0]) : [],
      };
    }
  }

  return { PARAMS, fft, dft, hann, espectrograma, picos, hashes, huella, Indice };
});
