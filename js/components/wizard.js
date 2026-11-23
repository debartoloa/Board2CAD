/**
 * Board2CAD — 3-Step AI Vision & Parametric CAD Wizard (js/components/wizard.js)
 * Step 1: Upload board photos + name + notes
 * Step 2: AI Vision Inspection & Dynamic Clarification Form (Clarification First)
 * Step 3: OpenSCAD 100% Manifold Code Generation + Auto-Fix Loop (max 2 retries) + STL & 3MF Compilation
 */

import { aiService } from '../services/aiService.js';

export class WizardComponent {
  constructor({ compileScadWithWorker, onModelGenerated, showToast }) {
    this.compileScadWithWorker = compileScadWithWorker;
    this.onModelGenerated = onModelGenerated;
    this.showToast = showToast;

    this.uploadedImages = [];
    this.currentAnalysis = null;
    this.generatedModelData = null;

    // Elementi DOM Step 1..3
    this.stepperItems = document.querySelectorAll('.wizard-stepper .step-item');
    this.step1Panel = document.getElementById('wizard-step-1');
    this.step2Panel = document.getElementById('wizard-step-2');
    this.step3Panel = document.getElementById('wizard-step-3');

    this.dropzoneEl = document.getElementById('wizard-dropzone');
    this.fileInputEl = document.getElementById('wizard-file-input');
    this.thumbsContainerEl = document.getElementById('wizard-thumbs-container');

    this.nameInputEl = document.getElementById('board-name-input');
    this.categorySelectEl = document.getElementById('board-category-select');
    this.presetSelectEl = document.getElementById('board-preset-select');
    this.notesInputEl = document.getElementById('board-notes-input');
    this.baseScadInputEl = document.getElementById('wizard-base-scad-input');
    this.scadFileInputEl = document.getElementById('wizard-scad-file-input');

    this.clarificationFormEl = document.getElementById('clarification-form');
    this.analysisSummaryEl = document.getElementById('ai-analysis-summary');
    this.pipelineLogEl = document.getElementById('wizard-pipeline-log');
    this.step3ActionsEl = document.getElementById('wizard-step3-actions');

    this.bindEvents();
  }

