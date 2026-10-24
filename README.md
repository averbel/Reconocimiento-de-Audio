# Actividad 10 % — Reconocimiento de audio (música) con la Transformada de Fourier

Opción elegida: **2. Funcionamiento del reconocimiento de audio (música), uso de la TF (transformada de Fourier)**.

Cumple los cuatro puntos pedidos:

| Requisito | Dónde está |
|---|---|
| Investigación escrita en formato IEEE doble columna | `informe/paper.template.html` (fuente) → `informe/paper.html` |
| Modelos matemáticos | Secciones II y III del informe; implementados en `demo/lib/huella.js` |
| Demo funcional | `demo/` (Node.js + Express + Web Audio API) |
| Informe en PDF | **`informe/Informe_IEEE.pdf`** |
| Modelos matemáticos (PDF de referencia) | **`informe/Modelos_Matematicos.pdf`** |
| Manual de uso (PDF) | **`informe/Manual_de_Uso.pdf`** |

## Cómo funciona (resumen)

1. El audio se remuestrea a 8 kHz y se divide en ventanas de Hann de 1024 muestras (salto 256).
2. Cada ventana pasa por una **FFT** (Cooley–Tukey, implementada a mano) → espectrograma en dB.
3. Se detectan los **picos** (máximos locales): la "constelación".
4. Cada pico se une con los siguientes para formar **hashes** de 24 bits `(f1, f2, Δt)`.
5. El servidor tiene un **índice invertido** hash → (canción, tiempo). Cada hash de la consulta vota por el
   desplazamiento `t_bd − t_consulta`; la canción con más votos en un mismo desplazamiento gana.

El cálculo pesado (pasos 1–4) se hace en el navegador; al servidor solo viajan los hashes.

## Estructura

```
actividad_reconocimiento_audio/
├── demo/                      Aplicación web full stack
│   ├── server.js              API REST (Express) + índice en memoria
│   ├── iniciar.bat            Arranque con doble clic (Windows)
│   ├── lib/huella.js          FFT, DFT, Hann, espectrograma, picos, hashes, índice y votación
│   │                          (módulo universal: Node y navegador)
│   ├── lib/colores.js         Mapa de color del espectrograma (navegador e informe)
│   ├── api/index.js           Función serverless para Vercel
│   ├── vercel.json            Configuración de Vercel
│   ├── lib/sintesis.js        Canciones sintéticas, ruido, lectura/escritura de WAV
│   ├── public/                Frontend: index.html, styles.css, app.js, spectro3d.js (vista 3D),
│   │                          favicon.svg / favicon.ico / apple-touch-icon.png (logo de la pestaña)
│   │                          y audio/ (12 canciones WAV + catálogo)
│   ├── test/huella.test.js    13 pruebas automáticas
│   └── scripts/               generar_canciones.js, experimentos.js, sincronizar.js (solo Vercel)
└── informe/                   Informe IEEE
    ├── paper.template.html    Texto del informe (editar aquí)
    ├── build.js               Genera figuras, ecuaciones (KaTeX), tablas y el PDF del informe
    ├── build_modelos.js       Genera Modelos_Matematicos.pdf (plantilla: modelos.template.html)
    ├── build_manual.js        Genera Manual_de_Uso.pdf (plantilla: manual.template.html, capturas en figuras/manual/)
    ├── comun.js               Ecuaciones KaTeX y exportación a PDF, compartidas
    ├── Manual_de_Uso.pdf      Guía paso a paso: arranque, uso, resultados, solución de problemas y guion para exponer
    ├── Modelos_Matematicos.pdf  Todas las fórmulas usadas, con sus parámetros reales y su lugar en el código
    ├── resultados.json        Resultados de los experimentos
    └── Informe_IEEE.pdf       Entregable
```

## Cómo ejecutar la demo

Requiere Node.js.

```bash
cd demo
npm install
npm start          # http://localhost:3000
npm test           # 13 pruebas unitarias
```

La interfaz muestra el algoritmo paso a paso:

- **Etapas animadas** (Señal → FFT → Picos → Hashes → Votación): se iluminan mientras se reconoce y, al terminar,
  puedes pulsar cada una para ver qué hace (el visor activa los picos o los pares de hash según la etapa).
