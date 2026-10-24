'use strict';

/**
 * Experimentos que alimentan el informe. Uso: node scripts/experimentos.js  (escribe ../informe/resultados.json)
 * Todo es determinista (semillas fijas), salvo los tiempos de ejecución.
 */

const fs = require('node:fs');
const path = require('node:path');
const H = require('../lib/huella');
const S = require('../lib/sintesis');

const FS = H.PARAMS.fs;
const N_BD = 12;
const SEM_BD = Array.from({ length: N_BD }, (_, i) => i + 1);
const SEM_AJENAS = Array.from({ length: N_BD }, (_, i) => 101 + i);

const bd = SEM_BD.map((s) => S.cancion(s).x);
const ajenas = SEM_AJENAS.map((s) => S.cancion(s).x);

function construirIndice(opc = {}) {
  const idx = new H.Indice();
  bd.forEach((x, i) => idx.agregar({ nombre: `Tema ${i + 1}` }, H.huella(x, opc).huellas));
  return idx;
}

/** Fragmento aleatorio (con ruido opcional) de `dur` s. */
function fragmento(x, dur, snr, rnd) {
  const n = Math.round(dur * FS);
  const ini = Math.floor(rnd() * (x.length - n));
  const c = x.slice(ini, ini + n);
  return Number.isFinite(snr) ? S.agregarRuido(c, snr, rnd) : c;
}

const mediana = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[b.length >> 1] : 0;
};

/* ------------------------------------------------------------------ 1. FFT vs DFT */
function fftVsDft() {
  const filas = [];
  const rnd = S.mulberry32(1);
  for (const N of [64, 128, 256, 512, 1024, 2048, 4096]) {
    const re0 = Float64Array.from({ length: N }, () => rnd() * 2 - 1);
    const im0 = Float64Array.from({ length: N }, () => rnd() * 2 - 1);
    const repsFFT = Math.max(200, Math.floor(4e6 / N));
    const repsDFT = Math.max(3, Math.floor(1e8 / (N * N * 20)));
    // Calentamiento (compilación JIT) antes de medir
    for (let r = 0; r < 20; r++) H.fft(Float64Array.from(re0), Float64Array.from(im0));
    H.dft(re0, im0);
    let t0 = process.hrtime.bigint();
    for (let r = 0; r < repsFFT; r++) {
      const a = Float64Array.from(re0);
      const b = Float64Array.from(im0);
      H.fft(a, b);
    }
    const tFFT = Number(process.hrtime.bigint() - t0) / 1e6 / repsFFT;
    t0 = process.hrtime.bigint();
    let ref;
    for (let r = 0; r < repsDFT; r++) ref = H.dft(re0, im0);
    const tDFT = Number(process.hrtime.bigint() - t0) / 1e6 / repsDFT;
    const a = Float64Array.from(re0);
    const b = Float64Array.from(im0);
    H.fft(a, b);
    let err = 0;
    for (let k = 0; k < N; k++) err = Math.max(err, Math.abs(a[k] - ref.re[k]), Math.abs(b[k] - ref.im[k]));
    filas.push({ N, fft_ms: tFFT, dft_ms: tDFT, aceleracion: tDFT / tFFT, error_max: err });
  }
  return filas;
}

/* ------------------------------------------------------------------ 2. exactitud vs SNR y duración */
function exactitud(idx) {
  const rnd = S.mulberry32(42);
  const SNRS = [Infinity, 20, 10, 0, -5, -10, -15];
  const DURS = [2, 3, 5, 10];
  const REP = 5;
  const celdas = [];
  for (const dur of DURS) {
    for (const snr of SNRS) {
      let top1 = 0;
      let aceptadas = 0;
      let n = 0;
      const puntajes = [];
      for (let s = 0; s < N_BD; s++) {
        for (let r = 0; r < REP; r++) {
          const c = fragmento(bd[s], dur, snr, rnd);
          const res = idx.buscar(H.huella(c).huellas);
          n++;
          const bien = res.mejor && res.mejor.id === s;
          if (bien) {
            top1++;
            puntajes.push(res.mejor.puntaje);
            if (res.reconocida) aceptadas++;
          }
        }
      }
      celdas.push({ dur_s: dur, snr_db: Number.isFinite(snr) ? snr : null, n, top1: top1 / n, aceptadas: aceptadas / n, puntaje_mediano: mediana(puntajes) });
    }
  }
  return { snrs: SNRS.map((s) => (Number.isFinite(s) ? s : null)), durs: DURS, celdas };
}

/* ------------------------------------------------------------------ 3. falsos positivos (canciones fuera de la base) */
function falsosPositivos(idx) {
  const rnd = S.mulberry32(77);
  const filas = [];
  for (const dur of [2, 5, 10]) {
    for (const snr of [Infinity, 0]) {
      let fp = 0;
      let n = 0;
      let max = 0;
      const sc = [];
      for (let s = 0; s < N_BD; s++) {
        for (let r = 0; r < 5; r++) {
          const res = idx.buscar(H.huella(fragmento(ajenas[s], dur, snr, rnd)).huellas);
          const p = res.mejor ? res.mejor.puntaje : 0;
          sc.push(p);
          max = Math.max(max, p);
          n++;
          if (res.reconocida) fp++;
        }
      }
      filas.push({ dur_s: dur, snr_db: Number.isFinite(snr) ? snr : null, n, falsos_positivos: fp, tasa: fp / n, puntaje_max: max, puntaje_mediano: mediana(sc) });
    }
  }
  return filas;
}

