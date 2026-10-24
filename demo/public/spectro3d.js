import * as THREE from 'three';
import { OrbitControls } from '/vendor/three-examples/controls/OrbitControls.js';

/**
 * Espectrograma 3D: superficie S[tiempo, frecuencia] con la potencia (dB) como altura y color,
 * constelación de picos, pares ancla-objetivo y cabezal de reproducción.
 * Ejes: x = tiempo, z = frecuencia (0 Hz al frente), y = potencia.
 * Usa el global `Colores` (lib/colores.js), cargado antes como script clásico.
 */

const KMAX = 256; // 0 – 2 kHz
const DEC = 2; // se toma el máximo de cada 2 bins de frecuencia
const MAXT = 360; // máximo de columnas de tiempo en la malla
const ANCHO = 14; // tamaño de la escena en x (tiempo)
const FONDO = 6; // tamaño de la escena en z (frecuencia)
const ALTO = 3; // altura máxima con escala = 1
const RANGO_DB = 70; // se muestran los 70 dB por debajo del máximo
const EXP = 1.9; // realce de contraste: aplana el ruido de fondo y destaca las notas

const css = (nombre) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || '#888';

const VISTAS = {
  perspectiva: { pos: [4.2, 7.4, 12.6], objetivo: [0, 0.4, 0.5] },
  superior: { pos: [0, 14.5, 0.01], objetivo: [0, 0, 0.3] },
  lateral: { pos: [-15, 4.2, 4], objetivo: [0, 0.9, 0] },
  frontal: { pos: [0, 3.6, 13.5], objetivo: [0, 0.8, 0] },
};

