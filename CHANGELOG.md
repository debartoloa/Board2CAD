# Changelog

Tutte le modifiche rilevanti a **Board2CAD** sono documentate in questo file.
Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/) e il progetto segue il [Semantic Versioning](https://semver.org/lang/it/).

---

## [v1.3.0] - 2026-11-23

### Fixed
- **Rimosso Pre-Check Falso Positivo `"Parentesi graffe non bilanciate (delta = 2)"` (`js/workers/openscad.worker.js`):**
  - Eliminato il conteggio manuale carattere per carattere di `{` e `}` in `validateManifoldScad` che contava erroneamente parentesi dentro commenti (`//...`, `/*...*/`) e stringhe.
  - Il bilanciamento e la validazione sintattica sono ora gestiti direttamente a livello di stream di token (dopo lo stripping completo di commenti e stringhe) e dal compilatore AST/CSG nel Web Worker, con supporto esteso anche a `.x/.y/.z`, `minkowski()`, `offset()`, `render()`, `echo()` e `assert()`.
- **Eliminati Tutti i Template Hardcodati ESP32/Freenove e Fallback Mock (`js/services/aiService.js`, `js/components/wizard.js`):**
  - Rimosse le funzioni `buildParametricManifoldScad` e `getPresetDefaults` che generavano silenziosamente moduli `usb_c_receptacle`, `jst_4pin_connector`, `microsd_push_slot`, `esp32_wroom_soc` e `ips_display_assembly` con dimensioni fisse `54.6 × 27.9 mm` quando veniva caricata un'altra scheda (es. Arduino Uno R3 `68.6 × 53.4 mm`).
  - Se l'API Key AI non è configurata o la chiamata Vision fallisce, viene ora mostrato un errore chiaro all'utente invece di sostituire il modello con una scheda finta.
- **System Prompt AI Vision Autentico & Verifica Payload Multimodale Base64:**
  - Aggiornato `SYSTEM_PROMPT_MANIFOLD` e i prompt di Step 2 e Step 3 per imporre la lettura delle quote reali direttamente dalle foto allegate, la generazione dei soli componenti visibili nella foto (zero moduli estranei), l'orientamento di tutti i connettori (USB-B, USB-C, Jack DC, JST, microSD) verso il perimetro esterno del PCB e la compenetrazione `eps = 0.05 mm`.
  - Verificato l'allegato `inline_data` Base64 delle immagini in tutte le chiamate Gemini Vision / OpenAI Vision (`maxOutputTokens: 8192`).

---

## [v1.2.1] - 2026-11-23

### Fixed
- **Fix `ReferenceError: hasExistingScad is not defined` in `aiService.js`:**
  - Aggiunti i parametri `existingScad` e `hasExistingScad` nella firma di `buildSmartClarificationPlan` durante l'analisi del codice `.SCAD` nello Step 2 del Wizard.
  - Esteso il riconoscimento automatico degli alias delle variabili dimensionali negli script `.scad` (`pcb_l`/`pcb_x`/`L`, `pcb_w`/`pcb_y`/`W`, `pcb_t`/`pcb_z`/`T`, `corner_r`/`R`, `hole_d`).

---

## [v1.2.0] - 2026-11-23

### Added
- **Wizard "Nuova Scheda 3D" da Codice `.SCAD` Esistente + Richiesta Modifiche:**
  - Nuovo pannello nello Step 1 del Wizard per **incollare o caricare un file `.SCAD` già esistente** come punto di partenza per una nuova scheda.
  - Estrazione automatica nello Step 2 di tutte le quote e variabili già definite nello script `.scad` (`pcb_length`/`pcb_l`, `pcb_width`/`pcb_w`, `pcb_thickness`/`pcb_t`, `corner_radius`/`corner_r`, `hole_diameter`/`hole_d`, `hole_pitch_x`, `hole_pitch_y`, `usb_protrusion`, `display_height`).
  - Possibilità di chiedere modifiche specifiche nel campo note/istruzioni (applicate sia tramite AI Gemini/OpenAI sia tramite il motore parametrico locale non distruttivo) oppure cliccare **`Compila Direttamente il mio .SCAD così com'è`** per generare subito `.STL`, `.3MF`, `preview.png` e `meta.json`.
- **Preconfigurazione Repository GitHub `debartoloa/Board2CAD`:**
  - Preimpostato `debartoloa/Board2CAD` come repository GitHub di default nelle impostazioni di sincronizzazione.

---

## [v1.1.0] - 2026-11-23

### Added
- **Compilatore OpenSCAD AST & CSG Completo nel Web Worker (`js/workers/openscad.worker.js`):**
  - Lexer, parser a discesa ricorsiva e interprete AST/CSG completo per il linguaggio OpenSCAD: valuta in tempo reale moduli custom (`module smd_part(...)`, `module silk_label(...)`), funzioni, cicli `for`, condizioni `if/else`, espressioni matematiche/vettoriali, trasformazioni 4×4 (`translate`, `rotate`, `scale`, `mirror`, `color`), operazioni booleane (`union`, `difference`, `intersection`, `hull`), estrusioni (`linear_extrude`), primitive 3D/2D (`cube`, `cylinder`, `sphere`, `circle`, `square`, `polygon`) e generazione di testo 3D vettoriale (`text()`).
  - Parser diretto per file `.STL` (binari e ASCII) e `.3MF` caricati dall'utente con rendering 3D immediato nel viewport Three.js.
- **Gestore Completo dei 5 File per Ogni Componente (Tab `File & Info (5 File)`):**
  - Possibilità di modificare, sostituire da PC, rigenerare o scaricare singolarmente **`model.scad`**, **`model.stl`**, **`model.3mf`**, **`preview.png`** e **`meta.json`** per qualsiasi componente (inclusa la scheda predefinita `freenove-esp32-s3-2.8`).
  - Persistenza delle modifiche in **IndexedDB** anche sui modelli del repository (`Repo + Modificato`), con pulsante **`Ripristina Originale Repo`**.
  - Pulsante **`Salva su Disco`** basato su File System Access API (`showDirectoryPicker`) per scrivere direttamente i 5 file aggiornati nella cartella locale `models/<slug>/` sul PC.

### Fixed
- **Aggiornamento Immediato del Rendering 3D dall'Editor `.SCAD`:**
  - Qualsiasi modifica al codice nell'Editor `.SCAD` seguita da **`Compila Script`** (o `Ctrl+Invio`) oppure **`Compila & Salva`** ricompila realmente l'AST geometrico dello script e aggiorna all'istante la scena 3D, i conteggi di triangoli/vertici, il bounding box e i buffer `.stl`/`.3mf`.

---

## [v1.0.0] - 2026-11-23

### Added
- **Architettura Core Vanilla PWA (`v1.0.0`):**
  - Struttura 100% HTML5 semantico, CSS3 moderno (`variables.css`, `main.css`, `viewer.css`) e JavaScript Vanilla ES6+ Modules senza framework né build step.
  - Configurazione PWA store-ready (`manifest.webmanifest`, `manifest.json`, `.well-known/assetlinks.json`, `sw.js` con strategia Network-First, icone PNG `192x192` e `512x512` a sfondo pieno e screenshot mobile/desktop).
  - Regole master del progetto definite in `Agents.md`.
- **Wizard "Nuova Scheda 3D" (3 Step con Clarification First & Auto-Fix):**
  - Step 1 per caricamento foto scheda (fronte, retro, disegni quotati), selezione categoria e note dimensionali.
  - Step 2 con ispezione AI Vision (Google Gemini / OpenAI GPT-4o / Motore Parametrico Locale) e generazione dinamica del form per le sole quote critiche mancanti.
  - Step 3 con generazione di script OpenSCAD 100% manifold (`eps = 0.05 mm`), loop di Auto-Fix (max 2 tentativi) e compilazione binaria `.stl` e `.3mf` multicolore.
- **Studio 3D Interattivo (`viewer3d.js`) & Web Worker (`openscad.worker.js`):**
  - Renderer Three.js con griglia millimetrata, assi XYZ, viste preimpostate (`Iso`, `Top`, `Front`, `Bottom`), toggle 3MF Multicolore / STL Monocolore, Wireframe, cattura screenshot `preview.png` e fallback automatico su immagine statica se WebGL non è supportato.
  - Pannello Customizer generato dinamicamente dai commenti `/* [Group] */` dello script `.scad` con pulsante di **Ricompilazione Rapida**.
- **Libreria Modelli, Persistenza IndexedDB & GitHub Sync:**
  - Unione automatica dei modelli presenti in `models/index.json` (`Repo GitHub`) e in `IndexedDB` (`Locale`).
  - Esportazione `.STL`, `.3MF`, `.SCAD`, archivio `.ZIP` completo della cartella modello e commit diretto su GitHub tramite REST API (`githubService.js`).
- **Modello di Riferimento Precaricato (`models/freenove-esp32-s3-2.8/`):**
  - Modello 3D completo della scheda **Freenove ESP32-S3 Display 2.8" IPS (FNK0104B - N16R8)** con `model.scad`, `model.stl` (106 KB, 2128 triangoli watertight), `model.3mf` multicolore (501 KB), `preview.png` e `meta.json`.
