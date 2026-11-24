# Changelog

Tutte le modifiche rilevanti a **Board2CAD** sono documentate in questo file.
Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/) e il progetto segue il [Semantic Versioning](https://semver.org/lang/it/).

---

## [v1.6.0] - 2026-11-24

### Added
- **Catena Automatica Modelli + Retry con Backoff (`js/services/aiService.js`):**
  - Introdotto `buildModelCascadePlan()` e gestione resiliente con retry e model cascade su tutte le chiamate AI (Step 2 Analisi, Step 3 Generazione OpenSCAD e Auto-Fix).
  - Quando il provider attivo è **Google AI Studio**, costruisce dinamicamente la sequenza deduplicata `[selectedModel, 'gemma-4-31b-it', 'gemma-4-26b-a4b-it', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.8-flash']`, adattando automaticamente `thinkingConfig` e `responseMimeType` al modello in uso.
  - Su errori temporanei `HTTP 503` / `HTTP 429` o di rete, attende `2.5 s` e riprova una volta; se fallisce ancora (o su `HTTP 404` / `5xx`), passa automaticamente al modello successivo aggiornando live banner e log dello Wizard (`"⚠️ Modello [nome] occupato (503), passaggio automatico a [prossimo]..."`).
  - **Fallback Cross-Provider:** Se l'utente ha salvato anche una API Key per **Groq Cloud** o **OpenRouter** in `localStorage` (`providerProfiles`), la catena accoda automaticamente i provider secondari prima di restituire errore.
- **Pulsante Diretto "🔄 Riprova Generazione" in Step 3 (`index.html`, `js/components/wizard.js`):**
  - Aggiunto pulsante diretto `#wizard-retry-step3-btn` sia nella barra azioni dello Step 3 sia nel banner rosso persistente in caso di errore, permettendo di rilanciare la generazione OpenSCAD e la compilazione STL/3MF senza perdere l'analisi Step 2 o le quote confermate.

### Changed
- **Payload Leggero dello Step 3 (`js/services/aiService.js`, `js/components/wizard.js`):**
  - Quando lo Step 2 ha già estratto il blueprint dettagliato dei componenti e il riepilogo visivo (`analysisContext`), lo Step 3 invia un payload **solo testo** (0 immagini Base64 riallegate) con posizioni, dimensioni e colori dei componenti + quote confermate dall'utente, abbattendo latenza ed errori `HTTP 503` e rendendo compatibili anche i modelli testuali in cascata.
  - In assenza di blueprint Step 2, allega al massimo una singola immagine ridimensionata (`768 px`, JPEG `0.75`); anche la chiamata di Auto-Fix OpenSCAD opera ora esclusivamente su testo.

---

## [v1.5.1] - 2026-11-24

### Fixed
- **Etichetta Dinamica API Key & Cache-Busting Moduli JS (`index.html`, `js/components/settings.js`, `sw.js`):**
  - Rimossa la dicitura statica `API Key (Google AI Studio)` in `index.html` sostituita da `API Key` neutra, aggiornata dinamicamente su `open()`, `change` e `input` del selettore Provider con il nome del provider attivo (`Google AI Studio`, `OpenRouter` o `Groq Cloud`) e un riepilogo visivo delle chiavi salvate (`✓ Gemini · ○ OpenRouter · ○ Groq`).
  - Aggiunto `{ cache: 'no-cache' }` sulle richieste same-origin nel Service Worker `sw.js` per impedire al browser di servire versioni vecchie di `settings.js` o `aiService.js` dopo gli aggiornamenti.

---

## [v1.5.0] - 2026-11-24

### Added
- **Feedback Visivo Obbligatorio & Gestione Errori `try/catch/finally` nello Wizard (`index.html`, `css/main.css`, `js/components/wizard.js`):**
  - Aggiunti banner di stato persistenti (`.wizard-status-banner`) in tutti gli step dello Wizard con stati espliciti:
    - **In corso:** spinner animato CSS, pulsanti principali disabilitati durante la richiesta e messaggi live (*"⏳ Invio immagini all'AI in corso..."*, *"⚙️ Compilazione STL e 3MF nel browser..."*).
    - **Errore:** banner rosso persistente con codice HTTP reale (`503` / `401` / `429`) e dettaglio API, più pulsanti rapidi inline per aprire **Config** o copiare il prompt (**"Copia Prompt per Chat AI"**).
    - **Successo:** banner verde e passaggio automatico allo **Studio 3D** con il modello compilato e renderizzato.
- **Supporto Multi-Provider Gratuiti (`Google AI Studio`, `OpenRouter`, `Groq Cloud`) (`js/components/settings.js`, `js/services/aiService.js`, `js/services/storageService.js`):**
  - Nuova modale **Config** con salvataggio profili per ciascun provider in `localStorage` e chip rapidi per i modelli consigliati:
    - **Google AI Studio (Gemini):** `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.1-pro-preview`, `gemma-4-31b-it` (gestione automatica senza `thinkingConfig`/`responseMimeType` su modelli Gemma).
    - **OpenRouter (Free Vision):** `qwen/qwen2.5-vl-72b-instruct:free`, `google/gemma-3-27b-it:free` su endpoint `https://openrouter.ai/api/v1/chat/completions`.
    - **Groq Cloud (Ultraveloce):** `meta-llama/llama-4-scout-17b-16e-instruct` su endpoint `https://api.groq.com/openai/v1/chat/completions`.

### Fixed
- **Fix Parsing Risposta Gemini 3.x (`thought: true`) (`js/services/aiService.js`):**
  - Aggiunto `extractGeminiResponseText` che filtra ed esclude tutti i blocchi con `part.thought === true` in `candidates[0].content.parts`, estraendo esclusivamente il blocco finale effettivo e ripulendo eventuali fence markdown ```` ```openscad ... ``` ```` (e blocchi `<think>...</think>` sui provider OpenAI-compatibili).

---

## [v1.4.0] - 2026-11-24

### Added
- **Ridimensionamento Automatico Immagini via `<canvas>` (`js/services/aiService.js`, `js/components/wizard.js`):**
  - Tutte le immagini caricate nel Wizard (orizzontali, verticali o quadrate) vengono ridimensionate automaticamente lato client su `<canvas>` offscreen in modo che il lato più lungo non superi **1024 px** (mantenendo inalterate le proporzioni, senza upscaling per foto già piccole) ed esportate in **`image/jpeg` qualità `0.85`** con sfondo bianco per preservare la leggibilità dei disegni quotati PNG trasparenti.
  - Riduzione del peso del payload multimodale di 5–10× per abbattere errori `HTTP 503` e timeout delle API Vision.
- **Ottimizzazione `thinkingBudget` per Modelli Gemini (`js/services/aiService.js`):**
  - Aggiunto `generationConfig.thinkingConfig.thinkingBudget = 2048` nelle chiamate `generateContent` verso modelli Gemini serie `2.5` / `3.x` / `thinking`, evitando tempi di ragionamento eccessivi prima di generare il codice `.scad`.
- **Modalità "Copia Prompt per Chat AI" (Zero-API Offline Fallback) (`index.html`, `js/components/wizard.js`, `js/app.js`):**
  - Aggiunto il pulsante **"Copia Prompt per Chat AI"** negli step del Wizard (anche senza API Key configurata).
  - Copia negli appunti (con supporto cross-platform `navigator.clipboard.writeText` + fallback `<textarea>` per mobile iOS Safari / Android Chrome) un prompt strutturato completo con il System Prompt manifold (`eps = 0.05 mm`, orientamento connettori, Customizer, zero componenti estranei), i dati inseriti dall'utente, l'eventuale codice `.scad` di partenza e il promemoria di allegare le foto nella chat esterna.
  - Prepara automaticamente una bozza locale nello Studio 3D (`Editor .SCAD`) con stripping automatico dei blocchi markdown ```` ```openscad ... ``` ```` in fase di compilazione e nuovo pulsante **`Salva come Nuova`**.

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
