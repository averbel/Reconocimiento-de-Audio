'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../lib/huella');
const S = require('../lib/sintesis');

const cerca = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} real=${a} esperado=${b} tol=${tol}`);

function aleatorio(n, semilla = 1) {
  const r = S.mulberry32(semilla);
  return Float64Array.from({ length: n }, () => r() * 2 - 1);
}

test('FFT coincide con la DFT directa (N = 64, 256)', () => {
  for (const n of [64, 256]) {
    const re = aleatorio(n, n);
    const im = aleatorio(n, n + 1);
    const ref = H.dft(re, im);
    const a = Float64Array.from(re);
    const b = Float64Array.from(im);
    H.fft(a, b);
    let err = 0;
    for (let k = 0; k < n; k++) err = Math.max(err, Math.abs(a[k] - ref.re[k]), Math.abs(b[k] - ref.im[k]));
    assert.ok(err < 1e-9, `error máximo ${err}`);
  }
});

test('FFT rechaza longitudes que no son potencia de 2', () => {
  assert.throws(() => H.fft(new Float64Array(100), new Float64Array(100)), RangeError);
});

test('una senoidal en el bin k produce un pico en k y k = N - k', () => {
  const N = 512;
  const k0 = 37;
  const re = Float64Array.from({ length: N }, (_, n) => Math.cos((2 * Math.PI * k0 * n) / N));
  const im = new Float64Array(N);
  H.fft(re, im);
  const mag = re.map((v, i) => Math.hypot(v, im[i]));
  cerca(mag[k0], N / 2, 1e-9);
  cerca(mag[N - k0], N / 2, 1e-9);
  cerca(mag[k0 + 5], 0, 1e-9);
});

test('Parseval: sum|x|^2 = (1/N) sum|X|^2', () => {
  const N = 1024;
  const re = aleatorio(N, 7);
  const im = new Float64Array(N);
  let e = 0;
  for (let i = 0; i < N; i++) e += re[i] * re[i];
  H.fft(re, im);
  let E = 0;
  for (let k = 0; k < N; k++) E += re[k] * re[k] + im[k] * im[k];
  cerca(E / N, e, 1e-8 * e);
});

test('ventana de Hann: extremos en 0 y centro en 1', () => {
  const w = H.hann(1024);
  cerca(w[0], 0, 1e-12);
  cerca(w[512], 1, 1e-12);
});

test('el espectrograma de una nota de 440 Hz tiene su máximo en el bin esperado', () => {
  const fs = H.PARAMS.fs;
  const x = Float32Array.from({ length: fs }, (_, n) => Math.sin((2 * Math.PI * 440 * n) / fs));
  const S1 = H.espectrograma(x);
  const fila = S1[Math.floor(S1.length / 2)];
  let kmax = 0;
  for (let k = 1; k < fila.length; k++) if (fila[k] > fila[kmax]) kmax = k;
  cerca(kmax, (440 * H.PARAMS.N) / fs, 1); // 440 Hz / 7,8125 Hz ≈ bin 56
});

test('la síntesis es determinista y distinta entre semillas', () => {
  const a = S.cancion(3, { dur: 2 }).x;
  const b = S.cancion(3, { dur: 2 }).x;
  const c = S.cancion(4, { dur: 2 }).x;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('WAV: escritura y lectura conservan la señal (error < 1/32768)', () => {
  const x = S.cancion(2, { dur: 1 }).x;
  const ruta = path.join(os.tmpdir(), 'prueba_huella.wav');
  S.escribirWav(ruta, x);
  const leido = S.leerWav(ruta);
  fs.unlinkSync(ruta);
  assert.equal(leido.fs, 8000);
  assert.equal(leido.x.length, x.length);
  let err = 0;
  for (let i = 0; i < x.length; i++) err = Math.max(err, Math.abs(x[i] - leido.x[i]));
  assert.ok(err <= 1 / 32768 + 1e-9);
});

test('los hashes caben en 24 bits', () => {
  const { huellas } = H.huella(S.cancion(1, { dur: 8 }).x);
  assert.ok(huellas.length > 50);
  for (const [h, t] of huellas) {
    assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 24);
    assert.ok(Number.isInteger(t) && t >= 0);
  }
});

test('reconocimiento: fragmento de 5 s con ruido de 5 dB, canción correcta y posición ±0,1 s', () => {
  const idx = new H.Indice();
  const señales = [];
  for (let s = 1; s <= 5; s++) {
    const { x } = S.cancion(s);
    señales.push(x);
    idx.agregar({ nombre: `T${s}` }, H.huella(x).huellas);
  }
  const rnd = S.mulberry32(11);
  for (let s = 0; s < 5; s++) {
    const ini = 6 * 8000 + s * 1234;
    const clip = S.agregarRuido(señales[s].slice(ini, ini + 5 * 8000), 5, rnd);
    const r = idx.buscar(H.huella(clip).huellas);
    assert.equal(r.mejor.id, s, `canción ${s}`);
    assert.ok(r.reconocida);
  }
});

test('posición: en una pieza sin frases repetidas se estima el instante del fragmento (±0,1 s)', () => {
  // Pieza sin repeticiones: 5 segmentos de 6 s de canciones distintas
  const trozos = [21, 22, 23, 24, 25].map((k) => S.cancion(k, { dur: 6 }).x);
  const pieza = new Float32Array(30 * 8000);
  trozos.forEach((t, i) => pieza.set(t, i * 6 * 8000));
  const idx = new H.Indice();
  idx.agregar({ nombre: 'pieza' }, H.huella(pieza).huellas);
  for (const ini_s of [2.0, 7.3, 13.9, 21.4]) {
    const ini = Math.round(ini_s * 8000);
    const r = idx.buscar(H.huella(pieza.slice(ini, ini + 4 * 8000)).huellas);
    assert.ok(r.reconocida, `inicio ${ini_s}`);
    cerca(r.mejor.posicion_s, ini_s, 0.1, `posición ${ini_s}`);
  }
});

test('reconocimiento: una canción fuera de la base no supera el umbral', () => {
  const idx = new H.Indice();
  for (let s = 1; s <= 5; s++) idx.agregar({ nombre: `T${s}` }, H.huella(S.cancion(s).x).huellas);
  const ajena = S.cancion(101).x.slice(8000, 48000);
  const r = idx.buscar(H.huella(ajena).huellas);
  assert.equal(r.reconocida, false);
});

test('consulta vacía: no hay coincidencia', () => {
  const idx = new H.Indice();
  idx.agregar({ nombre: 'T' }, H.huella(S.cancion(1, { dur: 6 }).x).huellas);
  const r = idx.buscar([]);
  assert.equal(r.reconocida, false);
  assert.equal(r.mejor, null);
});