/* ------------------------------------------------------------------ 4. sensibilidad al margen de picos */
function sensibilidadMargen() {
  const filas = [];
  for (const margenDb of [8, 12, 20, 30, 45]) {
    const opc = { margenDb };
    const idx = construirIndice(opc);
    const rnd = S.mulberry32(9);
    const medir = (snr) => {
      let ok = 0;
      let n = 0;
      for (let s = 0; s < N_BD; s++) {
        for (let r = 0; r < 3; r++) {
          const res = idx.buscar(H.huella(fragmento(bd[s], 5, snr, rnd), opc).huellas, { umbral: 0 });
          n++;
          if (res.mejor && res.mejor.id === s) ok++;
        }
      }
      return ok / n;
    };
    let fpMax = 0;
    for (let s = 0; s < N_BD; s++) {
      const res = idx.buscar(H.huella(fragmento(ajenas[s], 5, Infinity, rnd), opc).huellas, { umbral: 0 });
      fpMax = Math.max(fpMax, res.mejor ? res.mejor.puntaje : 0);
    }
    filas.push({ margen_db: margenDb, huellas_por_s: idx.total / (N_BD * 30), top1_0db: medir(0), top1_m5db: medir(-5), puntaje_ajeno_max: fpMax });
  }
  return filas;
}

/* ------------------------------------------------------------------ 5. costo y colisiones */
function costos(idx) {
  const rnd = S.mulberry32(5);
  const clips = Array.from({ length: 30 }, (_, i) => fragmento(bd[i % N_BD], 5, 10, rnd));
  let tF = 0;
  let tB = 0;
  for (const c of clips) {
    let t0 = process.hrtime.bigint();
    const h = H.huella(c).huellas;
    tF += Number(process.hrtime.bigint() - t0) / 1e6;
    t0 = process.hrtime.bigint();
    idx.buscar(h);
    tB += Number(process.hrtime.bigint() - t0) / 1e6;
  }
  // Coincidencias "por azar": hashes de una canción ajena que existen en el índice
  let consultas = 0;
  let aciertos = 0;
  let entradas = 0;
  for (const x of ajenas) {
    for (const [h] of H.huella(x.slice(0, 5 * FS)).huellas) {
      consultas++;
      const a = idx.mapa.get(h);
      if (a) {
        aciertos++;
        entradas += a.length;
      }
    }
  }
  const t0 = process.hrtime.bigint();
  construirIndice();
  return {
    huellas_totales: idx.total,
    huellas_unicas: idx.mapa.size,
    huellas_por_s: idx.total / (N_BD * 30),
    espacio_hash: 2 ** 24,
    ocupacion: idx.mapa.size / 2 ** 24,
    huella_ms_5s: tF / clips.length,
    busqueda_ms_5s: tB / clips.length,
    construccion_bd_ms: Number(process.hrtime.bigint() - t0) / 1e6,
    azar_hit: aciertos / consultas,
    azar_entradas_por_hit: aciertos ? entradas / aciertos : 0,
  };
}

/* ------------------------------------------------------------------ 6. ejemplo de histograma */
function ejemploHistograma(idx) {
  const rnd = S.mulberry32(2024);
  const s = 6; // Tema 07
  const ini = 12 * FS;
  const c = S.agregarRuido(bd[s].slice(ini, ini + 5 * FS), 5, rnd);
  const votos = idx.votar(H.huella(c).huellas);
  const lista = idx.puntajes(votos);
  const mejor = lista[0];
  const rival = lista.find((r) => r.id !== mejor.id);
  const aOrden = (id) => [...votos.get(id)].sort((a, b) => a[0] - b[0]);
  return {
    cancion: s + 1,
    inicio_s: 12,
    snr_db: 5,
    mejor: { id: mejor.id + 1, puntaje: mejor.puntaje, desplazamiento: mejor.desplazamiento, hist: aOrden(mejor.id) },
    rival: { id: rival.id + 1, puntaje: rival.puntaje, hist: aOrden(rival.id) },
  };
}

function ejecutar() {
  const idx = construirIndice();
  console.log('FFT vs DFT…');
  const fft_dft = fftVsDft();
  console.log('Exactitud vs SNR…');
  const exact = exactitud(idx);
  console.log('Falsos positivos…');
  const fp = falsosPositivos(idx);
  console.log('Sensibilidad al margen…');
  const sens = sensibilidadMargen();
  console.log('Costos…');
  const cost = costos(idx);
  return {
    parametros: H.PARAMS,
    n_canciones: N_BD,
    duracion_cancion_s: 30,
    fft_dft,
    exactitud: exact,
    falsos_positivos: fp,
    sensibilidad_margen: sens,
    costos: cost,
    histograma: ejemploHistograma(idx),
  };
}

module.exports = { ejecutar };

if (require.main === module) {
  const res = ejecutar();
  const destino = path.join(__dirname, '..', '..', 'informe', 'resultados.json');
  fs.writeFileSync(destino, JSON.stringify(res));
  console.log('Resultados escritos en', destino);
  console.table(res.fft_dft.map((f) => ({ N: f.N, fft_ms: +f.fft_ms.toFixed(4), dft_ms: +f.dft_ms.toFixed(3), x: +f.aceleracion.toFixed(0), err: f.error_max.toExponential(1) })));
  console.table(res.exactitud.celdas.map((c) => ({ dur: c.dur_s, snr: c.snr_db, top1: +c.top1.toFixed(2), acept: +c.aceptadas.toFixed(2), med: c.puntaje_mediano })));
  console.table(res.falsos_positivos);
  console.table(res.sensibilidad_margen);
  console.log(res.costos);
}
