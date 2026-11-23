/**
 * Board2CAD — GitHub REST API Sync Service
 * Esegue il commit diretto di model.scad, model.stl, model.3mf, preview.png, meta.json
 * nella cartella models/<slug>/ del repository GitHub e aggiorna models/index.json.
 */

import { storageService } from './storageService.js';

export class GitHubService {
  /**
   * Verifica che le credenziali GitHub siano configurate
   */
  validateConfig(settings) {
    if (!settings.ghToken || !settings.ghOwner || !settings.ghRepo) {
      throw new Error(
        'Configura GitHub Owner, Nome Repository e Personal Access Token nelle Impostazioni prima di salvare su GitHub.'
      );
    }
  }

  /**
   * Converte ArrayBuffer / Uint8Array / String in Base64 compatibile con GitHub Contents API
   */
  toBase64(input) {
    if (typeof input === 'string') {
      const bytes = new TextEncoder().encode(input);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    }
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  /**
   * Legge lo SHA di un file esistente su GitHub (se presente) per poterlo aggiornare
   */
  async getFileSha(settings, path) {
    const url = `https://api.github.com/repos/${encodeURIComponent(settings.ghOwner)}/${encodeURIComponent(settings.ghRepo)}/contents/${path}?ref=${encodeURIComponent(settings.ghBranch || 'main')}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${settings.ghToken}`
      }
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Errore lettura GitHub (${path}): HTTP ${res.status} ${txt}`);
    }
    const data = await res.json();
    return data;
  }

  /**
   * Carica o aggiorna un singolo file su GitHub tramite PUT /repos/{owner}/{repo}/contents/{path}
   */
  async putFile(settings, path, base64Content, commitMessage) {
    const existing = await this.getFileSha(settings, path);
    const url = `https://api.github.com/repos/${encodeURIComponent(settings.ghOwner)}/${encodeURIComponent(settings.ghRepo)}/contents/${path}`;

    const body = {
      message: commitMessage,
      content: base64Content,
      branch: settings.ghBranch || 'main'
    };
    if (existing && existing.sha) {
      body.sha = existing.sha;
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.ghToken}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Commit fallito per ${path}: HTTP ${res.status} — ${errText}`);
    }
    return res.json();
  }

  /**
   * Salva l'intera cartella del modello in models/<slug>/ e aggiorna models/index.json
   */
  async pushModelToGitHub(modelData, onProgress = () => {}) {
    const settings = storageService.getSettings();
    this.validateConfig(settings);

    const slug = modelData.slug;
    const baseDir = `models/${slug}`;
    const commitPrefix = `feat(models): add/update 3D PCB model ${slug}`;

    onProgress(`Caricamento ${baseDir}/model.scad...`);
    await this.putFile(
      settings,
      `${baseDir}/model.scad`,
      this.toBase64(modelData.scad || ''),
      `${commitPrefix} [model.scad]`
    );

    onProgress(`Caricamento ${baseDir}/meta.json...`);
    await this.putFile(
      settings,
      `${baseDir}/meta.json`,
      this.toBase64(JSON.stringify(modelData.meta, null, 2)),
      `${commitPrefix} [meta.json]`
    );

    if (modelData.stlBuffer) {
      onProgress(`Caricamento ${baseDir}/model.stl...`);
      await this.putFile(
        settings,
        `${baseDir}/model.stl`,
        this.toBase64(modelData.stlBuffer),
        `${commitPrefix} [model.stl]`
      );
    }

    if (modelData.threemfBuffer) {
      onProgress(`Caricamento ${baseDir}/model.3mf...`);
      await this.putFile(
        settings,
        `${baseDir}/model.3mf`,
        this.toBase64(modelData.threemfBuffer),
        `${commitPrefix} [model.3mf]`
      );
    }

    const pngBytes = await storageService.dataUrlOrUrlToUint8Array(modelData.previewDataUrl);
    if (pngBytes) {
      onProgress(`Caricamento ${baseDir}/preview.png...`);
      await this.putFile(
        settings,
        `${baseDir}/preview.png`,
        this.toBase64(pngBytes),
        `${commitPrefix} [preview.png]`
      );
    }

    // Aggiorna models/index.json
    onProgress('Aggiornamento indice models/index.json...');
    let indexObj = { version: '1.0.0', updatedAt: new Date().toISOString(), models: [] };
    const existingIndex = await this.getFileSha(settings, 'models/index.json');
    if (existingIndex && existingIndex.content) {
      try {
        const decoded = atob(existingIndex.content.replace(/\s/g, ''));
        indexObj = JSON.parse(decoded);
      } catch {
        // Mantiene oggetto di default
      }
    }

    const summaryEntry = {
      slug,
      name: modelData.meta.name,
      category: modelData.meta.category || 'Custom PCB',
      dimensions: modelData.meta.dimensions,
      description: modelData.meta.description || '',
      tags: modelData.meta.tags || ['pcb', 'openscad', '3mf', 'stl'],
      preview: `./models/${slug}/preview.png`,
      files: {
        scad: `./models/${slug}/model.scad`,
        stl: `./models/${slug}/model.stl`,
        threemf: `./models/${slug}/model.3mf`,
        meta: `./models/${slug}/meta.json`
      },
      updatedAt: new Date().toISOString()
    };

    const idx = (indexObj.models || []).findIndex((m) => m.slug === slug);
    if (idx >= 0) {
      indexObj.models[idx] = summaryEntry;
    } else {
      indexObj.models = [summaryEntry, ...(indexObj.models || [])];
    }
    indexObj.updatedAt = new Date().toISOString();

    await this.putFile(
      settings,
      'models/index.json',
      this.toBase64(JSON.stringify(indexObj, null, 2)),
      `chore(models): update index.json for ${slug}`
    );

    return true;
  }
}

export const githubService = new GitHubService();
