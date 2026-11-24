# Agents.md — Master Architecture & Engineering Rules (Board2CAD)

> **PRIORITÀ ASSOLUTA:** Questo documento definisce le regole architetturali, stilistiche e tecnologiche vincolanti per l'intero repository **Board2CAD**. Qualsiasi modifica, nuova funzionalità o generazione di modelli 3D deve conformarsi rigorosamente a queste direttive.

---

## 1. Identità del Progetto & Stack Tecnologico

- **Nome Applicazione:** `Board2CAD` (sottotitolo: *PCB 3D Parametric Studio*)
- **Versione Corrente (`APP_VERSION`):** `v1.5.0` (allineata in `js/app.js`, `sw.js`, `manifest.webmanifest`, `CHANGELOG.md` e badge UI nell'header).
- **Zero Framework & Zero Build Step:**
  - È **severamente vietato** introdurre React, Vue, Svelte, Angular, Tailwind CSS, jQuery, Webpack, Vite o dipendenze `node_modules` lato runtime.
  - L'applicazione deve funzionare **100% client-side** servendo direttamente la root del repository tramite qualsiasi server statico (Live Server, Python `http.server`, GitHub Pages, Cloudflare Workers).
  - Usa esclusivamente **HTML5 semantico**, **CSS3 moderno** (Custom Properties `--var`, CSS Grid, Flexbox, Media Queries Mobile-First) e **JavaScript Vanilla ES6+ (`type="module"`)**.
- **Dipendenze Client-Side Consentite (via Import Map / ES Module CDN con fallback locale/graceful):**
  - `three` e `three/addons/` (`OrbitControls`, `STLLoader`, `ThreeMFLoader`, `STLExporter`) via CDN ESM (`https://esm.sh/three@0.164.1` / `https://cdn.jsdelivr.net/npm/three@0.164.1/+esm`).
  - `jszip` (`https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm`) per l'esportazione `.zip` client-side della cartella modello.
  - `openscad-wasm` nel Web Worker dedicato (`js/workers/openscad.worker.js`), con fallback CSG/Mesh B-Rep parametrico in JavaScript qualora l'ambiente browser/offline blocchi il download del binario `.wasm` da CDN, garantendo sempre l'esportazione immediata di `.stl` (binario/ASCII valido per Fusion 360) e `.3mf` (pacchetto XML/ZIP 3MF v1.2 multicolore valido per Bambu Studio, PrusaSlicer e OrcaSlicer).

---

## 2. Struttura Obbligatoria del Repository

Non creare mai cartelle versionate (`v1/`, `v2/`, `old/`, `backup/`). Il repository mantiene un'unica struttura pulita nella root:

```text
/
├── Agents.md                  # Regole master del progetto (SEMPRE PRIORITARIE)
├── .agents/
│   └── skills/
│       └── ai-multi-provider/
│           └── SKILL.md       # Skill architetturale riutilizzabile per integrazioni AI Multi-Provider
├── index.html                 # Entry point PWA (Import Map + UI semantica)
├── manifest.webmanifest       # Manifest PWA store-ready (PWABuilder compliant)
├── manifest.json              # Alias/copia sincronizzata per compatibilità universale
├── sw.js                      # Service Worker Vanilla JS (Network-First + Offline Cache)
├── README.md                  # Documentazione progetto, architettura e deploy
├── CHANGELOG.md               # Registro cronologico versioni (Keep a Changelog)
├── .gitignore                 # Esclusione file temporanei, OS e segreti
├── .well-known/
│   └── assetlinks.json        # Predisposizione Android TWA (Digital Asset Links)
├── icon-192.png               # Icona PWA 192x192 (sfondo pieno, servita dalla root)
├── icon-512.png               # Icona PWA 512x512 (sfondo pieno, servita dalla root)
├── screenshot-mobile.png      # Screenshot PWA verticale (540x720, narrow)
├── screenshot-desktop.png     # Screenshot PWA orizzontale (1280x720, wide)
├── css/
│   ├── variables.css          # Design tokens (colori, tipografia, spaziature, ombre)
│   ├── main.css               # Layout mobile-first, header iOS safe-area, bottom nav, card, modali
│   └── viewer.css             # Stili specifici per viewport 3D, HUD, controlli Customizer ed editor
├── js/
│   ├── app.js                 # Controller principale, stato globale, routing tab e toast UI
│   ├── services/
│   │   ├── aiService.js       # Chiamate multimodali AI (Gemini / OpenRouter / Groq) + prompt OpenSCAD + Auto-Fix
│   │   ├── storageService.js  # IndexedDB wrapper + fetch dinamico da /models/index.json + ZIP export
│   │   └── githubService.js   # Commit & push diretto nella cartella models/<slug>/ via GitHub REST API
│   ├── components/
│   │   ├── wizard.js          # Wizard 3-step: Upload foto -> Clarification Form AI -> Generazione & Compilazione
│   │   ├── viewer3d.js        # Renderer Three.js + parser/generatore STL/3MF + cattura PNG + fallback no-WebGL
│   │   ├── gallery.js         # Libreria unificata (Repo GitHub + IndexedDB locale) con ricerca e filtri
│   │   └── settings.js        # Modale configurazione AI Provider/Key/Model e GitHub PAT/Repo
│   └── workers/
│       └── openscad.worker.js # Web Worker di compilazione OpenSCAD (.scad -> .stl & .3mf) + validazione manifold
├── assets/
│   └── icons/                 # Copia icone PWA (192x192, 512x512, apple-touch-icon.png)
└── models/                    # Archivio modelli 3D convertiti e versionati su Git
    ├── index.json             # Indice JSON dei modelli presenti nel repository
    └── freenove-esp32-s3-2.8/ # Modello completo di riferimento (FNK0104B)
        ├── model.scad
        ├── model.stl
        ├── model.3mf
        ├── preview.png
        └── meta.json
```

---

## 3. Regole Critiche di Layout PWA & iOS Standalone

1. **Status Bar iOS (`index.html`):**
   - Usa `<meta name="apple-mobile-web-app-status-bar-style" content="black">` (mai `black-translucent`).
2. **Flusso del Documento (`html, body`):**
   - Non bloccare mai `html, body` con `position: fixed`, `height: 100dvh` o `overflow: hidden`.
   - Usa `min-height: 100%` e `overflow-x: hidden`, con `#app-container` in `display: flex; flex-direction: column; min-height: 100vh;`.
3. **Header Sticky & Dynamic Island:**
   - Applica `padding-top: calc(10px + env(safe-area-inset-top, 0px))` direttamente su `.app-header`.
4. **Bottom Navigation Bar:**
   - Ancorata con `position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;` senza `env(safe-area-inset-bottom)` aggiuntivo, e compensata da `padding-bottom: 88px` su `.main-content`.
5. **Prevenzione Auto-Zoom iOS:**
   - Tutti i campi `<input>`, `<select>`, `<textarea>` devono avere `font-size: 16px` (`1rem`) e `touch-action: manipulation`.

---

## 4. Standard di Qualità per Script OpenSCAD (`.scad`)

Ogni script OpenSCAD generato dall'AI o incluso in `models/` deve rispettare questi requisiti geometrici:

1. **100% Manifold (Watertight — Zero Facce Coplanari):**
   - Ogni componente appoggiato sul PCB (connettori, chip, display, pulsanti, serigrafie) deve compenetrare la superficie del PCB di **`eps = 0.05` mm** (`translate([x, y, pcb_thickness - 0.05])`).
   - Tutti i fori passanti (`difference()`) devono estendersi di almeno `-0.1 mm` sotto `z = 0` e `+0.1 mm` sopra `z = pcb_thickness`.
2. **Parametri Customizer Standardizzati:**
   - Includere sempre all'inizio del file i blocchi Customizer parsabili dalla UI:
     ```scad
     /* [Board Dimensions] */
     pcb_length = 86.0; // [20:0.5:250]
     pcb_width  = 50.0; // [15:0.5:200]
     pcb_thickness = 1.6; // [0.8:0.1:3.2]
     corner_radius = 3.0; // [0:0.5:10]
     hole_diameter = 3.2; // [2.0:0.1:5.0]

     /* [Detail & Features] */
     show_silkscreen = true;
     show_headers    = true;
     show_components = true;
     show_display    = true;
     $fn = 36;
     ```
3. **Colori semantici (`color("#RRGGBB")`) per Export 3MF Multicolore:**
   - Usa chiamate esplicite `color("#...")` per ogni gruppo funzionale (es. PCB `#155e38` o `#111827`, rame/oro `#d4af37`, metallo schermature/USB `#c0c7d0`, IC package `#1e242b`, display attivo `#0a192f`, cornice display `#111111`, connettori JST `#f3f4f6`, serigrafie `#f8fafc`).

---

## 5. Sicurezza & Privacy

- **Zero Segreti nel Codice:** Nessuna API Key (Gemini, OpenAI) e nessun Personal Access Token GitHub devono mai essere hardcoded nei file sorgente o committati su Git.
- Le chiavi inserite dall'utente vengono salvate esclusivamente nel `localStorage` locale del dispositivo (`board2cad_settings_v1`).

---

## 6. Architettura & Integrazioni AI

### Standard Obbligatorio Multi-Provider AI (Zero Single-Point-of-Failure)
- **Divieto di provider singolo:** Nessuna app o funzione basata su AI deve dipendere esclusivamente da Google AI Studio (Gemini). Ogni modulo AI (`aiService.js` o equivalente) deve implementare nativamente un'architettura **Multi-Provider** con almeno questi **3 provider gratuiti/compatibili** selezionabili dall'utente nelle Impostazioni (`Config`):
  1. **Google AI Studio (Gemini):** Endpoint `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (con supporto a `thinkingConfig`, filtraggio delle parti `part.thought === true` nella risposta, gestione compatibilità per modelli `gemma-*` e lista modelli aggiornata es. `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.1-pro-preview`, `gemma-4-31b-it`).
  2. **OpenRouter:** Endpoint OpenAI-compatibile `https://openrouter.ai/api/v1/chat/completions` (con header `HTTP-Referer` e `X-Title`, modelli free consigliati es. `qwen/qwen2.5-vl-72b-instruct:free`, `google/gemma-3-27b-it:free`, `meta-llama/llama-3.3-70b-instruct:free`).
  3. **Groq Cloud:** Endpoint OpenAI-compatibile ultraveloce `https://api.groq.com/openai/v1/chat/completions` (modelli consigliati es. `meta-llama/llama-4-scout-17b-16e-instruct`, `llama-3.3-70b-versatile`).
- **Gestione Configurazione & Persistenza:**
  - La UI delle Impostazioni deve sempre offrire un selettore **Provider AI**, un campo **API Key** salvato separatamente per ciascun provider in `localStorage` (così cambiando provider non si sovrascrivono le chiavi già inserite), e un selettore/campo libero per il **Modello**.
- **Adapter Unificato & Multimodalità:**
  - L'adapter `aiService.js` deve astrarre le differenze di formato tra l'API nativa Gemini (`contents` + `inlineData` / `inline_data`) e il formato standard OpenAI (`messages` + `image_url` data URI), includendo il ridimensionamento automatico lato client delle immagini su `<canvas>` (max `1024px`, JPEG `0.85`) prima dell'invio.
- **Feedback UI Esplicito & Paracadute Offline:**
  - Ogni chiamata AI deve avere stati UI visibili (`loading` con spinner e pulsante disabilitato, `error` persistente con codice HTTP e messaggio reale, `success`), senza mai inghiottire errori in silenzio (`try / catch / finally`).
  - Quando il flusso prevede generazione di codice o testi complessi, includere sempre anche un pulsante **"Copia Prompt per Chat AI"** per consentire l'uso manuale su chat AI esterne in assenza di API Key o connessione.

