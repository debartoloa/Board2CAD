/**
 * Board2CAD — Main Application Controller (js/app.js)
 * Pure Vanilla ES6+ Module — Zero Framework / Zero Build Step
 */

import { storageService } from './services/storageService.js';
import { aiService } from './services/aiService.js';
import { githubService } from './services/githubService.js';
import { Viewer3D } from './components/viewer3d.js';
import { GalleryComponent } from './components/gallery.js';
import { WizardComponent } from './components/wizard.js';
import { SettingsComponent } from './components/settings.js';

export const APP_VERSION = 'v1.2.1';

class Board2CADApp {
  constructor() {
    this.worker = null;
    this.workerReqId = 0;
    this.pendingWorkerCallbacks = new Map();

    this.currentView = 'gallery';
    this.activeModel = null; // { slug, source, hasLocalOverride, customMeshLocked, meta, scad, stlBuffer, threemfBuffer, previewDataUrl, viewerParts, metrics }

    this.viewer3d = null;
    this.gallery = null;
    this.wizard = null;
    this.settings = null;
  }

  async init() {
    // 1. Espone APP_VERSION nell'header badge
    const versionBadge = document.getElementById('app-version-badge');
    if (versionBadge) {
      versionBadge.textContent = APP_VERSION;
    }

    // 2. Avvia il Web Worker di compilazione OpenSCAD AST CSG
    this.initOpenScadWorker();

    // 3. Inizializza il Renderer 3D Three.js (+ fallback PNG)
    this.viewer3d = new Viewer3D({
      stageEl: document.getElementById('viewer-canvas-container'),
      fallbackEl: document.getElementById('viewer-fallback-container'),
      fallbackImgEl: document.getElementById('viewer-fallback-img'),
      hudStatsEl: document.getElementById('viewer-hud-stats')
    });
    await this.viewer3d.init();

    // 4. Inizializza la Libreria Modelli (Repo GitHub + IndexedDB)
    this.gallery = new GalleryComponent({
      gridEl: document.getElementById('gallery-grid'),
      searchInputEl: document.getElementById('gallery-search-input'),
      filterChips: document.querySelectorAll('.filter-chips .chip'),
      countAllEl: document.getElementById('count-all'),
      countRepoEl: document.getElementById('count-repo'),
      countLocalEl: document.getElementById('count-local'),
      onOpenModel: (slug, source) => this.openModelInStudio(slug, source),
      onQuickDownload: (slug, source, format) => this.quickDownloadFromCard(slug, source, format),
      onDeleteLocal: (slug) => this.deleteLocalModel(slug)
    });

    // 5. Inizializza il Wizard "Nuova Scheda 3D"
    this.wizard = new WizardComponent({
      compileScadWithWorker: (scadCode, overrides) => this.compileScad(scadCode, overrides),
      onModelGenerated: (modelData, switchToStudio) => this.handleNewWizardModel(modelData, switchToStudio),
      showToast: (msg, type) => this.showToast(msg, type)
    });

    // 6. Inizializza la Modale Impostazioni
    this.settings = new SettingsComponent({
      modalEl: document.getElementById('settings-modal'),
      formEl: document.getElementById('settings-form'),
      onSettingsSaved: () => this.updateHeaderStatus(),
      onClearLocalDb: async () => {
        await storageService.clearAllLocalModels();
        await this.refreshGallery();
        this.showToast('Archivio locale IndexedDB svuotato.', 'info');
      },
      showToast: (msg, type) => this.showToast(msg, type)
    });

    // 7. Collega eventi UI globali (navigazione tab, controlli Studio 3D, download, salvataggio disco e GitHub Push)
    this.bindGlobalEvents();
    this.updateHeaderStatus();

    // 8. Carica i modelli nella Libreria e pre-carica il primo modello nello Studio 3D
    const allModels = await this.refreshGallery();
    if (allModels.length > 0) {
      await this.loadModelIntoStudioState(allModels[0].slug, allModels[0].source, false);
    }

    // 9. Registra il Service Worker PWA (sw.js)
    this.registerServiceWorker();
  }

  /**
   * Inizializza il Web Worker dedicato per la compilazione OpenSCAD AST CSG -> STL & 3MF
   */
  initOpenScadWorker() {
    try {
      this.worker = new Worker(`./js/workers/openscad.worker.js?v=${APP_VERSION}`, { type: 'module' });
      this.worker.onmessage = (event) => {
        const data = event.data || {};
        const cb = this.pendingWorkerCallbacks.get(data.id);
        if (cb) {
          this.pendingWorkerCallbacks.delete(data.id);
          cb(data);
        }
      };
      this.worker.onerror = (err) => {
        console.warn('[App] Web Worker warning:', err);
      };
    } catch (err) {
      console.error('[App] Impossibile avviare il Web Worker OpenSCAD:', err);
    }
  }