  bindEvents() {
    // Upload file / camera
    if (this.fileInputEl) {
      this.fileInputEl.addEventListener('change', (e) => {
        this.handleFiles(Array.from(e.target.files || []));
      });
    }

    if (this.dropzoneEl) {
      ['dragenter', 'dragover'].forEach((evt) => {
        this.dropzoneEl.addEventListener(evt, (e) => {
          e.preventDefault();
          this.dropzoneEl.classList.add('dragover');
        });
      });
      ['dragleave', 'drop'].forEach((evt) => {
        this.dropzoneEl.addEventListener(evt, (e) => {
          e.preventDefault();
          this.dropzoneEl.classList.remove('dragover');
        });
      });
      this.dropzoneEl.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer?.files || []);
        this.handleFiles(files);
      });
    }

    const analyzeBtn = document.getElementById('wizard-analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', () => this.runStep2Analysis());
    }

    // Caricamento file .SCAD di partenza nel Wizard
    if (this.scadFileInputEl) {
      this.scadFileInputEl.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        if (this.baseScadInputEl) {
          this.baseScadInputEl.value = text;
        }
        if (this.presetSelectEl) {
          this.presetSelectEl.value = 'from-scad';
        }
        if (this.nameInputEl && !this.nameInputEl.value.trim()) {
          this.nameInputEl.value = file.name.replace(/\.scad$/i, '');
        }
        if (this.showToast) {
          this.showToast(`File "${file.name}" caricato come codice .SCAD di partenza!`, 'success');
        }
      });
    }

    const clearScadBtn = document.getElementById('wizard-clear-scad-btn');
    if (clearScadBtn) {
      clearScadBtn.addEventListener('click', () => {
        if (this.baseScadInputEl) this.baseScadInputEl.value = '';
        if (this.scadFileInputEl) this.scadFileInputEl.value = '';
      });
    }

    // Pulsante "Compila Direttamente il mio .SCAD così com'è"
    const directCompileBtn = document.getElementById('wizard-direct-compile-scad-btn');
    if (directCompileBtn) {
      directCompileBtn.addEventListener('click', () => {
        const existingScad = (this.baseScadInputEl?.value || '').trim();
        if (!existingScad) {
          if (this.showToast) {
            this.showToast('Incolla o carica prima un codice .SCAD nella casella "Codice .SCAD di partenza"!', 'warning');
          }
          this.baseScadInputEl?.focus();
          return;
        }
        this.runStep3Generation(true);
      });
    }

    const backStep1Btn = document.getElementById('wizard-back-step1-btn');
    if (backStep1Btn) {
      backStep1Btn.addEventListener('click', () => this.goToStep(1));
    }

    const generateScadBtn = document.getElementById('wizard-generate-scad-btn');
    if (generateScadBtn) {
      generateScadBtn.addEventListener('click', () => this.runStep3Generation());
    }

    const backStep2Btn = document.getElementById('wizard-back-step2-btn');
    if (backStep2Btn) {
      backStep2Btn.addEventListener('click', () => this.goToStep(2));
    }

    const openStudioBtn = document.getElementById('wizard-open-studio-btn');
    if (openStudioBtn) {
      openStudioBtn.addEventListener('click', () => {
        if (this.generatedModelData && this.onModelGenerated) {
          this.onModelGenerated(this.generatedModelData, true);
        }
      });
    }

    const resetBtn = document.getElementById('wizard-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetWizard());
    }
  }

  /**
   * Legge e ridimensiona le immagini caricate in DataURL
   */
  async handleFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await this.readFileAsDataUrl(file);
      this.uploadedImages.push({
        name: file.name,
        dataUrl
      });
    }
    this.renderThumbnails();
  }

  readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  renderThumbnails() {
    if (!this.thumbsContainerEl) return;
    this.thumbsContainerEl.innerHTML = this.uploadedImages
      .map(
        (img, idx) => `
        <div class="thumb-item">
          <img src="${img.dataUrl}" alt="${img.name}">
          <button type="button" class="thumb-remove" data-idx="${idx}" title="Rimuovi immagine">✕</button>
        </div>
      `
      )
      .join('');

    this.thumbsContainerEl.querySelectorAll('.thumb-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.idx);
        this.uploadedImages.splice(i, 1);
        this.renderThumbnails();
      });
    });
  }

  /**
   * Step 2: Esegue l'analisi AI Vision ("Clarification First")
   */
  async runStep2Analysis() {
    const name = (this.nameInputEl?.value || '').trim() || 'ESP32 Custom Module';
    if (this.nameInputEl && !this.nameInputEl.value) {
      this.nameInputEl.value = name;
    }

    const category = this.categorySelectEl?.value || 'HMI / Display MCU';
    const preset = this.presetSelectEl?.value || 'auto';
    const notes = (this.notesInputEl?.value || '').trim();
    const existingScad = (this.baseScadInputEl?.value || '').trim();

    const analyzeBtn = document.getElementById('wizard-analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.querySelector('span').textContent = 'Ispezione AI & Codice in corso...';
    }

    try {
      const analysis = await aiService.analyzeBoardImages({
        name,
        category,
        preset,
        notes,
        images: this.uploadedImages,
        existingScad
      });

      this.currentAnalysis = analysis;
      this.renderClarificationForm(analysis);
      this.goToStep(2);

      if (analysis.hasExistingScad && this.showToast) {
        this.showToast('Quote estratte dal tuo codice .SCAD! Verifica i valori e procedi allo Step 3 per applicare le modifiche.', 'success');
      } else if (!analysis.needsClarification && this.showToast) {
        this.showToast('Quote principali rilevate! Puoi confermare o procedere subito alla compilazione 3D.', 'info');
      }
    } catch (err) {
      if (this.showToast) {
        this.showToast(`Errore analisi scheda: ${err.message}`, 'error');
      }
    } finally {
      if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.querySelector('span').textContent = 'Analizza & Verifica Quote / Modifiche (Step 2)';
      }
    }
  }

  /**
   * Genera dinamicamente il form HTML per i soli dati critici ("Clarification First")
   */
  renderClarificationForm(analysis) {
    if (this.analysisSummaryEl) {
      this.analysisSummaryEl.textContent = analysis.summary || 'Conferma le misure critiche stimate per la scheda.';
    }

    if (!this.clarificationFormEl) return;

    this.clarificationFormEl.innerHTML = (analysis.questions || [])
      .map(
        (q) => `
        <div class="form-group">
          <label for="clarify-${q.id}">${q.label} (${q.unit || 'mm'})</label>
          <input
            type="${q.type || 'number'}"
            id="clarify-${q.id}"
            name="${q.id}"
            value="${q.suggestedValue}"
            min="${q.min ?? 0}"
            max="${q.max ?? 500}"
            step="${q.step ?? 0.1}"
            required
          >
        </div>
      `
      )
      .join('');
  }

  /**
   * Legge i parametri confermati dall'utente nel form Step 2
   */
  collectClarifiedParameters() {
    const params = {};
    if (!this.clarificationFormEl) return params;
    const inputs = this.clarificationFormEl.querySelectorAll('input');
    inputs.forEach((inp) => {
      params[inp.name] = Number(inp.value);
    });
    return params;
  }

  /**
   * Step 3: Generazione/Modifica script OpenSCAD, Auto-Fix Loop (max 2 tentativi) e compilazione STL + 3MF
   */
  async runStep3Generation(directCompileExistingScad = false) {
    this.goToStep(3);
    if (this.step3ActionsEl) this.step3ActionsEl.hidden = true;
    if (this.pipelineLogEl) this.pipelineLogEl.innerHTML = '';

    const name = (this.nameInputEl?.value || 'Scheda Custom 3D').trim() || 'Scheda Custom 3D';
    if (this.nameInputEl && !this.nameInputEl.value.trim()) {
      this.nameInputEl.value = name;
    }
    const category = this.categorySelectEl?.value || 'HMI / Display MCU';
    const preset = this.presetSelectEl?.value || 'auto';
    const notes = (this.notesInputEl?.value || '').trim();
    const existingScad = (this.baseScadInputEl?.value || '').trim();
    const parameters = directCompileExistingScad
      ? aiService.extractDimensionsFromNotes(notes, name, category, preset, existingScad)
      : this.collectClarifiedParameters();

    const slug = this.slugify(name);

    this.appendLog(`Avvio elaborazione OpenSCAD 100% Manifold per "${name}" (${slug})...`, 'info');

    let scadCode = '';
    if (directCompileExistingScad && existingScad) {
      this.appendLog('Modalità Compilazione Diretta: utilizzo il codice .SCAD fornito dall\'utente...', 'info');
      scadCode = notes
        ? aiService.applyModificationsToExistingScad(existingScad, parameters, notes, name)
        : existingScad;
    } else {
      if (existingScad) {
        this.appendLog(`Applicazione modifiche richieste sul codice .SCAD di partenza (${existingScad.split(/\r?\n/).length} righe)...`, 'info');
      }
      this.appendLog(
        `Quote confermate: PCB ${parameters.pcb_length} × ${parameters.pcb_width} × ${parameters.pcb_thickness} mm, Fori Ø${parameters.hole_diameter} mm (${parameters.hole_pitch_x} × ${parameters.hole_pitch_y} mm).`,
        'info'
      );

      scadCode = await aiService.generateOpenSCAD({
        name,
        category,
        preset,
        notes,
        parameters,
        images: this.uploadedImages,
        existingScad
      });
    }

    this.appendLog('Script OpenSCAD generato con compenetrazione eps = 0.05 mm e blocchi Customizer.', 'ok');

    // Compilazione + Loop di Auto-Fix (max 2 tentativi in caso di warning/errore non-manifold)
    let compileResult = null;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.appendLog(`[Tentativo ${attempt}/${maxAttempts}] Compilazione Web Worker OpenSCAD -> model.stl & model.3mf...`, 'info');
      compileResult = await this.compileScadWithWorker(scadCode);

      if (compileResult.ok && compileResult.validation?.isManifold !== false) {
        this.appendLog(
          `Compilazione completata in ${compileResult.metrics.elapsedMs} ms: ${compileResult.metrics.triangles} triangoli, mesh 100% watertight.`,
          'ok'
        );
        break;
      }

      const issueMsg =
        compileResult.error ||
        (compileResult.validation?.warnings || []).join('; ') ||
        'Avviso mesh non-manifold rilevato';
      this.appendLog(`Rilevato problema manifold/sintassi: ${issueMsg}. Avvio Auto-Fix AI...`, 'warn');

      scadCode = await aiService.autoFixManifoldScript(scadCode, issueMsg, parameters, name);
    }

    if (!compileResult || !compileResult.ok) {
      this.appendLog('Applicazione fallback geometrico sicuro 100% manifold...', 'warn');
      scadCode = aiService.buildParametricManifoldScad({ name, category, preset, notes, parameters });
      compileResult = await this.compileScadWithWorker(scadCode);
    }

    const dims = compileResult.metrics?.dimensions || {
      length: parameters.pcb_length || 86.0,
      width: parameters.pcb_width || 50.0,
      height: 11.2
    };

    const meta = {
      slug,
      name,
      category,
      description: notes || `Modello parametrico 3D ${name} (${dims.length}x${dims.width}x${dims.height} mm) generato con Board2CAD.`,
      dimensions: dims,
      mountingHoles: {
        diameter: parameters.hole_diameter || 3.2,
        pitchX: parameters.hole_pitch_x || dims.length - 6,
        pitchY: parameters.hole_pitch_y || dims.width - 6
      },
      tags: ['OpenSCAD', 'Manifold', 'STL', '3MF', category.split(' ')[0]],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.generatedModelData = {
      slug,
      source: 'local',
      meta,
      scad: compileResult.scadCode || scadCode,
      stlBuffer: compileResult.stlBuffer,
      threemfBuffer: compileResult.threemfBuffer,
      viewerParts: compileResult.viewerParts,
      metrics: compileResult.metrics,
      previewDataUrl: this.uploadedImages[0]?.dataUrl || './models/freenove-esp32-s3-2.8/preview.png'
    };

    this.appendLog(`File generati: model.scad, model.stl (${Math.round((compileResult.stlBuffer?.byteLength || 0) / 1024)} KB), model.3mf (${Math.round((compileResult.threemfBuffer?.byteLength || 0) / 1024)} KB), meta.json.`, 'ok');

    if (this.onModelGenerated) {
      await this.onModelGenerated(this.generatedModelData, false);
    }

    this.appendLog('Modello salvato automaticamente in IndexedDB locale e pronto nello Studio 3D!', 'ok');
    if (this.step3ActionsEl) this.step3ActionsEl.hidden = false;
  }

  appendLog(message, level = 'info') {
    if (!this.pipelineLogEl) return;
    const div = document.createElement('div');
    div.className = `log-entry ${level}`;
    const time = new Date().toLocaleTimeString('it-IT');
    div.textContent = `[${time}] ${message}`;
    this.pipelineLogEl.appendChild(div);
    this.pipelineLogEl.scrollTop = this.pipelineLogEl.scrollHeight;
  }

  goToStep(stepNum) {
    this.stepperItems.forEach((item) => {
      const s = Number(item.dataset.step);
      item.classList.toggle('active', s === stepNum);
      item.classList.toggle('done', s < stepNum);
    });

    if (this.step1Panel) this.step1Panel.hidden = stepNum !== 1;
    if (this.step2Panel) this.step2Panel.hidden = stepNum !== 2;
    if (this.step3Panel) this.step3Panel.hidden = stepNum !== 3;
  }

  resetWizard() {
    this.uploadedImages = [];
    this.renderThumbnails();
    if (this.nameInputEl) this.nameInputEl.value = '';
    if (this.notesInputEl) this.notesInputEl.value = '';
    if (this.baseScadInputEl) this.baseScadInputEl.value = '';
    if (this.scadFileInputEl) this.scadFileInputEl.value = '';
    this.goToStep(1);
  }

  slugify(text = '') {
    return (
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || `pcb-${Date.now()}`
    );
  }
}
