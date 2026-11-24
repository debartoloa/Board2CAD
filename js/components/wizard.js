/**
 * Board2CAD — 3-Step AI Vision & Parametric CAD Wizard (js/components/wizard.js)
 * Step 1: Upload board photos + name + notes (or existing .SCAD code)
 * Step 2: Authentic AI Vision Inspection & Dynamic Clarification Form (Clarification First)
 * Step 3: OpenSCAD 100% Manifold Code Generation + Compiler Validation + Auto-Fix Loop + STL & 3MF
 *
 * Includes explicit UI status banners (Loading / Persistent Error / Success) and full try/catch/finally guarantees.
 */

import { aiService, AI_PROVIDERS_CONFIG } from '../services/aiService.js';
import { storageService } from '../services/storageService.js';

export class WizardComponent {
  constructor({
    compileScadWithWorker,
    onModelGenerated,
    onPrepareDraftFromPrompt,
    onOpenSettings,
    showToast
  }) {
    this.compileScadWithWorker = compileScadWithWorker;
    this.onModelGenerated = onModelGenerated;
    this.onPrepareDraftFromPrompt = onPrepareDraftFromPrompt;
    this.onOpenSettings = onOpenSettings;
    this.showToast = showToast;

    this.uploadedImages = [];
    this.currentAnalysis = null;
    this.generatedModelData = null;
    this.activeStep = 1;
    this.lastStep3DirectMode = false;
    this.lastClarifiedParameters = null;

    // Elementi DOM Step 1..3
    this.stepperItems = document.querySelectorAll('.wizard-stepper .step-item');
    this.step1Panel = document.getElementById('wizard-step-1');
    this.step2Panel = document.getElementById('wizard-step-2');
    this.step3Panel = document.getElementById('wizard-step-3');

    this.statusBanners = {
      1: document.getElementById('wizard-status-step1'),
      2: document.getElementById('wizard-status-step2'),
      3: document.getElementById('wizard-status-step3')
    };

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

    this.analyzeBtn = document.getElementById('wizard-analyze-btn');
    this.generateScadBtn = document.getElementById('wizard-generate-scad-btn');
    this.directCompileBtn = document.getElementById('wizard-direct-compile-scad-btn');
    this.retryStep3Btn = document.getElementById('wizard-retry-step3-btn');
    this.openStudioBtn = document.getElementById('wizard-open-studio-btn');

    this.defaultBtnLabels = {
      analyze: this.analyzeBtn?.querySelector('span')?.textContent || 'Analizza & Verifica Quote / Modifiche (Step 2)',
      generate: this.generateScadBtn?.querySelector('span')?.textContent || 'Genera OpenSCAD + Compila STL & 3MF (Step 3)',
      direct: this.directCompileBtn?.querySelector('span')?.textContent || 'Compila Direttamente il mio .SCAD così com\'è (Vai a Step 3)',
      retryStep3: this.retryStep3Btn?.querySelector('span')?.textContent || '🔄 Riprova Generazione'
    };

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

    if (this.analyzeBtn) {
      this.analyzeBtn.addEventListener('click', () => this.runStep2Analysis());
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
    if (this.directCompileBtn) {
      this.directCompileBtn.addEventListener('click', () => {
        const existingScad = (this.baseScadInputEl?.value || '').trim();
        if (!existingScad) {
          this.setWizardStatus(
            'error',
            'Incolla o carica prima un codice .SCAD nella casella "Codice .SCAD di partenza".',
            { hidePromptFallback: true }
          );
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
      backStep1Btn.addEventListener('click', () => {
        this.setWizardStatus('idle');
        this.goToStep(1);
      });
    }

    if (this.generateScadBtn) {
      this.generateScadBtn.addEventListener('click', () => this.runStep3Generation(false));
    }

    const backStep2Btn = document.getElementById('wizard-back-step2-btn');
    if (backStep2Btn) {
      backStep2Btn.addEventListener('click', () => {
        this.setWizardStatus('idle');
        this.goToStep(2);
      });
    }

    if (this.retryStep3Btn) {
      this.retryStep3Btn.addEventListener('click', () => {
        this.runStep3Generation(this.lastStep3DirectMode);
      });
    }

    if (this.openStudioBtn) {
      this.openStudioBtn.addEventListener('click', () => {
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
   * Aggiorna il banner visivo persistente dello step corrente ('idle' | 'loading' | 'error' | 'success')
   */
  setWizardStatus(state, message = '', options = {}) {
    if (state === 'idle') {
      Object.values(this.statusBanners).forEach((el) => {
        if (!el) return;
        el.hidden = true;
        el.className = 'wizard-status-banner';
        el.innerHTML = '';
      });
      return;
    }

    const targetStep = options.step || this.activeStep || 1;
    // Nasconde eventuali banner sugli altri step
    Object.entries(this.statusBanners).forEach(([stepKey, el]) => {
      if (!el) return;
      if (Number(stepKey) !== targetStep) {
        el.hidden = true;
      }
    });

    const banner = this.statusBanners[targetStep];
    if (!banner) return;

    banner.hidden = false;
    banner.className = `wizard-status-banner is-${state}`;

    const safeMsg = this.escapeHtml(message);
    const safeDetail = options.detail ? this.escapeHtml(options.detail) : '';

    if (state === 'loading') {
      banner.innerHTML = `
        <div class="wizard-spinner" aria-hidden="true"></div>
        <div class="status-banner-body">
          <strong>${safeMsg}</strong>
          ${safeDetail ? `<p class="status-banner-detail">${safeDetail}</p>` : ''}
        </div>
      `;
    } else if (state === 'error') {
      const showPromptHelp = !options.hidePromptFallback;
      const retryActionHtml =
        targetStep === 3
          ? `<button type="button" class="btn btn-primary btn-xs" data-banner-action="retry-step3">🔄 Riprova Generazione</button>`
          : '';
      banner.innerHTML = `
        <div class="status-banner-body">
          <strong>❌ ${safeMsg}</strong>
          ${
            showPromptHelp
              ? `<p class="status-banner-detail">Suggerimento: verifica chiave/modello in <strong>Config</strong> (Gemini, OpenRouter Free o Groq) oppure usa subito <strong>"Copia Prompt per Chat AI"</strong> senza API Key.</p>
                 <div class="status-banner-actions">
                   ${retryActionHtml}
                   <button type="button" class="btn btn-secondary btn-xs" data-banner-action="copy-prompt">📋 Copia Prompt per Chat AI</button>
                   <button type="button" class="btn btn-outline btn-xs" data-banner-action="open-config">⚙️ Apri Config API</button>
                 </div>`
              : ''
          }
        </div>
      `;

      banner.querySelector('[data-banner-action="retry-step3"]')?.addEventListener('click', () => {
        this.runStep3Generation(this.lastStep3DirectMode);
      });
      banner.querySelector('[data-banner-action="copy-prompt"]')?.addEventListener('click', () => {
        this.copyPromptForExternalAI();
      });
      banner.querySelector('[data-banner-action="open-config"]')?.addEventListener('click', () => {
        if (this.onOpenSettings) this.onOpenSettings();
      });
    } else if (state === 'success') {
      banner.innerHTML = `
        <div class="status-banner-body">
          <strong>✅ ${safeMsg}</strong>
          ${safeDetail ? `<p class="status-banner-detail">${safeDetail}</p>` : ''}
        </div>
      `;
    }

    try {
      banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch {
      // Ignore on environments without scrollIntoView
    }
  }

  /**
   * Disabilita/riabilita i pulsanti principali di generazione mostrando un testo chiaro in corso d'opera
   */
  setWizardBusy(isBusy, activeBtn = null, busyLabel = '') {
    const buttons = [
      { el: this.analyzeBtn, def: this.defaultBtnLabels.analyze },
      { el: this.generateScadBtn, def: this.defaultBtnLabels.generate },
      { el: this.directCompileBtn, def: this.defaultBtnLabels.direct },
      { el: this.retryStep3Btn, def: this.defaultBtnLabels.retryStep3 }
    ];

    for (const item of buttons) {
      if (!item.el) continue;
      item.el.disabled = Boolean(isBusy);
      const span = item.el.querySelector('span');
      if (span) {
        if (isBusy && item.el === activeBtn && busyLabel) {
          span.textContent = busyLabel;
        } else if (!isBusy) {
          span.textContent = item.def;
        }
      }
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
    if (this.fileInputEl) this.fileInputEl.value = '';
  }

  renderThumbnails() {
    if (!this.thumbsContainerEl) return;
    this.thumbsContainerEl.innerHTML = this.uploadedImages
      .map(
        (img, idx) => `
        <div class="thumb-item" title="${this.escapeHtml(img.name)} (${img.width || '--'}×${img.height || '--'} px · ${img.sizeKb || '--'} KB JPEG)">
          <img src="${img.dataUrl}" alt="${this.escapeHtml(img.name)}">
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

    if (copied) {
      this.setWizardStatus(
        'success',
        'Prompt copiato negli appunti!',
        {
          detail: 'Incollalo nella tua chat AI insieme alle foto della scheda, poi incolla il codice .SCAD ricevuto in Studio 3D → Editor .SCAD.'
        }
      );
      if (this.showToast) {
        this.showToast(
          'Prompt copiato! Incollalo nella tua chat AI insieme alle foto, poi riporta qui il codice .SCAD nello Studio 3D',
          'success'
        );
      }
    } else if (this.showToast) {
      this.showToast(
        'Copia automatica bloccata dal browser: consenti l\'accesso agli appunti o usa HTTPS.',
        'warning'
      );
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
   * Step 2: Esegue l'analisi AI Vision ("Clarification First") con stato UI esplicito e try/catch/finally
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
    const settings = storageService.getSettings();
    const providerCfg = AI_PROVIDERS_CONFIG[settings.aiProvider] || AI_PROVIDERS_CONFIG.gemini;
    const activeModel = settings.aiModel || providerCfg.defaultModel;

    this.setWizardBusy(true, this.analyzeBtn, '⏳ Invio immagini all\'AI...');
    this.setWizardStatus('loading', '⏳ Invio immagini all\'AI in corso...', {
      step: 1,
      detail: `Provider: ${providerCfg.label} · Modello: ${activeModel} · Foto allegate: ${this.uploadedImages.length}`
    });

    try {
      const analysis = await aiService.analyzeBoardImages({
        name,
        category,
        preset,
        notes,
        images: this.uploadedImages,
        existingScad,
        onStatus: (statusMsg) => {
          this.setWizardStatus('loading', statusMsg, {
            step: 1,
            detail: 'Gestione automatica retry e fallback modelli in corso...'
          });
        }
      });

      this.currentAnalysis = analysis;

      if (
        analysis.boardIdentified &&
        this.nameInputEl &&
        (this.nameInputEl.value === 'Nuova Scheda PCB' || !this.nameInputEl.value.trim())
      ) {
        this.nameInputEl.value = analysis.boardIdentified;
      }

      this.renderClarificationForm(analysis);
      this.goToStep(2);

      if (analysis.hasExistingScad) {
        this.setWizardStatus('success', 'Quote estratte dal tuo codice .SCAD!', {
          step: 2,
          detail: 'Verifica o modifica i parametri qui sotto e premi "Genera OpenSCAD + Compila STL & 3MF".'
        });
      } else {
        this.setWizardStatus('success', `Analisi AI completata (${this.uploadedImages.length} foto elaborate)!`, {
          step: 2,
          detail: 'Conferma o correggi le misure rilevate, poi premi "Genera OpenSCAD + Compila STL & 3MF".'
        });
      }
    } catch (err) {
      const msg = err?.message || String(err);
      this.setWizardStatus('error', msg, { step: 1 });
      if (this.showToast) {
        this.showToast(msg, 'error');
      }
    } finally {
      this.setWizardBusy(false, this.analyzeBtn);
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
          <label for="clarify-${this.escapeHtml(q.id)}">${this.escapeHtml(q.label)} (${this.escapeHtml(q.unit || 'mm')})</label>
          <input
            type="${this.escapeHtml(q.type || 'number')}"
            id="clarify-${this.escapeHtml(q.id)}"
            name="${this.escapeHtml(q.id)}"
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
   * Completamente protetto da try/catch/finally con feedback visivo persistente.
   */
  async runStep3Generation(directCompileExistingScad = false) {
    this.lastStep3DirectMode = Boolean(directCompileExistingScad);
    this.generatedModelData = null;
    if (this.openStudioBtn) this.openStudioBtn.hidden = true;

    this.goToStep(3);
    if (this.step3ActionsEl) this.step3ActionsEl.hidden = true;
    if (this.pipelineLogEl) this.pipelineLogEl.innerHTML = '';

    const activeTriggerBtn = directCompileExistingScad ? this.directCompileBtn : this.generateScadBtn;
    this.setWizardBusy(true, activeTriggerBtn, '⏳ Elaborazione in corso...');

    const handleCascadeStatus = (statusMsg) => {
      this.appendLog(statusMsg, 'warn');
      this.setWizardStatus('loading', statusMsg, { step: 3 });
    };

    try {
      const name = (this.nameInputEl?.value || 'Scheda Custom 3D').trim() || 'Scheda Custom 3D';
      const category = this.categorySelectEl?.value || 'MCU Development Board';
      const preset = this.presetSelectEl?.value || 'auto';
      const notes = (this.notesInputEl?.value || '').trim();
      const existingScad = (this.baseScadInputEl?.value || '').trim();
      const settings = storageService.getSettings();
      const providerCfg = AI_PROVIDERS_CONFIG[settings.aiProvider] || AI_PROVIDERS_CONFIG.gemini;
      const activeModel = settings.aiModel || providerCfg.defaultModel;

      let parameters;
      if (directCompileExistingScad) {
        parameters = aiService.extractDimensionsFromNotesAndScad(notes, existingScad);
      } else {
        const collected = this.collectClarifiedParameters();
        if (Object.keys(collected).length > 0) {
          this.lastClarifiedParameters = collected;
          parameters = collected;
        } else {
          parameters = this.lastClarifiedParameters || aiService.extractDimensionsFromNotesAndScad(notes, existingScad);
        }
      }

      const slug = this.slugify(name);
      const hasStep2Blueprint = Boolean(
        !directCompileExistingScad &&
          this.currentAnalysis &&
          ((Array.isArray(this.currentAnalysis.detectedComponents) && this.currentAnalysis.detectedComponents.length > 0) ||
            (this.currentAnalysis.summary && this.currentAnalysis.summary.trim().length > 10))
      );

      this.appendLog(`Avvio generazione OpenSCAD 100% Manifold per "${name}" (${slug})...`, 'info');
      if (!directCompileExistingScad && hasStep2Blueprint) {
        this.appendLog(
          'Payload Step 3 leggero attivo: solo testo strutturato + quote confermate dallo Step 2 (0 immagini riallegate) per massima velocità e zero timeout.',
          'info'
        );
      } else if (!directCompileExistingScad && this.uploadedImages.length > 0) {
        this.appendLog(
          'Payload Step 3 ottimizzato: max 1 immagine ridimensionata (768px JPEG) + quote confermate.',
          'info'
        );
      }

      let scadCode = '';
      if (directCompileExistingScad && existingScad) {
        this.setWizardStatus('loading', '⚙️ Preparazione script .SCAD utente in corso...', { step: 3 });
        this.appendLog('Modalità Compilazione Diretta: utilizzo il codice .SCAD fornito dall\'utente...', 'info');
        const cleanedSeed = aiService.extractCleanScadCode(existingScad);
        scadCode = notes
          ? aiService.applyModificationsToExistingScad(cleanedSeed, parameters, notes, name)
          : cleanedSeed;
      } else {
        this.setWizardStatus(
          'loading',
          hasStep2Blueprint
            ? '⏳ Generazione OpenSCAD dal blueprint Step 2...'
            : '⏳ Invio richiesta all\'AI in corso...',
          {
            step: 3,
            detail: `Provider: ${providerCfg.label} · Modello: ${activeModel}`
          }
        );
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
          analysisContext: this.currentAnalysis,
          onStatus: handleCascadeStatus
        });
      }

      this.appendLog('Script OpenSCAD generato con successo. Avvio compilazione nel Web Worker...', 'ok');

      // Compilazione + Loop di Auto-Fix (max 2 tentativi solo in caso di vero errore del compilatore)
      let compileResult = null;
      const maxAttempts = 2;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        this.setWizardStatus('loading', '⚙️ Compilazione STL e 3MF nel browser...', {
          step: 3,
          detail: `Tentativo ${attempt}/${maxAttempts} nel Web Worker OpenSCAD AST CSG`
        });
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
          this.setWizardStatus('loading', '🔧 Auto-Fix OpenSCAD con AI in corso...', {
            step: 3,
            detail: issueMsg
          });
          scadCode = await aiService.autoFixManifoldScript(
            scadCode,
            issueMsg,
            parameters,
            name,
            [],
            handleCascadeStatus
          );
        }
      }

      if (!compileResult || !compileResult.ok) {
        throw new Error(
          compileResult?.error ||
            'Il compilatore OpenSCAD non è riuscito a generare la mesh dopo 2 tentativi. Apri Studio 3D o usa "Copia Prompt per Chat AI".'
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
      if (this.openStudioBtn) this.openStudioBtn.hidden = false;

      this.appendLog(
        `File generati: model.scad, model.stl (${Math.round((compileResult.stlBuffer?.byteLength || 0) / 1024)} KB), model.3mf (${Math.round((compileResult.threemfBuffer?.byteLength || 0) / 1024)} KB), meta.json.`,
        'ok'
      );

      this.setWizardStatus('success', 'Modello 3D generato e compilato! Apertura Studio 3D...', {
        step: 3,
        detail: `${compileResult.metrics.triangles} triangoli · ${dims.length} × ${dims.width} × ${dims.height} mm`
      });

      this.appendLog('Modello salvato automaticamente in IndexedDB locale. Passaggio allo Studio 3D...', 'ok');

      if (this.onModelGenerated) {
        await this.onModelGenerated(this.generatedModelData, true);
      }
    } catch (err) {
      const errMsg = err?.message || String(err);
      this.appendLog(`ERRORE: ${errMsg}`, 'error');
      this.setWizardStatus('error', errMsg, { step: 3 });
      if (this.showToast) {
        this.showToast(errMsg, 'error');
      }
    } finally {
      this.setWizardBusy(false, activeTriggerBtn);
      if (this.step3ActionsEl) this.step3ActionsEl.hidden = false;
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
    this.activeStep = stepNum;
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
    this.generatedModelData = null;
    this.lastStep3DirectMode = false;
    this.lastClarifiedParameters = null;
    if (this.openStudioBtn) this.openStudioBtn.hidden = true;
    this.renderThumbnails();
    if (this.nameInputEl) this.nameInputEl.value = '';
    if (this.notesInputEl) this.notesInputEl.value = '';
    if (this.baseScadInputEl) this.baseScadInputEl.value = '';
    if (this.scadFileInputEl) this.scadFileInputEl.value = '';
    this.setWizardStatus('idle');
    this.goToStep(1);
  }

  escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
