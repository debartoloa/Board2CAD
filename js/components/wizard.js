/**
 * Board2CAD — 3-Step AI Vision & Parametric CAD Wizard (js/components/wizard.js)
 * Step 1: Upload board photos + name + notes (or existing .SCAD code)
 * Step 2: Authentic AI Vision Inspection & Dynamic Clarification Form (Clarification First)
 * Step 3: OpenSCAD 100% Manifold Code Generation + Compiler Validation + Auto-Fix Loop + STL & 3MF
 */

import { aiService } from '../services/aiService.js';

export class WizardComponent {
  constructor({ compileScadWithWorker, onModelGenerated, onPrepareDraftFromPrompt, showToast }) {
    this.compileScadWithWorker = compileScadWithWorker;
    this.onModelGenerated = onModelGenerated;
    this.onPrepareDraftFromPrompt = onPrepareDraftFromPrompt;
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

    // Pulsante "Copia Prompt per Chat AI (Zero-API)" in Step 1, Step 2 e Step 3
    const copyPromptBtn = document.getElementById('wizard-copy-prompt-btn');
    if (copyPromptBtn) {
      copyPromptBtn.addEventListener('click', () => this.copyPromptForExternalAI());
    }
    document.querySelectorAll('.js-copy-ai-prompt-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.copyPromptForExternalAI());
    });

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
      generateScadBtn.addEventListener('click', () => this.runStep3Generation(false));
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
   * Ridimensiona lato client tramite <canvas> (lato lungo <= 1024 px, JPEG 0.85)
   * per abbattere il peso del payload API mantenendo perfettamente leggibili quote e pin.
   */
  async handleFiles(files) {
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const optimized = await aiService.optimizeImageToJpegDataUrl(file, 1024, 0.85);
        this.uploadedImages.push({
          name: file.name,
          mimeType: optimized.mimeType,
          width: optimized.width,
          height: optimized.height,
          sizeKb: optimized.sizeKb,
          dataUrl: optimized.dataUrl,
          resized: true
        });
      } catch (err) {
        if (this.showToast) {
          this.showToast(`Errore ottimizzazione immagine "${file.name}": ${err.message}`, 'warning');
        }
      }
    }
    this.renderThumbnails();
    // Reset input value so re-selecting the same image works
    if (this.fileInputEl) this.fileInputEl.value = '';
  }

  renderThumbnails() {
    if (!this.thumbsContainerEl) return;
    this.thumbsContainerEl.innerHTML = this.uploadedImages
      .map(
        (img, idx) => `
        <div class="thumb-item" title="${img.name} (${img.width || '--'}×${img.height || '--'} px · ${img.sizeKb || '--'} KB JPEG)">
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
   * Compone in modo sincrono il prompt completo per chat AI esterne e lo copia negli appunti (Zero-API Fallback).
   */
  async copyPromptForExternalAI() {
    const name = (this.nameInputEl?.value || '').trim();
    const category = this.categorySelectEl?.value || 'Custom PCB';
    const presetOpt = this.presetSelectEl?.selectedOptions?.[0];
    const presetLabel = presetOpt ? presetOpt.textContent.trim() : 'Rilevamento Automatico';
    const notes = (this.notesInputEl?.value || '').trim();
    const existingScad = (this.baseScadInputEl?.value || '').trim();

    const step2Inputs = this.clarificationFormEl ? this.clarificationFormEl.querySelectorAll('input') : [];
    const parameters = step2Inputs.length > 0 ? this.collectClarifiedParameters() : null;

    const promptText = aiService.buildExternalChatPrompt({
      name,
      category,
      presetLabel,
      notes,
      existingScad,
      parameters,
      imageCount: this.uploadedImages.length
    });

    // Invoca navigator.clipboard.writeText sincronamente prima di qualsiasi await per preservare la user gesture su iOS Safari
    let copied = false;
    const clipboardPromise =
      navigator.clipboard && window.isSecureContext
        ? navigator.clipboard.writeText(promptText)
        : null;

    if (clipboardPromise) {
      try {
        await clipboardPromise;
        copied = true;
      } catch {
        copied = this.fallbackExecCommandCopy(promptText);
      }
    } else {
      copied = this.fallbackExecCommandCopy(promptText);
    }

    if (this.onPrepareDraftFromPrompt && (name || notes || existingScad || this.uploadedImages.length > 0)) {
      this.onPrepareDraftFromPrompt({
        name: name || 'Nuova Scheda da Chat AI',
        category,
        notes,
        previewDataUrl: this.uploadedImages[0]?.dataUrl || './icon-512.png'
      });
    }

    if (this.showToast) {
      if (copied) {
        this.showToast(
          'Prompt copiato! Incollalo nella tua chat AI insieme alle foto, poi riporta qui il codice .SCAD nello Studio 3D',
          'success'
        );
      } else {
        this.showToast(
          'Copia automatica bloccata dal browser: consenti l\'accesso agli appunti o usa HTTPS.',
          'warning'
        );
      }
    }
  }

  /**
   * Fallback di copia negli appunti per browser mobile/HTTP locale (iOS Safari / Android WebView)
   */
  fallbackExecCommandCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0';
      ta.style.fontSize = '16px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      ta.remove();
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  /**
   * Step 2: Esegue l'analisi AI Vision ("Clarification First") allegando le immagini in Base64
   */
  async runStep2Analysis() {
    const name = (this.nameInputEl?.value || '').trim() || 'Nuova Scheda PCB';
    if (this.nameInputEl && !this.nameInputEl.value) {
      this.nameInputEl.value = name;
    }

    const category = this.categorySelectEl?.value || 'MCU Development Board';
    const preset = this.presetSelectEl?.value || 'auto';
    const notes = (this.notesInputEl?.value || '').trim();
    const existingScad = (this.baseScadInputEl?.value || '').trim();

    const analyzeBtn = document.getElementById('wizard-analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.disabled = true;
      analyzeBtn.querySelector('span').textContent = `Analisi AI Vision in corso (${this.uploadedImages.length} foto)...`;
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

      // Se l'AI ha identificato il nome preciso della scheda dalla foto e l'utente aveva lasciato un nome generico, aggiorniamolo
      if (
        analysis.boardIdentified &&
        this.nameInputEl &&
        (this.nameInputEl.value === 'Nuova Scheda PCB' || !this.nameInputEl.value.trim())
      ) {
        this.nameInputEl.value = analysis.boardIdentified;
      }

      this.renderClarificationForm(analysis);
      this.goToStep(2);

      if (analysis.hasExistingScad && this.showToast) {
        this.showToast('Quote estratte dal tuo codice .SCAD! Verifica i valori e procedi allo Step 3.', 'success');
      } else if (this.showToast) {
        this.showToast(
          `Analisi AI Vision completata (${this.uploadedImages.length} immagini Base64 inviate). Verifica le quote lette dalla foto!`,
          'success'
        );
      }
    } catch (err) {
      if (this.showToast) {
        this.showToast(err.message, 'error');
      }
    } finally {
      if (analyzeBtn) {
        analyzeBtn.disabled = false;
        analyzeBtn.querySelector('span').textContent = 'Analizza & Verifica Quote / Modifiche (Step 2)';
      }
    }
  }

  /**
   * Genera dinamicamente il form HTML con le quote lette dalla foto e i componenti reali rilevati
   */
  renderClarificationForm(analysis) {
    if (this.analysisSummaryEl) {
      const compList = Array.isArray(analysis.detectedComponents) && analysis.detectedComponents.length > 0
        ? ` — Componenti rilevati nella foto: ${analysis.detectedComponents.join(' · ')}`
        : '';
      this.analysisSummaryEl.textContent = `${analysis.summary || 'Conferma le misure critiche lette dalla foto.'}${compList}`;
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
            value="${q.suggestedValue ?? ''}"
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
   * Step 3: Generazione/Modifica script OpenSCAD autentico, Compilazione Web Worker e Auto-Fix Loop (max 2 tentativi).
   * NESSUN FALLBACK MOCK: non sovrascrive mai lo script con template ESP32/Freenove!
   */
  async runStep3Generation(directCompileExistingScad = false) {
    this.goToStep(3);
    if (this.step3ActionsEl) this.step3ActionsEl.hidden = true;
    if (this.pipelineLogEl) this.pipelineLogEl.innerHTML = '';

    const name = (this.nameInputEl?.value || 'Scheda Custom 3D').trim() || 'Scheda Custom 3D';
    const category = this.categorySelectEl?.value || 'MCU Development Board';
    const preset = this.presetSelectEl?.value || 'auto';
    const notes = (this.notesInputEl?.value || '').trim();
    const existingScad = (this.baseScadInputEl?.value || '').trim();
    const parameters = directCompileExistingScad
      ? aiService.extractDimensionsFromNotesAndScad(notes, existingScad)
      : this.collectClarifiedParameters();

    const slug = this.slugify(name);

    this.appendLog(`Avvio generazione OpenSCAD 100% Manifold per "${name}" (${slug})...`, 'info');
    if (this.uploadedImages.length > 0) {
      const totalKb = this.uploadedImages.reduce((acc, img) => acc + (img.sizeKb || 0), 0);
      this.appendLog(
        `Payload multimodale attivo: ${this.uploadedImages.length} immagini Base64 allegate (${totalKb} KB).`,
        'info'
      );
    }

    try {
      let scadCode = '';
      if (directCompileExistingScad && existingScad) {
        this.appendLog('Modalità Compilazione Diretta: utilizzo il codice .SCAD fornito dall\'utente...', 'info');
        const cleanedSeed = aiService.extractCleanScadCode(existingScad);
        scadCode = notes
          ? aiService.applyModificationsToExistingScad(cleanedSeed, parameters, notes, name)
          : cleanedSeed;
      } else {
        this.appendLog(
          `Quote confermate: PCB ${parameters.pcb_length} × ${parameters.pcb_width} × ${parameters.pcb_thickness || 1.6} mm.`,
          'info'
        );
        if (this.currentAnalysis?.detectedComponents?.length) {
          this.appendLog(
            `Modellazione componenti rilevati: ${this.currentAnalysis.detectedComponents.slice(0, 6).join(', ')}...`,
            'info'
          );
        }

        scadCode = await aiService.generateOpenSCAD({
          name,
          category,
          preset,
          notes,
          parameters,
          images: this.uploadedImages,
          existingScad,
          analysisContext: this.currentAnalysis
        });
      }

      this.appendLog('Script OpenSCAD generato con successo. Avvio compilazione nel Web Worker...', 'ok');

      // Compilazione + Loop di Auto-Fix (max 2 tentativi solo in caso di vero errore del compilatore)
      let compileResult = null;
      const maxAttempts = 2;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        this.appendLog(`[Tentativo ${attempt}/${maxAttempts}] Compilazione OpenSCAD -> model.stl & model.3mf...`, 'info');
        compileResult = await this.compileScadWithWorker(scadCode);

        if (compileResult.ok) {
          this.appendLog(
            `Compilazione completata in ${compileResult.metrics.elapsedMs} ms: ${compileResult.metrics.triangles} triangoli, ingombro ${compileResult.metrics.dimensions.length} × ${compileResult.metrics.dimensions.width} × ${compileResult.metrics.dimensions.height} mm.`,
            'ok'
          );
          break;
        }

        const issueMsg = compileResult.error || 'Errore di sintassi o geometria OpenSCAD';
        this.appendLog(`Errore segnalato dal compilatore: ${issueMsg}. Avvio Auto-Fix AI...`, 'warn');

        if (attempt < maxAttempts) {
          scadCode = await aiService.autoFixManifoldScript(
            scadCode,
            issueMsg,
            parameters,
            name,
            this.uploadedImages
          );
        }
      }

      if (!compileResult || !compileResult.ok) {
        throw new Error(
          compileResult?.error ||
            'Il compilatore OpenSCAD non è riuscito a generare la mesh dopo 2 tentativi. Puoi aprire lo Studio 3D per ispezionare e modificare lo script.'
        );
      }

      const dims = compileResult.metrics?.dimensions || {
        length: parameters.pcb_length || 68.6,
        width: parameters.pcb_width || 53.4,
        height: 12.0
      };

      const meta = {
        slug,
        name,
        category,
        description:
          this.currentAnalysis?.summary ||
          notes ||
          `Modello parametrico 3D ${name} (${dims.length}x${dims.width}x${dims.height} mm) generato con Board2CAD.`,
        hardwareNotes: (this.currentAnalysis?.detectedComponents || []).join(' | '),
        dimensions: dims,
        mountingHoles: {
          diameter: parameters.hole_diameter || 3.2,
          pitchX: parameters.hole_pitch_x || Number((dims.length - 6).toFixed(1)),
          pitchY: parameters.hole_pitch_y || Number((dims.width - 6).toFixed(1))
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
        previewDataUrl: this.uploadedImages[0]?.dataUrl || './icon-512.png'
      };

      this.appendLog(
        `File generati: model.scad, model.stl (${Math.round((compileResult.stlBuffer?.byteLength || 0) / 1024)} KB), model.3mf (${Math.round((compileResult.threemfBuffer?.byteLength || 0) / 1024)} KB), meta.json.`,
        'ok'
      );

      if (this.onModelGenerated) {
        await this.onModelGenerated(this.generatedModelData, false);
      }

      this.appendLog('Modello salvato automaticamente in IndexedDB locale e pronto nello Studio 3D!', 'ok');
      if (this.step3ActionsEl) this.step3ActionsEl.hidden = false;
    } catch (err) {
      this.appendLog(`ERRORE: ${err.message}`, 'warn');
      if (this.step3ActionsEl) this.step3ActionsEl.hidden = false;
      if (this.showToast) {
        this.showToast(err.message, 'error');
      }
    }
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
    this.currentAnalysis = null;
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