export function crearEspectro3D(contenedor, { alPasar } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  contenedor.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
  const controles = new OrbitControls(camara, renderer.domElement);
  controles.enableDamping = true;
  controles.dampingFactor = 0.08;
  controles.maxPolarAngle = Math.PI * 0.499;
  controles.minDistance = 5;
  controles.maxDistance = 45;
  controles.autoRotateSpeed = 1.1;
  controles.addEventListener('start', () => { estado.tocado = true; });

  escena.add(new THREE.AmbientLight(0xffffff, 1.35));
  const sol = new THREE.DirectionalLight(0xffffff, 1.7);
  sol.position.set(-6, 12, 9);
  escena.add(sol);

  const grupo = new THREE.Group();
  escena.add(grupo);

  /* ------------------------------------------------------------ estado */
  const estado = {
    S: null, T: 0, NT: 0, NK: 0, gmax: 0, duracion: 0, fs: 8000, hop: 256, N: 1024,
    picos: null, pares: [], escala: 1, mostrarPicos: true, mostrarPares: false,
    malla: null, marcadores: null, tallos: null, lineasPares: null, cabezal: null, etiquetas: null,
    visible: true, destinoVista: null,
  };

  const xDe = (t) => (t / Math.max(1, estado.T - 1) - 0.5) * ANCHO;
  const zDe = (k) => (0.5 - k / KMAX) * FONDO;
  const vDe = (db) => Math.min(1, Math.max(0, (db - (estado.gmax - RANGO_DB)) / RANGO_DB));
  const yDe = (v) => Math.pow(v, EXP) * ALTO * estado.escala;

  function liberar(obj) {
    if (!obj) return;
    obj.traverse?.((o) => {
      o.geometry?.dispose?.();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose(); });
    });
    obj.parent?.remove(obj);
  }

  /* ------------------------------------------------------------ construcción */
  function etiqueta(texto, { tam = 0.55, color, negrita = false } = {}) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const fuente = `${negrita ? '600 ' : ''}44px system-ui, "Segoe UI", sans-serif`;
    ctx.font = fuente;
    const w = Math.ceil(ctx.measureText(texto).width) + 16;
    c.width = w;
    c.height = 64;
    ctx.font = fuente;
    ctx.fillStyle = color || css('--texto-suave');
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(texto, w / 2, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.set((tam * w) / 64, tam, 1);
    return spr;
  }

  function construirEjes() {
    liberar(estado.etiquetas);
    const g = new THREE.Group();
    const linea = css('--rejilla');
    const mat = new THREE.LineBasicMaterial({ color: linea, transparent: true, opacity: 0.9 });
    const pts = [];
    const seg = estado.duracion;
    const paso = seg > 12 ? 2 : 1;
    // Rejilla del suelo: una línea por segundo (x) y por 500 Hz (z)
    for (let s = 0; s <= seg + 1e-6; s += paso) {
      const x = xDe((s * estado.fs) / estado.hop);
      if (Math.abs(x) <= ANCHO / 2 + 1e-6) pts.push(x, 0, -FONDO / 2, x, 0, FONDO / 2);
    }
    for (let f = 0; f <= 2000; f += 500) {
      const z = zDe((f * estado.N) / estado.fs);
      pts.push(-ANCHO / 2, 0, z, ANCHO / 2, 0, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(geo, mat));

    const suelo = new THREE.Mesh(new THREE.PlaneGeometry(ANCHO, FONDO), new THREE.MeshBasicMaterial({ color: css('--suelo3d'), transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    suelo.rotation.x = -Math.PI / 2;
    suelo.position.y = -0.01;
    g.add(suelo);

    for (let s = 0; s <= seg + 1e-6; s += paso) {
      const x = xDe((s * estado.fs) / estado.hop);
      if (Math.abs(x) > ANCHO / 2 + 1e-6) continue;
      const e = etiqueta(String(s), { tam: 0.5 });
      e.position.set(x, 0, FONDO / 2 + 0.55);
      g.add(e);
    }
    // Eje de frecuencia a ambos lados: así siempre queda uno a la vista, sea cual sea el punto de vista
    for (const lado of [-1, 1]) {
      for (const khz of [0, 0.5, 1, 1.5, 2]) {
        const e = etiqueta(String(khz).replace('.', ','), { tam: 0.5 });
        e.position.set(lado * (ANCHO / 2 + 0.6), 0, zDe((khz * 1000 * estado.N) / estado.fs));
        g.add(e);
      }
      const ef = etiqueta('Frec. (kHz)', { tam: 0.55, negrita: true, color: css('--texto') });
      ef.position.set(lado * (ANCHO / 2 + 1.7), 0, 0);
      g.add(ef);
    }
    const et = etiqueta('Tiempo (s)', { tam: 0.62, negrita: true, color: css('--texto') });
    et.position.set(0, 0, FONDO / 2 + 1.35);
    g.add(et);

    estado.etiquetas = g;
    grupo.add(g);
  }

  function construirMalla() {
    liberar(estado.malla);
    const { S, T } = estado;
    const NK = KMAX / DEC;
    const paso = Math.max(1, Math.ceil(T / MAXT));
    const NT = Math.ceil(T / paso);
    estado.NK = NK;
    estado.NT = NT;
    const posiciones = new Float32Array(NT * NK * 3);
    const colores = new Float32Array(NT * NK * 3);
    let p = 0;
    for (let i = 0; i < NT; i++) {
      const t0 = i * paso;
      const t1 = Math.min(T, t0 + paso);
      for (let j = 0; j < NK; j++) {
        let m = -Infinity;
        for (let t = t0; t < t1; t++) for (let k = j * DEC; k < (j + 1) * DEC; k++) if (S[t][k] > m) m = S[t][k];
        const v = vDe(m);
        const [r, g, b] = Colores.colorMapa(v).map((c) => c / 255);
        posiciones[p] = xDe(Math.min(T - 1, t0 + (t1 - t0 - 1) / 2));
        posiciones[p + 1] = Math.pow(v, EXP) * ALTO; // se escala con mesh.scale.y
        posiciones[p + 2] = zDe(j * DEC + (DEC - 1) / 2);
        colores[p] = r; colores[p + 1] = g; colores[p + 2] = b;
        p += 3;
      }
    }
    const indices = [];
    for (let i = 0; i < NT - 1; i++) {
      for (let j = 0; j < NK - 1; j++) {
        const a = i * NK + j, b = a + 1, c = a + NK, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colores, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const malla = new THREE.Mesh(geo, mat);
    malla.scale.y = estado.escala;
    estado.malla = malla;
    grupo.add(malla);
  }

  function construirPicos() {
    liberar(estado.marcadores);
    liberar(estado.tallos);
    liberar(estado.lineasPares);
    const p = estado.picos;
    if (!p || !p.t.length) return;
    const validos = [];
    for (let i = 0; i < p.t.length; i++) if (p.k[i] < KMAX) validos.push(i);
    estado.validos = validos;

    const esfera = new THREE.SphereGeometry(0.1, 14, 10);
    const marcadores = new THREE.InstancedMesh(esfera, new THREE.MeshBasicMaterial({ color: 0xff3030 }), validos.length);
    estado.marcadores = marcadores;
    grupo.add(marcadores);

    const tallos = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.55 }));
    tallos.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(validos.length * 6), 3));
    estado.tallos = tallos;
    grupo.add(tallos);

    const lp = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x35d6ff, transparent: true, opacity: 0.5 }));
    lp.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(estado.pares.length * 6), 3));
    estado.lineasPares = lp;
    grupo.add(lp);
    reposicionarPicos();
  }

  function posPico(i) {
    const { S, picos } = estado;
    const db = S[picos.t[i]][picos.k[i]];
    return [xDe(picos.t[i]), yDe(vDe(db)) + 0.16, zDe(picos.k[i])];
  }

  function reposicionarPicos() {
    const { marcadores, tallos, lineasPares, validos } = estado;
    if (!marcadores) return;
    const m = new THREE.Matrix4();
    const arr = tallos.geometry.attributes.position.array;
    validos.forEach((i, n) => {
      const [x, y, z] = posPico(i);
      m.makeTranslation(x, y, z);
      marcadores.setMatrixAt(n, m);
      arr.set([x, 0, z, x, y, z], n * 6);
    });
    marcadores.instanceMatrix.needsUpdate = true;
    tallos.geometry.attributes.position.needsUpdate = true;
    tallos.geometry.computeBoundingSphere();
    const ap = lineasPares.geometry.attributes.position.array;
    estado.pares.forEach(([a, b], n) => {
      const A = posPico(a), B = posPico(b);
      ap.set([...A, ...B], n * 6);
    });
    lineasPares.geometry.attributes.position.needsUpdate = true;
    lineasPares.geometry.computeBoundingSphere();
    marcadores.visible = tallos.visible = estado.mostrarPicos;
    lineasPares.visible = estado.mostrarPares;
  }

  function construirCabezal() {
    liberar(estado.cabezal);
    const g = new THREE.Group();
    const plano = new THREE.Mesh(
      new THREE.PlaneGeometry(FONDO, ALTO * 1.5),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    plano.rotation.y = Math.PI / 2;
    plano.position.y = ALTO * 0.75;
    g.add(plano);
    const borde = new THREE.LineSegments(new THREE.EdgesGeometry(plano.geometry), new THREE.LineBasicMaterial({ color: 0xffd23f }));
    borde.rotation.y = Math.PI / 2;
    borde.position.y = ALTO * 0.75;
    g.add(borde);
    g.visible = false;
    estado.cabezal = g;
    grupo.add(g);
  }

  /* ------------------------------------------------------------ API pública */
  function actualizar({ S, picos, pares, duracionS, fs, hop, N }) {
    Object.assign(estado, { S, T: S.length, picos, pares: pares || [], duracion: duracionS, fs, hop, N });
    let gmax = -Infinity;
    for (const fila of S) for (let k = 0; k < KMAX; k++) if (fila[k] > gmax) gmax = fila[k];
    estado.gmax = gmax;
    construirMalla();
    construirEjes();
    construirPicos();
    construirCabezal();
    ajustarTamano();
    if (!estado.tocado) fijarVista(estado.vistaActual || 'perspectiva', false);
  }

  function fijarVista(nombre, animar = true) {
    estado.vistaActual = nombre;
    const v = VISTAS[nombre] || VISTAS.perspectiva;
    // Las vistas están pensadas para un visor ancho (≈ 1,8:1); en visores más estrechos se aleja la cámara
    const ajuste = Math.max(1, 1.8 / Math.max(0.5, camara.aspect)) ** 0.85;
    const objetivo = new THREE.Vector3(...v.objetivo);
    const pos = objetivo.clone().add(new THREE.Vector3(...v.pos).sub(objetivo).multiplyScalar(ajuste));
    estado.destinoVista = { pos, obj: objetivo, t0: performance.now(), pos0: camara.position.clone(), obj0: controles.target.clone() };
    if (!animar) {
      camara.position.copy(estado.destinoVista.pos);
      controles.target.copy(estado.destinoVista.obj);
      estado.destinoVista = null;
    }
  }

  function fijarEscala(e) {
    estado.escala = e;
    if (estado.malla) {
      estado.malla.scale.y = e;
      reposicionarPicos();
    }
  }

  function fijarCabezal(f) {
    if (!estado.cabezal) return;
    if (f === null || f === undefined) {
      estado.cabezal.visible = false;
      return;
    }
    estado.cabezal.visible = true;
    estado.cabezal.position.x = (Math.min(1, Math.max(0, f)) - 0.5) * ANCHO;
  }

  function ajustarTamano() {
    const w = contenedor.clientWidth || 600;
    const h = contenedor.clientHeight || 400;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camara.aspect = w / h;
    camara.updateProjectionMatrix();
  }

  function aplicarTema() {
    escena.background = new THREE.Color(css('--lienzo3d'));
    if (estado.S) construirEjes();
  }

  /* ------------------------------------------------------------ lectura al pasar el ratón */
  const rayo = new THREE.Raycaster();
  const puntero = new THREE.Vector2();
  let pendiente = null;
  renderer.domElement.addEventListener('pointermove', (e) => {
    pendiente = e;
  });
  renderer.domElement.addEventListener('pointerleave', () => {
    pendiente = null;
    alPasar?.(null);
  });
  function leerPuntero() {
    if (!pendiente || !estado.malla) return;
    const r = renderer.domElement.getBoundingClientRect();
    const px = pendiente.clientX - r.left;
    const py = pendiente.clientY - r.top;
    puntero.set((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1);
    pendiente = null;
    rayo.setFromCamera(puntero, camara);
    const hit = rayo.intersectObject(estado.malla, false)[0];
    if (!hit) return alPasar?.(null);
    const t = Math.round((hit.point.x / ANCHO + 0.5) * (estado.T - 1));
    const k = Math.round((0.5 - hit.point.z / FONDO) * KMAX);
    if (t < 0 || t >= estado.T || k < 0 || k >= KMAX) return alPasar?.(null);
    alPasar?.({ t_s: (t * estado.hop) / estado.fs, f_hz: (k * estado.fs) / estado.N, db: estado.S[t][k], px, py });
  }

  /* ------------------------------------------------------------ bucle */
  function bucle() {
    requestAnimationFrame(bucle);
    if (!estado.visible || !contenedor.offsetParent) return;
    const d = estado.destinoVista;
    if (d) {
      const u = Math.min(1, (performance.now() - d.t0) / 650);
      const e = u * u * (3 - 2 * u);
      camara.position.lerpVectors(d.pos0, d.pos, e);
      controles.target.lerpVectors(d.obj0, d.obj, e);
      if (u >= 1) estado.destinoVista = null;
    }
    controles.update();
    leerPuntero();
    renderer.render(escena, camara);
  }

  new ResizeObserver(ajustarTamano).observe(contenedor);
  aplicarTema();
  fijarVista('perspectiva', false);
  ajustarTamano();
  bucle();

  return {
    actualizar,
    fijarVista,
    fijarEscala,
    fijarCabezal,
    aplicarTema,
    giroAutomatico: (v) => (controles.autoRotate = !!v),
    mostrarPicos: (v) => { estado.mostrarPicos = !!v; if (estado.marcadores) estado.marcadores.visible = estado.tallos.visible = !!v; },
    mostrarPares: (v) => { estado.mostrarPares = !!v; if (estado.lineasPares) estado.lineasPares.visible = !!v; },
    visible: (v) => { estado.visible = !!v; if (v) ajustarTamano(); },
  };
}
