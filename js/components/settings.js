/**
 * Board2CAD — Settings Modal Component (js/components/settings.js)
 * Manages AI Vision Provider (Gemini / OpenRouter / Groq), API Keys, Models, and GitHub PAT/Repo in localStorage.
 */

import { storageService } from '../services/storageService.js';
import { AI_PROVIDERS_CONFIG } from '../services/aiService.js';

export class SettingsComponent {
  constructor({ modalEl, formEl, onSettingsSaved, onClearLocalDb, showToast }) {
    this.modalEl = modalEl;
    this.formEl = formEl;
    this.onSettingsSaved = onSettingsSaved;
    this.onClearLocalDb = onClearLocalDb;
    this.showToast = showToast;

    this.providerInput = document.getElementById('setting-ai-provider');
    this.modelInput = document.getElementById('setting-ai-model');
    this.modelDatalist = document.getElementById('setting-ai-model-datalist');
    this.modelChipsEl = document.getElementById('setting-model-chips');
    this.keyInput = document.getElementById('setting-ai-key');
    this.keyLabel = document.getElementById('setting-ai-key-label');
    this.keysSummaryEl = document.getElementById('setting-keys-summary');

    this.ghOwnerInput = document.getElementById('setting-gh-owner');
    this.ghRepoInput = document.getElementById('setting-gh-repo');
    this.ghBranchInput = document.getElementById('setting-gh-branch');
    this.ghTokenInput = document.getElementById('setting-gh-token');

    this.activeProvider = 'gemini';
    this.profiles = {};

    this.bindEvents();
  }

  bindEvents() {
    const closeBtn = document.getElementById('close-settings-btn');
    const cancelBtn = document.getElementById('cancel-settings-btn');
    const clearDbBtn = document.getElementById('clear-local-db-btn');

    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.close());

    if (this.modalEl) {
      this.modalEl.addEventListener('click', (e) => {
        if (e.target === this.modalEl) this.close();
      });
    }

    if (this.providerInput) {
      const handleProviderChange = () => {
        // Salva bozza del provider precedente prima di cambiare scheda
        this.profiles[this.activeProvider] = {
          model: (this.modelInput?.value || '').trim() || AI_PROVIDERS_CONFIG[this.activeProvider].defaultModel,
          apiKey: (this.keyInput?.value || '').trim()
        };

        const nextProvider = AI_PROVIDERS_CONFIG[this.providerInput.value]
          ? this.providerInput.value
          : 'gemini';
        this.activeProvider = nextProvider;
        this.applyProviderFields(nextProvider);
      };
      this.providerInput.addEventListener('change', handleProviderChange);
      this.providerInput.addEventListener('input', handleProviderChange);
    }

    if (this.keyInput) {
      this.keyInput.addEventListener('input', () => {
        if (!this.profiles[this.activeProvider]) {
          this.profiles[this.activeProvider] = {};
        }
        this.profiles[this.activeProvider].apiKey = this.keyInput.value.trim();
        this.renderKeysSummary();
      });
    }

    if (this.modelInput) {
      this.modelInput.addEventListener('input', () => {
        this.highlightActiveChip();
      });
    }

    if (this.formEl) {
      this.formEl.addEventListener('submit', (e) => {
        e.preventDefault();
        this.save();
      });
    }

