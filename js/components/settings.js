/**
 * Board2CAD — Settings Modal Component (js/components/settings.js)
 * Manages AI Vision API Key/Model and GitHub Personal Access Token/Repo settings in localStorage.
 */

import { storageService } from '../services/storageService.js';

export class SettingsComponent {
  constructor({ modalEl, formEl, onSettingsSaved, onClearLocalDb, showToast }) {
    this.modalEl = modalEl;
    this.formEl = formEl;
    this.onSettingsSaved = onSettingsSaved;
    this.onClearLocalDb = onClearLocalDb;
    this.showToast = showToast;

    this.providerInput = document.getElementById('setting-ai-provider');
    this.modelInput = document.getElementById('setting-ai-model');
    this.keyInput = document.getElementById('setting-ai-key');
    this.ghOwnerInput = document.getElementById('setting-gh-owner');
    this.ghRepoInput = document.getElementById('setting-gh-repo');
    this.ghBranchInput = document.getElementById('setting-gh-branch');
    this.ghTokenInput = document.getElementById('setting-gh-token');

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
      this.providerInput.addEventListener('change', () => {
        if (this.providerInput.value === 'gemini' && (!this.modelInput.value || this.modelInput.value.includes('gpt'))) {
          this.modelInput.value = 'gemini-2.5-flash';
        } else if (this.providerInput.value === 'openai' && (!this.modelInput.value || this.modelInput.value.includes('gemini'))) {
          this.modelInput.value = 'gpt-4o';
        }
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
    if (this.providerInput) this.providerInput.value = s.aiProvider || 'gemini';
    if (this.modelInput) this.modelInput.value = s.aiModel || 'gemini-2.5-flash';
    if (this.keyInput) this.keyInput.value = s.aiApiKey || '';
    if (this.ghOwnerInput) this.ghOwnerInput.value = s.ghOwner || 'debartoloa';
    if (this.ghRepoInput) this.ghRepoInput.value = s.ghRepo || 'Board2CAD';
    if (this.ghBranchInput) this.ghBranchInput.value = s.ghBranch || 'main';
    if (this.ghTokenInput) this.ghTokenInput.value = s.ghToken || '';

    if (this.modalEl) {
      this.modalEl.hidden = false;
    }
  }

  close() {
    if (this.modalEl) {
      this.modalEl.hidden = true;
    }
  }

  save() {
    const updated = storageService.saveSettings({
      aiProvider: this.providerInput?.value || 'gemini',
      aiModel: (this.modelInput?.value || 'gemini-2.5-flash').trim(),
      aiApiKey: (this.keyInput?.value || '').trim(),
      ghOwner: (this.ghOwnerInput?.value || '').trim(),
      ghRepo: (this.ghRepoInput?.value || 'Board2CAD').trim(),
      ghBranch: (this.ghBranchInput?.value || 'main').trim(),
      ghToken: (this.ghTokenInput?.value || '').trim()
    });

    this.close();
    if (this.showToast) {
      this.showToast('Impostazioni AI e GitHub salvate nel browser.', 'success');
    }
    if (this.onSettingsSaved) {
      this.onSettingsSaved(updated);
    }
  }
}
