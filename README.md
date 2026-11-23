# Board2CAD — PCB 3D Parametric Studio (`v1.0.0`)

**Board2CAD** è una **Progressive Web App (PWA) Mobile-First** progettata per generare automaticamente modelli 3D parametrici (**100% manifold / watertight**) di schede elettroniche (ESP32, Arduino, display TFT/OLED, moduli relè, breakout custom) a partire da foto e quote, compilarli localmente nel browser in **`.stl`** (per Fusion 360 / SolidWorks) e **`.3mf`** (multicolore per Bambu Studio / PrusaSlicer / OrcaSlicer), visualizzarli in anteprima 3D con **Three.js** e archiviarli su **GitHub**.

Realizzata **esclusivamente in HTML5 semantico, CSS3 moderno e JavaScript Vanilla (ES6+ Modules)** con **Zero Build Step** (nessun bundler, nessun `node_modules`).

---

## Funzionalità Principali

1. **Wizard "Nuova Scheda 3D" in 3 Step (Clarification First):**
   - **Step 1 — Foto & Note:** caricamento multi-immagine (anche da fotocamera mobile), selezione categoria/template e note dimensionali.
   - **Step 2 — Analisi AI & Clarification First:** ispezione multimodale (Google Gemini Vision / OpenAI GPT-4o Vision o Motore Parametrico Locale Offline) che genera dinamicamente un form HTML chiedendo *solo* le quote critiche mancanti con valori stimati precompilati.
   - **Step 3 — Generazione OpenSCAD 100% Manifold, Auto-Fix & Compilazione:**
     - Compenetrazione garantita `eps = 0.05 mm` su tutti i componenti appoggiati sul PCB (zero facce coplanari).
     - Loop automatico di **Auto-Fix** (fino a 2 tentativi) in caso di warning o errori mesh.
     - Compilazione in Web Worker dedicato (`js/workers/openscad.worker.js`) con generazione simultanea di `model.stl` e `model.3mf` multicolore.
2. **Studio 3D Interattivo, Customizer & Fallback Automatico:**
   - Viewport **Three.js** con griglia millimetrata, assi XYZ, viste rapide (`Iso`, `Top`, `Front`, `Bottom`), toggle **3MF Multicolore / STL Monocolore**, toggle **Wireframe** e pulsante **"Cattura PNG"** (`preview.png`).
   - **Fallback automatico:** se WebGL non è supportato dal dispositivo, viene mostrata automaticamente l'anteprima statica `preview.png`.
   - **Pannello Customizer dinamico:** legge i blocchi `/* [Board Dimensions] */` e `/* [Detail & Features] */` dello script `.scad` (inclusi `show_silkscreen`, `show_headers`, `show_components`, `show_display`) con pulsante **"Ricompilazione Rapida"**.
3. **Libreria Unificata + Export ZIP + GitHub Sync:**
   - Unisce i modelli versionati nel repository (`models/index.json`) e quelli salvati offline in **IndexedDB**.
   - Esportazione singola (`.STL`, `.3MF`, `.SCAD`), pacchetto cartella `.ZIP` completo e **Commit diretto su GitHub** nella cartella `models/<slug>/` tramite GitHub REST API.

---

## Struttura del Repository

```text
/
├── Agents.md                  # Regole architetturali master del progetto (SEMPRE PRIORITARIE)
├── index.html                 # Entry point PWA (Import Map + UI semantica)
├── manifest.webmanifest       # Manifest PWA store-ready (PWABuilder compliant)
├── manifest.json              # Copia sincronizzata del manifest PWA
├── sw.js                      # Service Worker Vanilla JS (Network-First + Offline Cache)
├── README.md                  # Documentazione del progetto
├── CHANGELOG.md               # Registro cronologico delle versioni
├── .gitignore                 # File esclusi dal versionamento Git
├── .well-known/
│   └── assetlinks.json        # Predisposizione Android TWA (Digital Asset Links)
├── icon-192.png               # Icona PWA 192x192 (sfondo pieno)
├── icon-512.png               # Icona PWA 512x512 (sfondo pieno)
├── screenshot-mobile.png      # Screenshot PWA mobile (540x720, narrow)
├── screenshot-desktop.png     # Screenshot PWA desktop (1280x720, wide)
├── css/
│   ├── variables.css          # Design tokens (colori, tipografia, spaziature)
│   ├── main.css               # Layout mobile-first, iOS safe-area, card, modali
│   └── viewer.css             # Stili per canvas 3D, HUD, Customizer ed editor .scad
├── js/
│   ├── app.js                 # Controller principale, Customizer parser e routing viste
│   ├── services/
│   │   ├── aiService.js       # Chiamate multimodali AI + generatore OpenSCAD + Auto-Fix
│   │   ├── storageService.js  # IndexedDB wrapper + fetch /models/index.json + ZIP export
│   │   └── githubService.js   # Commit & push via GitHub REST API in models/<slug>/
│   ├── components/
│   │   ├── wizard.js          # Wizard 3-step (Upload -> Clarification First -> Compilazione)
│   │   ├── viewer3d.js        # Renderer Three.js + cattura PNG + fallback statico
│   │   ├── gallery.js         # Libreria modelli convertiti (Repo GitHub + IndexedDB)
│   │   └── settings.js        # Modale API Key AI + GitHub Token/Repo (localStorage)
│   └── workers/
│       └── openscad.worker.js # Web Worker compilazione OpenSCAD -> STL & 3MF multicolore
├── assets/
│   └── icons/                 # Icone PWA (192x192, 512x512, apple-touch-icon.png)
└── models/                    # Archivio modelli 3D versionati nel repository
    ├── index.json             # Indice JSON dei modelli del repo
    └── freenove-esp32-s3-2.8/ # Modello completo Freenove ESP32-S3 Display 2.8" (FNK0104B)
        ├── model.scad
        ├── model.stl
        ├── model.3mf
        ├── preview.png
        └── meta.json
```

---

## Avvio Locale & Deploy (GitHub Pages / Cloudflare Workers)

Non è richiesto alcun passo di build o installazione `npm`.

### Avvio Rapido in Locale
Puoi servire la cartella radice con qualsiasi web server statico:

```bash
# Con Python 3
python -m http.server 8080

# Oppure con Node npx serve
npx serve . -l 8080
```

Poi apri `http://localhost:8080` nel browser.

### Deploy su GitHub Pages
1. Esegui il push del repository sul branch `main`.
2. In **Settings → Pages**, seleziona **Deploy from a branch** → `main` / `/ (root)`.
3. Per abilitare il salvataggio diretto dei nuovi modelli dal browser al repository, apri la modale **Impostazioni** nell'app e inserisci il tuo GitHub Owner, Nome Repository e un Personal Access Token con permesso `contents:write`.