    if (clearDbBtn) {
      clearDbBtn.addEventListener('click', async () => {
        if (this.onClearLocalDb) {
          await this.onClearLocalDb();
        }
      });
    }
  }

  open() {
    const s = storageService.getSettings();
    const provider = AI_PROVIDERS_CONFIG[s.aiProvider] ? s.aiProvider : 'gemini';
    this.activeProvider = provider;

    this.profiles = {
      gemini: { ...(s.providerProfiles?.gemini || {}) },
      openrouter: { ...(s.providerProfiles?.openrouter || {}) },
      groq: { ...(s.providerProfiles?.groq || {}) }
    };

    // Sincronizza i campi correnti top-level nel profilo attivo se valorizzati
    if (s.aiModel) this.profiles[provider].model = s.aiModel;
    if (s.aiApiKey) this.profiles[provider].apiKey = s.aiApiKey;

    if (this.providerInput) this.providerInput.value = provider;
    this.applyProviderFields(provider);

    if (this.ghOwnerInput) this.ghOwnerInput.value = s.ghOwner || 'debartoloa';
    if (this.ghRepoInput) this.ghRepoInput.value = s.ghRepo || 'Board2CAD';
    if (this.ghBranchInput) this.ghBranchInput.value = s.ghBranch || 'main';
    if (this.ghTokenInput) this.ghTokenInput.value = s.ghToken || '';

    if (this.modalEl) {
      this.modalEl.hidden = false;
    }
  }

  applyProviderFields(provider) {
    const cfg = AI_PROVIDERS_CONFIG[provider] || AI_PROVIDERS_CONFIG.gemini;
    const profile = this.profiles[provider] || {};

    if (this.modelInput) {
      this.modelInput.value = profile.model || cfg.defaultModel;
      this.modelInput.placeholder = cfg.defaultModel;
    }
    if (this.keyInput) {
      this.keyInput.value = profile.apiKey || '';
      this.keyInput.placeholder = cfg.keyPlaceholder;
    }
    if (this.keyLabel) {
      this.keyLabel.textContent = `API Key — ${cfg.label}`;
    }

    this.renderRecommendedModels(cfg);
    this.renderKeysSummary();
  }

  renderKeysSummary() {
    if (!this.keysSummaryEl) return;
    const parts = Object.entries(AI_PROVIDERS_CONFIG).map(([id, cfg]) => {
      const hasKey = Boolean((this.profiles[id]?.apiKey || '').trim());
      const shortName = id === 'gemini' ? 'Gemini' : id === 'openrouter' ? 'OpenRouter' : 'Groq';
      return `${hasKey ? '✓' : '○'} ${shortName}`;
    });
    this.keysSummaryEl.textContent = `Chiavi salvate per provider: ${parts.join('  ·  ')}`;
  }

  renderRecommendedModels(cfg) {
    if (this.modelDatalist) {
      this.modelDatalist.innerHTML = cfg.recommendedModels
        .map((m) => `<option value="${m}"></option>`)
        .join('');
    }

    if (this.modelChipsEl) {
      const currentVal = (this.modelInput?.value || '').trim();
      this.modelChipsEl.innerHTML = cfg.recommendedModels
        .map(
          (m) => `
          <button type="button" class="model-chip ${currentVal === m ? 'active' : ''}" data-model="${m}">
            ${m}
          </button>
        `
        )
        .join('');

      this.modelChipsEl.querySelectorAll('.model-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          if (this.modelInput) {
            this.modelInput.value = chip.dataset.model;
          }
          this.highlightActiveChip();
        });
      });
    }
  }

  highlightActiveChip() {
    if (!this.modelChipsEl || !this.modelInput) return;
    const val = this.modelInput.value.trim();
    this.modelChipsEl.querySelectorAll('.model-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.model === val);
    });
  }

  close() {
    if (this.modalEl) {
      this.modalEl.hidden = true;
    }
  }

  save() {
    const provider = AI_PROVIDERS_CONFIG[this.providerInput?.value]
      ? this.providerInput.value
      : 'gemini';
    const cfg = AI_PROVIDERS_CONFIG[provider];
    const model = (this.modelInput?.value || cfg.defaultModel).trim();
    const apiKey = (this.keyInput?.value || '').trim();

    this.profiles[provider] = { model, apiKey };

    const updated = storageService.saveSettings({
      aiProvider: provider,
      aiModel: model,
      aiApiKey: apiKey,
      providerProfiles: this.profiles,
      ghOwner: (this.ghOwnerInput?.value || '').trim(),
      ghRepo: (this.ghRepoInput?.value || 'Board2CAD').trim(),
      ghBranch: (this.ghBranchInput?.value || 'main').trim(),
      ghToken: (this.ghTokenInput?.value || '').trim()
    });

    this.close();
    if (this.showToast) {
      this.showToast(`Configurazione ${cfg.label} (${model}) salvata nel browser.`, 'success');
    }
    if (this.onSettingsSaved) {
      this.onSettingsSaved(updated);
    }
  }
}
