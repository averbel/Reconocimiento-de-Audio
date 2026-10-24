'use strict';

/**
 * Síntesis de "canciones" de prueba (sin derechos de autor): melodía + arpegio + bajo con armónicos.
 * Determinista: la misma semilla produce siempre la misma pieza.
 */

const fs_ = require('node:fs');

const FS = 8000;
const NOTAS = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const ESCALAS = {
  mayor: [0, 2, 4, 5, 7, 9, 11],
  menor: [0, 2, 3, 5, 7, 8, 10],
  pentatónica: [0, 2, 4, 7, 9],
  dórica: [0, 2, 3, 5, 7, 9, 10],
};

function mulberry32(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiAHz = (n, centavos = 0) => 440 * 2 ** ((n - 69) / 12 + centavos / 1200);

/** Genera una canción de `dur` segundos. Devuelve {x: Float32Array, meta}. */
function cancion(semilla, { dur = 30, fs = FS } = {}) {
  const rnd = mulberry32(semilla * 7919 + 13);
  const elegir = (arr) => arr[Math.floor(rnd() * arr.length)];
  // Cada pieza tiene su propia afinación (±50 centavos), como ocurre con grabaciones distintas
  const centavos = Math.round((rnd() - 0.5) * 100);
  const nombreEscala = elegir(Object.keys(ESCALAS));
  const escala = ESCALAS[nombreEscala];
  const L = escala.length;
  const bpm = 80 + Math.floor(rnd() * 60);
  const beat = 60 / bpm;
  const raiz = 48 + Math.floor(rnd() * 12);
  const armonicos = [1, 0.25 + 0.4 * rnd(), 0.08 + 0.3 * rnd(), 0.03 + 0.12 * rnd()];

  const grado = (d) => escala[((d % L) + L) % L] + 12 * Math.floor(d / L);

  // Frases de 8 pulsos: lista de {ini, dur, d} (d = grado de la escala o null para silencio)
  const frase = () => {
    const notas = [];
    let pulso = 0;
    let d = Math.floor(rnd() * L);
    while (pulso < 8) {
      const largo = Math.min(elegir([0.5, 0.5, 1, 1, 1.5, 2]), 8 - pulso);
      if (rnd() > 0.12) notas.push({ ini: pulso, dur: largo, d });
      const paso = rnd() < 0.15 ? elegir([-4, -3, 3, 4]) : elegir([-2, -1, -1, 0, 1, 1, 2]);
      d = Math.max(-1, Math.min(2 * L - 1, d + paso));
      pulso += largo;
    }
    return { notas, bajo: [0, elegir([2, 3, 4]), elegir([3, 4, 5]), 0].map((g) => g % L) };
  };
  const A = frase();
  const B = frase();
  const C = frase();
  const orden = [A, B, A, C];

  const n = Math.round(dur * fs);
  const x = new Float32Array(n);

  const tono = (hz, ini, largo, amp) => {
    const i0 = Math.round(ini * fs);
    const i1 = Math.min(n, Math.round((ini + largo) * fs));
    const tau = Math.min(largo, 0.7) / 2.5;
    for (let i = i0; i < i1; i++) {
      const t = (i - i0) / fs;
      const atq = Math.min(1, t / 0.01);
      const rel = Math.min(1, (largo - t) / 0.03);
      const env = atq * Math.max(0, rel) * Math.exp(-t / tau);
      let v = 0;
      for (let h = 0; h < armonicos.length; h++) {
        const f = hz * (h + 1);
        if (f < fs / 2 - 200) v += armonicos[h] * Math.sin(2 * Math.PI * f * t);
      }
      x[i] += amp * env * v;
    }
  };

  let pulsoGlobal = 0;
  let p = 0;
  while (pulsoGlobal * beat < dur) {
    const f = orden[p % orden.length];
    for (const nota of f.notas) {
      tono(midiAHz(raiz + 12 + grado(nota.d), centavos), (pulsoGlobal + nota.ini) * beat, nota.dur * beat, 0.35);
    }
    // bajo: una nota cada 2 pulsos; arpegio de la tríada en corcheas
    for (let b = 0; b < 8; b += 2) {
      const g = f.bajo[b / 2];
      tono(midiAHz(raiz - 12 + grado(g), centavos), (pulsoGlobal + b) * beat, 2 * beat, 0.3);
      for (let j = 0; j < 4; j++) {
        const gr = g + [0, 2, 4, 2][j];
        tono(midiAHz(raiz + grado(gr), centavos), (pulsoGlobal + b + j * 0.5) * beat, 0.5 * beat, 0.12);
      }
    }
    pulsoGlobal += 8;
    p++;
  }

  let pico = 0;
  for (let i = 0; i < n; i++) pico = Math.max(pico, Math.abs(x[i]));
  for (let i = 0; i < n; i++) x[i] = (0.8 * x[i]) / (pico || 1);

  return {
    x,
    meta: {
      semilla,
      escala: nombreEscala,
      tonica: NOTAS[raiz % 12],
      bpm,
      centavos,
      descripcion: `${nombreEscala} en ${NOTAS[raiz % 12]}, ${bpm} bpm`,
    },
  };
}

/** Ruido gaussiano blanco para una relación señal-ruido (dB) respecto a la potencia de x. */
function agregarRuido(x, snrDb, rnd = Math.random) {
  let pot = 0;
  for (let i = 0; i < x.length; i++) pot += x[i] * x[i];
  pot /= x.length || 1;
  const sigma = Math.sqrt(pot / 10 ** (snrDb / 10));
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i += 2) {
    const u = Math.max(rnd(), 1e-12);
    const r = Math.sqrt(-2 * Math.log(u));
    const a = 2 * Math.PI * rnd();
    y[i] = x[i] + sigma * r * Math.cos(a);
    if (i + 1 < x.length) y[i + 1] = x[i + 1] + sigma * r * Math.sin(a);
  }
  return y;
}

/* ------------------------------------------------------------------ WAV PCM 16 bits mono */
function escribirWav(ruta, x, fs = FS) {
  const datos = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) datos.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), i * 2);
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0);
  cab.writeUInt32LE(36 + datos.length, 4);
  cab.write('WAVEfmt ', 8);
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20);
  cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(fs, 24);
  cab.writeUInt32LE(fs * 2, 28);
  cab.writeUInt16LE(2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write('data', 36);
  cab.writeUInt32LE(datos.length, 40);
  fs_.writeFileSync(ruta, Buffer.concat([cab, datos]));
}

function leerWav(ruta) {
  const b = fs_.readFileSync(ruta);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('No es un WAV válido');
  const fs = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  if (bits !== 16 || b.readUInt16LE(22) !== 1) throw new Error('Solo se admite WAV PCM de 16 bits mono');
  const n = (b.length - 44) / 2;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = b.readInt16LE(44 + 2 * i) / 32767;
  return { x, fs };
}

module.exports = { FS, mulberry32, cancion, agregarRuido, escribirWav, leerWav };