  /**
   * Invia uno script .scad al Web Worker e restituisce { ok, scadCode, stlBuffer, threemfBuffer, viewerParts, metrics }
   */
  compileScad(scadCode, overrides = null) {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve({ ok: false, error: 'Web Worker non disponibile' });
        return;
      }
      const id = ++this.workerReqId;
      this.pendingWorkerCallbacks.set(id, (result) => resolve(result));
      this.worker.postMessage({
        id,
        action: 'compile',
        scadCode,
        overrides
      });
    });
  }

  /**
   * Parsa un file .STL esterno caricato dall'utente tramite il Web Worker
   */
  parseExternalStlBuffer(stlBuffer) {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve({ ok: false, error: 'Web Worker non disponibile' });
        return;
      }
      const id = ++this.workerReqId;
      this.pendingWorkerCallbacks.set(id, (result) => resolve(result));
      this.worker.postMessage({
        id,
        action: 'parse_stl',
        stlBuffer
      });
    });
  }

  /**
   * Parsa un file .3MF esterno caricato dall'utente tramite il Web Worker
   */
  parseExternal3mfBuffer(threemfBuffer) {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve({ ok: false, error: 'Web Worker non disponibile' });
        return;
      }
      const id = ++this.workerReqId;
      this.pendingWorkerCallbacks.set(id, (result) => resolve(result));
      this.worker.postMessage({
        id,
        action: 'parse_3mf',
        threemfBuffer
      });
    });
  }

  /**
   * Aggiorna la griglia della libreria unendo models/index.json e IndexedDB
   */
  async refreshGallery() {
    const models = await storageService.getAllModels();
    this.gallery.setModels(models);
    return models;
  }

  /**
   * Carica un modello completo e apre la vista Studio 3D
   */
  async openModelInStudio(slug, source = 'repo') {
    await this.loadModelIntoStudioState(slug, source, true);
  }

  async loadModelIntoStudioState(slug, source = 'repo', navigateToStudio = true, forceRepoDefault = false) {
    const overlay = document.getElementById('viewer-loading-overlay');
    if (overlay) overlay.hidden = false;

    try {
      const fullModel = await storageService.loadFullModel(slug, source, forceRepoDefault);
      let compiled = null;

      // Se l'utente aveva caricato un file .STL personalizzato bloccato, parsa quello per il viewer
      if (fullModel.customMeshLocked && fullModel.stlBuffer) {
        compiled = await this.parseExternalStlBuffer(fullModel.stlBuffer);
      } else {
        compiled = await this.compileScad(fullModel.scad);
      }

      this.activeModel = {
        ...fullModel,
        scad: compiled.ok && compiled.scadCode ? compiled.scadCode : fullModel.scad,
        stlBuffer: fullModel.customMeshLocked
          ? fullModel.stlBuffer
          : compiled.ok
            ? compiled.stlBuffer
            : fullModel.stlBuffer,
        threemfBuffer: fullModel.customMeshLocked && fullModel.threemfBuffer
          ? fullModel.threemfBuffer
          : compiled.ok
            ? compiled.threemfBuffer
            : fullModel.threemfBuffer,
        viewerParts: compiled.ok ? compiled.viewerParts : [],
        metrics: compiled.ok ? compiled.metrics : { dimensions: fullModel.meta?.dimensions }
      };

      if (navigateToStudio) {
        this.switchView('studio');
      }

      this.populateStudioUI(this.activeModel);
    } catch (err) {
      this.showToast(`Errore apertura modello "${slug}": ${err.message}`, 'error');
    } finally {
      if (overlay) overlay.hidden = true;
    }
  }

  /**
   * Gestisce un nuovo modello appena generato dal Wizard
   */
  async handleNewWizardModel(modelData, switchToStudio = false) {
    this.activeModel = modelData;
    this.populateStudioUI(this.activeModel);

    if (this.viewer3d && this.viewer3d.webglSupported) {
      const capturedPng = this.viewer3d.capturePreviewPng();
      if (capturedPng && capturedPng.startsWith('data:image/png')) {
        this.activeModel.previewDataUrl = capturedPng;
      }
    }

    await storageService.saveLocalModel(this.activeModel);
    await this.refreshGallery();

    if (switchToStudio) {
      this.switchView('studio');
    }
  }

  /**
   * Salva tutte le modifiche correnti del componente attivo (SCAD, STL, 3MF, PNG, META) in IndexedDB
   */
  async saveActiveComponentAllFiles(captureNewPreviewIfWebGL = false) {
    if (!this.activeModel) return;

    // Sincronizza l'editor .scad con lo stato del modello
    const editorEl = document.getElementById('scad-code-editor');
    if (editorEl && editorEl.value.trim()) {
      this.activeModel.scad = editorEl.value;
    }

    if (captureNewPreviewIfWebGL && this.viewer3d?.webglSupported) {
      const shot = this.viewer3d.capturePreviewPng();
      if (shot) this.activeModel.previewDataUrl = shot;
    }

    this.activeModel.hasLocalOverride = true;
    await storageService.saveLocalModel(this.activeModel);
    await this.refreshGallery();
    this.populateStudioUI(this.activeModel);
    this.showToast(
      `Tutte le modifiche a "${this.activeModel.meta?.name}" (SCAD, STL, 3MF, PNG, META) sono state salvate!`,
      'success'
    );
  }

  /**
   * Aggiorna tutti i pannelli dello Studio 3D (Titolo, Viewport, Customizer, Editor .SCAD, Gestione File & Metadata)
   */
  populateStudioUI(model) {
    if (!model) return;

    const titleEl = document.getElementById('studio-model-title');
    const sourceBadgeEl = document.getElementById('studio-source-badge');
    const dimsLabelEl = document.getElementById('studio-dimensions-label');
    const editorEl = document.getElementById('scad-code-editor');
    const consoleEl = document.getElementById('compiler-console-output');

    if (titleEl) titleEl.textContent = model.meta?.name || model.slug;
    if (sourceBadgeEl) {
      const isRepo = model.source === 'repo';
      const hasOverride = Boolean(model.hasLocalOverride);
      sourceBadgeEl.textContent = isRepo
        ? hasOverride
          ? 'Repo + Modificato'
          : 'Repo GitHub'
        : 'Locale IndexedDB';
      sourceBadgeEl.className = `badge ${isRepo ? (hasOverride ? 'badge-warning' : 'badge-repo') : 'badge-local'}`;
    }

    const dims = model.metrics?.dimensions || model.meta?.dimensions || { length: 86, width: 50, height: 11.2 };
    if (dimsLabelEl) {
      dimsLabelEl.textContent = `Ingombro: ${Number(dims.length).toFixed(1)} × ${Number(dims.width).toFixed(1)} × ${Number(dims.height).toFixed(1)} mm · ${model.metrics?.triangles || '--'} triangoli`;
    }

    if (editorEl) {
      editorEl.value = model.scad || '';
    }

    if (consoleEl && model.metrics) {
      const d = model.metrics.dimensions || dims;
      consoleEl.textContent = `[${model.metrics.engine}] Compilato in ${model.metrics.elapsedMs} ms · ${model.metrics.triangles} triangoli · Bounding Box: ${d.length}×${d.width}×${d.height} mm · 100% Manifold.`;
    }

    // Renderizza nel viewport 3D (o fallback preview.png)
    if (this.viewer3d) {
      this.viewer3d.renderCompiledParts(model.viewerParts || [], model.metrics || {}, model.previewDataUrl);
      setTimeout(() => this.viewer3d.onResize(), 40);
    }

    // Genera controlli Customizer dinamici dallo script .scad
    this.buildCustomizerControls(model.scad || '');

    // Popola tab File & Info (Gestione completa dei 5 file del componente)
    this.renderComponentFileManager(model);
  }

  /**
   * Parsa i commenti Customizer di OpenSCAD e variabili numeriche/booleane in testa allo script
   */
  buildCustomizerControls(scadCode = '') {
    const container = document.getElementById('customizer-controls-container');
    if (!container) return;

    const groups = [];
    let currentGroup = { title: 'Parametri Script OpenSCAD', items: [] };
    groups.push(currentGroup);

    const lines = scadCode.split(/\r?\n/);
    for (const line of lines) {
      // Stop parsing top-level customizer variables once first module starts
      if (/^\s*module\s+[a-zA-Z0-9_]+/.test(line)) break;

      const grpMatch = line.match(/\/\*\s*\[([^\]]+)\]\s*\*\//);
      if (grpMatch) {
        const gTitle = grpMatch[1].trim();
        if (/Internal|Hidden/i.test(gTitle)) {
          currentGroup = null;
          continue;
        }
        currentGroup = { title: gTitle, items: [] };
        groups.push(currentGroup);
        continue;
      }

      if (!currentGroup) continue;

      const paramMatch = line.match(/^\s*([a-zA-Z0-9_$]+)\s*=\s*([^;]+);\s*(?:\/\/\s*(.*))?$/);
      if (!paramMatch) continue;

      const key = paramMatch[1];
      const rawVal = paramMatch[2].trim();
      const comment = (paramMatch[3] || '').trim();

      if (key === 'eps') continue;

      if (rawVal === 'true' || rawVal === 'false') {
        currentGroup.items.push({
          key,
          type: 'boolean',
          value: rawVal === 'true',
          label: this.humanizeParamName(key)
        });
      } else {
        const num = Number(rawVal);
        if (!Number.isNaN(num)) {
          let min = Math.max(0, Number((num * 0.25).toFixed(1)));
          let max = Math.max(5, Number((num * 2.2).toFixed(1)));
          let step = num < 5 ? 0.1 : 0.5;

          const rangeMatch = comment.match(/\[([0-9.]+):([0-9.]+):([0-9.]+)\]/);
          if (rangeMatch) {
            min = Number(rangeMatch[1]);
            step = Number(rangeMatch[2]);
            max = Number(rangeMatch[3]);
          }

          currentGroup.items.push({
            key,
            type: 'number',
            value: num,
            min,
            max,
            step,
            label: this.humanizeParamName(key)
          });
        }
      }
    }

    const validGroups = groups.filter((g) => g.items.length > 0);
    if (validGroups.length === 0) {
      container.innerHTML = `<p class="card-desc">Nessun parametro scalare trovato in testa allo script. Modifica direttamente il codice nel tab <strong>Editor .SCAD</strong>.</p>`;
      return;
    }

    container.innerHTML = validGroups
      .map(
        (grp) => `
        <div class="customizer-group">
          <h4 class="customizer-group-title">${grp.title}</h4>
          ${grp.items
            .map((item) => {
              if (item.type === 'boolean') {
                return `
                  <label class="param-toggle-row" for="cust-${item.key}">
                    <span>${item.label} (<code>${item.key}</code>)</span>
                    <input type="checkbox" id="cust-${item.key}" data-param-key="${item.key}" data-param-type="boolean" ${item.value ? 'checked' : ''}>
                  </label>
                `;
              }
              return `
                <div class="param-row">
                  <div class="param-label-line">
                    <label for="cust-${item.key}">${item.label} (<code>${item.key}</code>)</label>
                    <span class="param-val-badge" id="val-${item.key}">${item.value}</span>
                  </div>
                  <input
                    type="range"
                    id="cust-${item.key}"
                    data-param-key="${item.key}"
                    data-param-type="number"
                    min="${item.min}"
                    max="${item.max}"
                    step="${item.step}"
                    value="${item.value}"
                  >
                </div>
              `;
            })
            .join('')}
        </div>
      `
      )
      .join('');

    container.querySelectorAll('input[data-param-key]').forEach((inputEl) => {
      const key = inputEl.dataset.paramKey;
      const type = inputEl.dataset.paramType;

      if (type === 'number') {
        inputEl.addEventListener('input', () => {
          const badge = document.getElementById(`val-${key}`);
          if (badge) badge.textContent = `${inputEl.value}`;
        });
        inputEl.addEventListener('change', () => this.recompileFromCustomizer());
      } else {
        inputEl.addEventListener('change', () => this.recompileFromCustomizer());
      }
    });
  }

  humanizeParamName(key = '') {
    const dict = {
      pcb_length: 'Lunghezza PCB (X)',
      pcb_width: 'Larghezza PCB (Y)',
      pcb_thickness: 'Spessore PCB (Z)',
      pcb_l: 'Lunghezza PCB (pcb_l)',
      pcb_w: 'Larghezza PCB (pcb_w)',
      pcb_t: 'Spessore PCB (pcb_t)',
      corner_radius: 'Raggio Angoli PCB',
      corner_r: 'Raggio Angoli (corner_r)',
      hole_diameter: 'Diametro Fori M3',
      hole_d: 'Diametro Fori (hole_d)',
      hole_pitch_x: 'Interasse Fori X',
      hole_pitch_y: 'Interasse Fori Y',
      usb_protrusion: 'Sporgenza USB-C',
      display_height: 'Spessore Display / Top',
      show_silkscreen: 'Mostra Serigrafie PCB',
      show_headers: 'Mostra Pin Header 2.54mm',
      show_components: 'Mostra Componenti SMD/JST/USB',
      show_display: 'Mostra Display IPS / Touch',
      $fn: 'Risoluzione Curve ($fn)'
    };
    return dict[key] || key.replace(/_/g, ' ');
  }

  /**
   * Raccoglie tutti i valori correnti del Customizer e ricompila istantaneamente STL + 3MF
   */
  async recompileFromCustomizer() {
    if (!this.activeModel) return;
    const container = document.getElementById('customizer-controls-container');
    if (!container) return;

    const overrides = {};
    container.querySelectorAll('input[data-param-key]').forEach((inp) => {
      const key = inp.dataset.paramKey;
      const type = inp.dataset.paramType;
      overrides[key] = type === 'boolean' ? inp.checked : Number(inp.value);
    });

    const editorEl = document.getElementById('scad-code-editor');
    const baseScad = editorEl ? editorEl.value : this.activeModel.scad;

    const res = await this.compileScad(baseScad, overrides);
    if (res.ok) {
      this.activeModel.customMeshLocked = false;
      this.activeModel.scad = res.scadCode;
      this.activeModel.stlBuffer = res.stlBuffer;
      this.activeModel.threemfBuffer = res.threemfBuffer;
      this.activeModel.viewerParts = res.viewerParts;
      this.activeModel.metrics = res.metrics;
      if (this.activeModel.meta && res.metrics?.dimensions) {
        this.activeModel.meta.dimensions = res.metrics.dimensions;
      }

      if (editorEl) editorEl.value = res.scadCode;
      this.viewer3d.renderCompiledParts(res.viewerParts, res.metrics, this.activeModel.previewDataUrl);
      this.renderComponentFileManager(this.activeModel);

      const dims = res.metrics.dimensions;
      const dimsLabelEl = document.getElementById('studio-dimensions-label');
      if (dimsLabelEl && dims) {
        dimsLabelEl.textContent = `Ingombro: ${Number(dims.length).toFixed(1)} × ${Number(dims.width).toFixed(1)} × ${Number(dims.height).toFixed(1)} mm · ${res.metrics.triangles} triangoli`;
      }
    } else {
      this.showToast(`Errore ricompilazione: ${res.error}`, 'error');
    }
  }

  /**
   * Compila il codice attualmente presente nell'Editor .SCAD e aggiorna immediatamente il rendering 3D
   */
  async compileFromEditor(saveAfterCompile = false) {
    const editorEl = document.getElementById('scad-code-editor');
    const consoleEl = document.getElementById('compiler-console-output');
    if (!editorEl || !this.activeModel) return;

    const codeToCompile = editorEl.value;
    if (consoleEl) {
      consoleEl.textContent = '[OpenSCAD AST CSG Engine] Compilazione in corso...';
    }

    const res = await this.compileScad(codeToCompile);
    if (res.ok) {
      this.activeModel.customMeshLocked = false;
      this.activeModel.scad = res.scadCode;
      this.activeModel.stlBuffer = res.stlBuffer;
      this.activeModel.threemfBuffer = res.threemfBuffer;
      this.activeModel.viewerParts = res.viewerParts;
      this.activeModel.metrics = res.metrics;
      if (this.activeModel.meta && res.metrics?.dimensions) {
        this.activeModel.meta.dimensions = res.metrics.dimensions;
      }

      this.populateStudioUI(this.activeModel);

      if (saveAfterCompile) {
        await this.saveActiveComponentAllFiles(true);
      } else {
        this.showToast(
          `Rendering 3D aggiornato (${res.metrics.triangles} triangoli in ${res.metrics.elapsedMs} ms)! Clicca "Salva Modifiche" per renderlo permanente.`,
          'success'
        );
      }
    } else {
      if (consoleEl) consoleEl.textContent = `[ERRORE COMPILAZIONE] ${res.error}`;
      this.showToast(`Errore compilazione OpenSCAD: ${res.error}`, 'error');
    }
  }

  /**
   * Popola il tab "File & Info (5 File)" con il gestore completo per modificare/sostituire/salvare:
   *   1. model.scad
   *   2. model.stl
   *   3. model.3mf
   *   4. preview.png
   *   5. meta.json
   */
  renderComponentFileManager(model) {
    const container = document.getElementById('studio-meta-details');
    if (!container || !model) return;

    const meta = model.meta || {};
    const dims = meta.dimensions || { length: 86, width: 50, height: 11.2 };
    const scadKb = ((new TextEncoder().encode(model.scad || '').length) / 1024).toFixed(1);
    const stlKb = ((model.stlBuffer?.byteLength || 0) / 1024).toFixed(1);
    const threemfKb = ((model.threemfBuffer?.byteLength || 0) / 1024).toFixed(1);
    const trisCount = model.metrics?.triangles || '--';

    container.innerHTML = `
      <div class="file-manager-grid">
        <!-- Global Save Bar inside File Manager -->
        <div class="file-slot-card" style="border-color: var(--border-strong); background: rgba(56, 189, 248, 0.06);">
          <div class="file-slot-header">
            <span class="file-slot-name">Cartella: models/${meta.slug || model.slug}/</span>
            <span class="badge ${model.hasLocalOverride ? 'badge-warning' : 'badge-emerald'}">
              ${model.hasLocalOverride ? 'Modifiche Locali Attive' : 'Sincronizzato'}
            </span>
          </div>
          <p class="card-desc" style="margin: 0; font-size: 0.78rem;">
            Puoi sostituire o modificare singolarmente ciascuno dei 5 file qui sotto e salvare l'intero componente nel browser, su disco locale o su GitHub.
          </p>
          <div class="file-slot-actions">
            <button type="button" class="btn btn-primary btn-xs" id="fm-save-all-local-btn">
              💾 Salva Tutti i File nel Browser
            </button>
            <button type="button" class="btn btn-secondary btn-xs" id="fm-save-all-disk-btn">
              📁 Scrivi Cartella su Disco
            </button>
            ${
              model.source === 'repo' && model.hasLocalOverride
                ? `<button type="button" class="btn btn-ghost btn-xs" id="fm-reset-repo-btn" title="Annulla le modifiche locali e ricarica i file originali del repository">
                    ↺ Ripristina Originale Repo
                  </button>`
                : ''
            }
          </div>
        </div>

        <!-- 1. FILE: model.scad -->
        <div class="file-slot-card">
          <div class="file-slot-header">
            <span class="file-slot-name">1. model.scad</span>
            <span class="file-slot-meta">${scadKb} KB · Sorgente Parametrico</span>
          </div>
          <div class="file-slot-actions">
            <label class="btn btn-secondary btn-xs" for="fm-upload-scad">
              Sostituisci .SCAD da PC
            </label>
            <input type="file" id="fm-upload-scad" accept=".scad,text/plain" hidden>
            <button type="button" class="btn btn-outline btn-xs" id="fm-edit-scad-tab-btn">
              Apri nell'Editor
            </button>
            <button type="button" class="btn btn-ghost btn-xs" id="fm-dl-scad-btn">
              Scarica .SCAD
            </button>
          </div>
        </div>

        <!-- 2. FILE: model.stl -->
        <div class="file-slot-card">
          <div class="file-slot-header">
            <span class="file-slot-name">2. model.stl</span>
            <span class="file-slot-meta">${stlKb} KB · ${trisCount} triangoli ${model.customMeshLocked ? '(STL Custom)' : '(Da .SCAD)'}</span>
          </div>
          <div class="file-slot-actions">
            <label class="btn btn-secondary btn-xs" for="fm-upload-stl" title="Carica un file .STL esterno e visualizzalo subito in 3D">
              Carica / Sostituisci .STL
            </label>
            <input type="file" id="fm-upload-stl" accept=".stl" hidden>
            <button type="button" class="btn btn-outline btn-xs" id="fm-regen-stl-btn" title="Rigenera model.stl ricompilando lo script model.scad">
              Rigenera da .SCAD
            </button>
            <button type="button" class="btn btn-ghost btn-xs" id="fm-dl-stl-btn">
              Scarica .STL
            </button>
          </div>
        </div>

        <!-- 3. FILE: model.3mf -->
        <div class="file-slot-card">
          <div class="file-slot-header">
            <span class="file-slot-name">3. model.3mf</span>
            <span class="file-slot-meta">${threemfKb} KB · Multicolore Slicer</span>
          </div>
          <div class="file-slot-actions">
            <label class="btn btn-secondary btn-xs" for="fm-upload-3mf" title="Carica un file .3MF esterno per questo componente">
              Carica / Sostituisci .3MF
            </label>
            <input type="file" id="fm-upload-3mf" accept=".3mf" hidden>
            <button type="button" class="btn btn-outline btn-xs" id="fm-regen-3mf-btn">
              Rigenera da .SCAD
            </button>
            <button type="button" class="btn btn-ghost btn-xs" id="fm-dl-3mf-btn">
              Scarica .3MF
            </button>
          </div>
        </div>

        <!-- 4. FILE: preview.png -->
        <div class="file-slot-card">
          <div class="file-slot-header">
            <span class="file-slot-name">4. preview.png</span>
            <span class="file-slot-meta">Immagine Anteprima &amp; Fallback</span>
          </div>
          <div class="file-slot-preview-row">
            <img class="file-slot-thumb" id="fm-preview-thumb" src="${model.previewDataUrl || './icon-512.png'}" alt="Preview">
            <div class="file-slot-actions">
              <label class="btn btn-secondary btn-xs" for="fm-upload-png">
                Carica PNG / JPG
              </label>
              <input type="file" id="fm-upload-png" accept="image/png,image/jpeg,image/webp" hidden>
              <button type="button" class="btn btn-outline btn-xs" id="fm-capture-png-btn">
                Cattura da 3D
              </button>
              <button type="button" class="btn btn-ghost btn-xs" id="fm-dl-png-btn">
                Scarica .PNG
              </button>
            </div>
          </div>
        </div>

        <!-- 5. FILE: meta.json (Editable Form) -->
        <div class="file-slot-card">
          <div class="file-slot-header">
            <span class="file-slot-name">5. meta.json</span>
            <div class="file-slot-actions">
              <label class="btn btn-ghost btn-xs" for="fm-upload-meta">Importa .JSON</label>
              <input type="file" id="fm-upload-meta" accept=".json,application/json" hidden>
              <button type="button" class="btn btn-ghost btn-xs" id="fm-dl-meta-btn">Scarica .JSON</button>
            </div>
          </div>

          <div class="form-group" style="margin-bottom:8px;">
            <label for="fm-meta-name">Nome Componente</label>
            <input type="text" id="fm-meta-name" value="${this.escapeAttr(meta.name || '')}">
          </div>

          <div class="form-row-2col" style="margin-bottom:8px;">
            <div class="form-group" style="margin-bottom:0;">
              <label for="fm-meta-category">Categoria</label>
              <input type="text" id="fm-meta-category" value="${this.escapeAttr(meta.category || '')}">
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label for="fm-meta-tags">Tag (separati da virgola)</label>
              <input type="text" id="fm-meta-tags" value="${this.escapeAttr((meta.tags || []).join(', '))}">
            </div>
          </div>

          <div class="form-group" style="margin-bottom:8px;">
            <label for="fm-meta-desc">Descrizione Scheda</label>
            <textarea id="fm-meta-desc" rows="2">${this.escapeAttr(meta.description || '')}</textarea>
          </div>

          <div class="form-group" style="margin-bottom:8px;">
            <label for="fm-meta-hw">Specifiche Hardware &amp; Pinout</label>
            <textarea id="fm-meta-hw" rows="2">${this.escapeAttr(meta.hardwareNotes || '')}</textarea>
          </div>

          <button type="button" class="btn btn-primary btn-sm btn-block" id="fm-apply-meta-btn">
            Applica &amp; Salva Modifiche Componente
          </button>
        </div>
      </div>
    `;

    this.bindFileManagerEvents();
  }

  /**
   * Collega gli handler per l'upload/sostituzione di ogni singolo file (SCAD, STL, 3MF, PNG, META)
   */
  bindFileManagerEvents() {
    // Salva tutti i file in IndexedDB
    document.getElementById('fm-save-all-local-btn')?.addEventListener('click', () => {
      this.syncMetaFieldsFromForm();
      this.saveActiveComponentAllFiles(false);
    });

    // Scrivi cartella su disco locale
    document.getElementById('fm-save-all-disk-btn')?.addEventListener('click', async () => {
      if (!this.activeModel) return;
      this.syncMetaFieldsFromForm();
      try {
        const folderName = await storageService.saveModelToLocalDiskFolder(this.activeModel);
        await this.saveActiveComponentAllFiles(false);
        this.showToast(`Tutti i 5 file scritti nella cartella "${folderName}" sul disco!`, 'success');
      } catch (err) {
        if (err.name !== 'AbortError') {
          this.showToast(`Salvataggio su disco non completato: ${err.message}`, 'warning');
        }
      }
    });

    // Ripristina originale repo
    document.getElementById('fm-reset-repo-btn')?.addEventListener('click', async () => {
      if (!this.activeModel) return;
      const slug = this.activeModel.slug;
      await storageService.deleteLocalModel(slug);
      await this.loadModelIntoStudioState(slug, 'repo', false, true);
      await this.refreshGallery();
      this.showToast(`Componente "${slug}" ripristinato ai file originali del repository.`, 'info');
    });

    // 1. Sostituisci model.scad da file
    document.getElementById('fm-upload-scad')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file || !this.activeModel) return;
      const text = await file.text();
      const editorEl = document.getElementById('scad-code-editor');
      if (editorEl) editorEl.value = text;
      await this.compileFromEditor(true);
    });

    document.getElementById('fm-edit-scad-tab-btn')?.addEventListener('click', () => {
      document.querySelector('.insp-tab[data-insp-tab="code"]')?.click();
    });

    document.getElementById('fm-dl-scad-btn')?.addEventListener('click', () => {
      document.getElementById('btn-download-scad')?.click();
    });

    // 2. Sostituisci model.stl da file esterno (e aggiorna subito la vista 3D!)
    document.getElementById('fm-upload-stl')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file || !this.activeModel) return;
      const buf = await file.arrayBuffer();
      const parsed = await this.parseExternalStlBuffer(buf);
      if (parsed.ok) {
        this.activeModel.customMeshLocked = true;
        this.activeModel.stlBuffer = buf;
        this.activeModel.threemfBuffer = parsed.threemfBuffer;
        this.activeModel.viewerParts = parsed.viewerParts;
        this.activeModel.metrics = parsed.metrics;
        if (this.activeModel.meta && parsed.metrics?.dimensions) {
          this.activeModel.meta.dimensions = parsed.metrics.dimensions;
        }
        await this.saveActiveComponentAllFiles(true);
        this.showToast(`File STL "${file.name}" caricato (${parsed.metrics.triangles} triangoli) e salvato!`, 'success');
      } else {
        this.showToast(`Errore lettura STL: ${parsed.error}`, 'error');
      }
    });

    document.getElementById('fm-regen-stl-btn')?.addEventListener('click', () => {
      this.compileFromEditor(true);
    });

    document.getElementById('fm-dl-stl-btn')?.addEventListener('click', () => {
      document.getElementById('btn-download-stl')?.click();
    });

    // 3. Sostituisci model.3mf da file esterno
    document.getElementById('fm-upload-3mf')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file || !this.activeModel) return;
      const buf = await file.arrayBuffer();
      this.activeModel.threemfBuffer = buf;

      // Tenta anche il parsing 3D diretto se il .3mf contiene XML non compresso
      const parsed = await this.parseExternal3mfBuffer(buf);
      if (parsed.ok) {
        this.activeModel.customMeshLocked = true;
        this.activeModel.stlBuffer = parsed.stlBuffer;
        this.activeModel.viewerParts = parsed.viewerParts;
        this.activeModel.metrics = parsed.metrics;
      }

      await this.saveActiveComponentAllFiles(false);
      this.showToast(`File 3MF "${file.name}" associato e salvato nel componente!`, 'success');
    });

    document.getElementById('fm-regen-3mf-btn')?.addEventListener('click', () => {
      this.compileFromEditor(true);
    });

    document.getElementById('fm-dl-3mf-btn')?.addEventListener('click', () => {
      document.getElementById('btn-download-3mf')?.click();
    });

    // 4. Sostituisci preview.png da file immagine
    document.getElementById('fm-upload-png')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file || !this.activeModel) return;
      const reader = new FileReader();
      reader.onload = async () => {
        this.activeModel.previewDataUrl = reader.result;
        this.viewer3d.setFallbackImage(reader.result);
        await this.saveActiveComponentAllFiles(false);
        this.showToast(`Immagine anteprima "${file.name}" aggiornata e salvata!`, 'success');
      };
      reader.readAsDataURL(file);
    });

    document.getElementById('fm-capture-png-btn')?.addEventListener('click', async () => {
      if (!this.activeModel) return;
      const shot = this.viewer3d.capturePreviewPng();
      if (shot) {
        this.activeModel.previewDataUrl = shot;
        await this.saveActiveComponentAllFiles(false);
      }
    });

    document.getElementById('fm-dl-png-btn')?.addEventListener('click', async () => {
      if (!this.activeModel?.previewDataUrl) return;
      const bytes = await storageService.dataUrlOrUrlToUint8Array(this.activeModel.previewDataUrl);
      if (bytes) {
        storageService.triggerBlobDownload(new Blob([bytes], { type: 'image/png' }), `${this.activeModel.slug}-preview.png`);
      }
    });

    // 5. Modifica / Importa meta.json
    document.getElementById('fm-upload-meta')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file || !this.activeModel) return;
      try {
        const json = JSON.parse(await file.text());
        this.activeModel.meta = {
          ...this.activeModel.meta,
          ...json,
          slug: this.activeModel.slug
        };
        await this.saveActiveComponentAllFiles(false);
      } catch (err) {
        this.showToast(`File meta.json non valido: ${err.message}`, 'error');
      }
    });

    document.getElementById('fm-dl-meta-btn')?.addEventListener('click', () => {
      if (!this.activeModel?.meta) return;
      this.syncMetaFieldsFromForm();
      const str = JSON.stringify(this.activeModel.meta, null, 2);
      storageService.triggerBlobDownload(new Blob([str], { type: 'application/json' }), 'meta.json');
    });

    document.getElementById('fm-apply-meta-btn')?.addEventListener('click', async () => {
      this.syncMetaFieldsFromForm();
      await this.saveActiveComponentAllFiles(false);
    });
  }

  syncMetaFieldsFromForm() {
    if (!this.activeModel?.meta) return;
    const nameEl = document.getElementById('fm-meta-name');
    const catEl = document.getElementById('fm-meta-category');
    const tagsEl = document.getElementById('fm-meta-tags');
    const descEl = document.getElementById('fm-meta-desc');
    const hwEl = document.getElementById('fm-meta-hw');

    if (nameEl && nameEl.value.trim()) this.activeModel.meta.name = nameEl.value.trim();
    if (catEl) this.activeModel.meta.category = catEl.value.trim();
    if (tagsEl) {
      this.activeModel.meta.tags = tagsEl.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
    if (descEl) this.activeModel.meta.description = descEl.value.trim();
    if (hwEl) this.activeModel.meta.hardwareNotes = hwEl.value.trim();
  }

  escapeAttr(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Scarica rapidamente un singolo formato dalla card della Libreria
   */
  async quickDownloadFromCard(slug, source, format) {
    try {
      const model = await storageService.loadFullModel(slug, source);
      let stlBuf = model.stlBuffer;
      let threemfBuf = model.threemfBuffer;

      if (!stlBuf || !threemfBuf) {
        const compiled = await this.compileScad(model.scad);
        if (compiled.ok) {
          stlBuf = compiled.stlBuffer;
          threemfBuf = compiled.threemfBuffer;
        }
      }

      if (format === 'stl' && stlBuf) {
        storageService.triggerBlobDownload(new Blob([stlBuf], { type: 'model/stl' }), `${slug}.stl`);
        this.showToast(`Scaricato ${slug}.stl (Fusion 360 ready)`, 'success');
      } else if (format === '3mf' && threemfBuf) {
        storageService.triggerBlobDownload(new Blob([threemfBuf], { type: 'model/3mf' }), `${slug}.3mf`);
        this.showToast(`Scaricato ${slug}.3mf multicolore`, 'success');
      } else if (format === 'scad') {
        storageService.triggerBlobDownload(new Blob([model.scad], { type: 'text/plain;charset=utf-8' }), `${slug}.scad`);
        this.showToast(`Scaricato ${slug}.scad parametrico`, 'success');
      }
    } catch (err) {
      this.showToast(`Download non riuscito: ${err.message}`, 'error');
    }
  }

  async deleteLocalModel(slug) {
    await storageService.deleteLocalModel(slug);
    await this.refreshGallery();
    this.showToast(`Modifiche locali per "${slug}" rimosse da IndexedDB.`, 'info');
  }

  /**
   * Collega tutti i pulsanti di navigazione, viewport 3D, editor e download
   */
  bindGlobalEvents() {
    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.nav;
        this.switchView(target);
      });
    });

    document.getElementById('brand-home-btn')?.addEventListener('click', () => this.switchView('gallery'));
    document.getElementById('hero-new-board-btn')?.addEventListener('click', () => this.switchView('wizard'));
    document.getElementById('studio-back-gallery-btn')?.addEventListener('click', () => this.switchView('gallery'));

    // Apertura Modale Impostazioni
    document.getElementById('open-settings-btn')?.addEventListener('click', () => this.settings.open());
    document.getElementById('mobile-settings-btn')?.addEventListener('click', () => this.settings.open());

    // Tabs dell'Inspector (Customizer / Editor .SCAD / File & Info)
    const inspTabs = document.querySelectorAll('.inspector-tabs .insp-tab');
    inspTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        inspTabs.forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');

        const targetId = `insp-tab-${tab.dataset.inspTab}`;
        ['insp-tab-customizer', 'insp-tab-code', 'insp-tab-meta'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.hidden = id !== targetId;
        });
      });
    });

    // Controlli Telecamera Viewport 3D
    document.querySelectorAll('[data-cam]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cam]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.viewer3d.setCameraPreset(btn.dataset.cam);
      });
    });

    const colorModeBtn = document.getElementById('toggle-color-mode-btn');
    if (colorModeBtn) {
      colorModeBtn.addEventListener('click', () => {
        const isMulti = this.viewer3d.toggleColorMode();
        colorModeBtn.textContent = isMulti ? '3MF Multicolore' : 'STL Monocolore';
        colorModeBtn.classList.toggle('active', isMulti);
      });
    }

    const wireBtn = document.getElementById('toggle-wireframe-btn');
    if (wireBtn) {
      wireBtn.addEventListener('click', () => {
        const isWire = this.viewer3d.toggleWireframe();
        wireBtn.classList.toggle('active', isWire);
      });
    }

    const gridBtn = document.getElementById('toggle-grid-btn');
    if (gridBtn) {
      gridBtn.addEventListener('click', () => {
        const isGrid = this.viewer3d.toggleGrid();
        gridBtn.classList.toggle('active', isGrid);
      });
    }

    // Pulsante "Cattura Anteprima PNG"
    document.getElementById('capture-png-btn')?.addEventListener('click', async () => {
      const dataUrl = this.viewer3d.capturePreviewPng();
      if (!dataUrl) {
        this.showToast('Impossibile catturare screenshot PNG.', 'warning');
        return;
      }
      if (this.activeModel) {
        this.activeModel.previewDataUrl = dataUrl;
        this.viewer3d.setFallbackImage(dataUrl);
        await this.saveActiveComponentAllFiles(false);
      }
      const bytes = await storageService.dataUrlOrUrlToUint8Array(dataUrl);
      if (bytes) {
        storageService.triggerBlobDownload(new Blob([bytes], { type: 'image/png' }), 'preview.png');
      }
    });

    // Pulsante "Ricompilazione Rapida"
    document.getElementById('btn-fast-recompile')?.addEventListener('click', async () => {
      await this.recompileFromCustomizer();
      this.showToast('Modello 3D ricompilato in STL e 3MF!', 'success');
    });

    // Pulsanti Editor Codice .SCAD
    document.getElementById('btn-compile-from-editor')?.addEventListener('click', () => {
      this.compileFromEditor(false);
    });

    document.getElementById('btn-compile-and-save-editor')?.addEventListener('click', () => {
      this.compileFromEditor(true);
    });

    // Scorciatoia da tastiera Ctrl+Invio / Cmd+Invio dentro l'editor .SCAD
    document.getElementById('scad-code-editor')?.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.compileFromEditor(false);
      }
    });

    // Upload file .scad diretto nella barra dell'Editor
    document.getElementById('upload-scad-input')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const editorEl = document.getElementById('scad-code-editor');
      if (editorEl) editorEl.value = text;
      await this.compileFromEditor(false);
    });

    document.getElementById('btn-ai-autofix-code')?.addEventListener('click', async () => {
      const editorEl = document.getElementById('scad-code-editor');
      if (!editorEl || !this.activeModel) return;
      const fixed = await aiService.autoFixManifoldScript(
        editorEl.value,
        'Verifica compenetrazione eps = 0.05 mm e rimozione facce coplanari',
        {},
        this.activeModel.meta?.name
      );
      editorEl.value = fixed;
      await this.compileFromEditor(false);
      this.showToast('Auto-Fix Manifold (eps = 0.05 mm) applicato e ricompilato!', 'success');
    });

    // Pulsanti Download e Salvataggio nella Top Bar dello Studio 3D
    document.getElementById('btn-download-stl')?.addEventListener('click', () => {
      if (!this.activeModel?.stlBuffer) return;
      storageService.triggerBlobDownload(
        new Blob([this.activeModel.stlBuffer], { type: 'model/stl' }),
        `${this.activeModel.slug || 'model'}.stl`
      );
      this.showToast('File .STL scaricato (pronto per Fusion 360).', 'success');
    });

    document.getElementById('btn-download-3mf')?.addEventListener('click', () => {
      if (!this.activeModel?.threemfBuffer) return;
      storageService.triggerBlobDownload(
        new Blob([this.activeModel.threemfBuffer], { type: 'model/3mf' }),
        `${this.activeModel.slug || 'model'}.3mf`
      );
      this.showToast('File .3MF multicolore scaricato (pronto per Bambu/PrusaSlicer).', 'success');
    });

    document.getElementById('btn-download-scad')?.addEventListener('click', () => {
      const editorEl = document.getElementById('scad-code-editor');
      const code = editorEl?.value || this.activeModel?.scad;
      if (!code) return;
      storageService.triggerBlobDownload(
        new Blob([code], { type: 'text/plain;charset=utf-8' }),
        `${this.activeModel.slug || 'model'}.scad`
      );
      this.showToast('Script parametrico .SCAD scaricato.', 'success');
    });

    document.getElementById('btn-download-zip')?.addEventListener('click', async () => {
      if (!this.activeModel) return;
      const editorEl = document.getElementById('scad-code-editor');
      if (editorEl?.value) this.activeModel.scad = editorEl.value;
      await storageService.downloadModelFolderZip(this.activeModel);
      this.showToast(`Pacchetto cartella ${this.activeModel.slug}.zip scaricato!`, 'success');
    });

    document.getElementById('btn-save-local')?.addEventListener('click', async () => {
      if (!this.activeModel) return;
      const editorEl = document.getElementById('scad-code-editor');
      if (editorEl && editorEl.value !== this.activeModel.scad && !this.activeModel.customMeshLocked) {
        await this.compileFromEditor(true);
      } else {
        this.syncMetaFieldsFromForm();
        await this.saveActiveComponentAllFiles(true);
      }
    });

    document.getElementById('btn-save-disk-folder')?.addEventListener('click', async () => {
      if (!this.activeModel) return;
      this.syncMetaFieldsFromForm();
      const editorEl = document.getElementById('scad-code-editor');
      if (editorEl?.value) this.activeModel.scad = editorEl.value;
      try {
        const folderName = await storageService.saveModelToLocalDiskFolder(this.activeModel);
        await this.saveActiveComponentAllFiles(false);
        this.showToast(`Tutti i 5 file salvati nella cartella "${folderName}" sul tuo disco!`, 'success');
      } catch (err) {
        if (err.name !== 'AbortError') {
          this.showToast(`Salvataggio su disco annullato o non supportato: ${err.message}`, 'warning');
        }
      }
    });

    document.getElementById('btn-push-github')?.addEventListener('click', async () => {
      if (!this.activeModel) return;
      this.syncMetaFieldsFromForm();
      const editorEl = document.getElementById('scad-code-editor');
      if (editorEl?.value) this.activeModel.scad = editorEl.value;

      const settings = storageService.getSettings();
      if (!settings.ghToken || !settings.ghOwner || !settings.ghRepo) {
        this.settings.open();
        this.showToast('Configura Owner, Repo e Personal Access Token GitHub per eseguire il commit diretto.', 'warning');
        return;
      }

      const btn = document.getElementById('btn-push-github');
      const origHtml = btn.innerHTML;
      btn.disabled = true;

      try {
        await githubService.pushModelToGitHub(this.activeModel, (statusMsg) => {
          btn.textContent = statusMsg;
        });
        this.showToast(`Commit completato in models/${this.activeModel.slug}/ su GitHub!`, 'success');
        await this.refreshGallery();
      } catch (err) {
        this.showToast(`Errore GitHub Push: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    });
  }

  switchView(viewName) {
    this.currentView = viewName;

    const views = {
      gallery: document.getElementById('view-gallery'),
      wizard: document.getElementById('view-wizard'),
      studio: document.getElementById('view-studio')
    };

    for (const [k, el] of Object.entries(views)) {
      if (!el) continue;
      const isTarget = k === viewName;
      el.hidden = !isTarget;
      el.classList.toggle('active', isTarget);
    }

    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === viewName);
    });

    if (viewName === 'studio' && this.viewer3d) {
      setTimeout(() => this.viewer3d.onResize(), 50);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  updateHeaderStatus() {
    const s = storageService.getSettings();
    const pill = document.getElementById('wasm-status-pill');
    if (!pill) return;
    const label = pill.querySelector('.status-label');
    if (label) {
      const hasAi = Boolean(s.aiApiKey && s.aiProvider !== 'offline');
      const hasGh = Boolean(s.ghToken && s.ghOwner);
      if (hasAi && hasGh) {
        label.textContent = 'AI + GitHub Ready';
      } else if (hasAi) {
        label.textContent = 'AI Vision Ready';
      } else {
        label.textContent = 'AST CSG Ready';
      }
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 4500);
  }

  async registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      try {
        await navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`);
      } catch (err) {
        console.warn('[PWA] Registrazione Service Worker rimandata:', err);
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new Board2CADApp();
  app.init();
});