- **Espectrograma 3D** (Three.js, servido desde `node_modules`: funciona sin internet una vez hecho `npm install`): superficie con la potencia
  como altura y color, picos, pares de hash y cabezal de reproducción. Arrastra para girar, rueda para acercar,
  puntos de vista (perspectiva, superior, lateral, frontal), control de altura y giro automático. Hay también vista **2D**.
  Al pasar el cursor se lee tiempo, frecuencia y potencia.
- **Forma de onda**, **histograma de desplazamientos** y **medidor de confianza** (puntaje frente al umbral).
- **▶ Escuchar fragmento** y **▶ Canción completa** (pestaña Fragmento) se pueden usar antes de reconocer. **▶ Escuchar** (en el visor) reproduce lo ya analizado con un cabezal que recorre el espectrograma y la onda. Si no oyes nada, revisa el volumen del equipo y que la pestaña no esté silenciada.
- **Tema claro/oscuro** (botón de la esquina; recuerda tu elección) y diseño adaptable a celular y proyector.

Tres fuentes de audio:

- **Fragmento**: elige una canción de la base, el inicio, la duración y el nivel de ruido (SNR). Es la forma más rápida
  de probar. También se puede abrir directamente, por ejemplo:
  `http://localhost:3000/?cancion=tema07&inicio=12&dur=6&snr=5&auto=1`
  (`snr=inf` = sin ruido; opcionales: `vista=2d`, `pares=1`, `cam=superior|lateral|frontal`, `tema=oscuro`, `giro=1`).
- **Archivo**: sube cualquier audio. Solo se reconocerán las canciones de la base (son sintéticas), así que un MP3
  real debería dar "Sin coincidencia fiable".
- **Micrófono**: reproduce una canción de la base por los parlantes y graba unos segundos (pide permiso al navegador).

La vista 3D necesita WebGL; si no está disponible, la demo muestra automáticamente la vista 2D.

### API

| Ruta | Descripción |
|---|---|
| `GET /api/canciones` | Catálogo de la base |
| `GET /api/estado` | Tamaño del índice y parámetros |
| `POST /api/reconocer` | Cuerpo `{"huellas": [[hash, tiempo], ...]}` → candidatos, posición e histograma |

## Regenerar canciones, resultados e informe

```bash
cd demo
npm run canciones        # regenera public/audio/*.wav y catalogo.json
npm run experimentos     # actualiza informe/resultados.json (tarda ~1 min)
cd ../informe
npm install
npm run build            # genera Informe_IEEE.pdf (usa Edge o Chrome en modo headless)
npm run modelos          # genera Modelos_Matematicos.pdf
npm run manual           # genera Manual_de_Uso.pdf
```

Los experimentos son deterministas (semillas fijas), salvo los tiempos de ejecución.

## Notas

- Las canciones de la base son **sintéticas** (melodía + arpegio + bajo con armónicos), para no usar música con derechos
  de autor. Los resultados del informe no son extrapolables a música real; esto se discute en la sección VI.
- Si cambias algo en `informe/paper.template.html` (nombre, fecha, curso), vuelve a ejecutar `npm run build`.
- Revisa que las referencias coincidan con el formato que pida tu profesor.

## Despliegue en Vercel

Publicada en **https://reconocimiento-audio-fourier.vercel.app** (proyecto `reconocimiento-audio-fourier` de la cuenta `averbels-projects`).

La carpeta `demo/` ya está preparada: `api/index.js` es la función serverless (reutiliza la app de Express), `vercel.json` redirige
`/api/*` a esa función e incluye los WAV, y `npm run build` copia a `public/` los módulos que en local sirve Express
(`lib/` y Three.js desde `node_modules`). Para volver a publicar tras un cambio:

```bash
cd demo
npx vercel login           # solo la primera vez en cada equipo
npx vercel deploy --prod --scope averbels-projects
```

Notas: el índice de huellas se construye al arrancar cada instancia de la función (≈1 s en frío). El micrófono solo funciona en HTTPS
o `localhost`, y Vercel entrega HTTPS. `.env.local` y `.vercel/` contienen datos de la sesión: no los compartas ni los subas a un repositorio.
