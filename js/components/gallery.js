/**
 * Board2CAD — Converted Models Library & Filter Component (js/components/gallery.js)
 * Displays unified cards from GitHub Repository (models/index.json) and Local IndexedDB.
 */

export class GalleryComponent {
  constructor({
    gridEl,
    searchInputEl,
    filterChips,
    countAllEl,
    countRepoEl,
    countLocalEl,
    onOpenModel,
    onQuickDownload,
    onDeleteLocal
  }) {
    this.gridEl = gridEl;
    this.searchInputEl = searchInputEl;
    this.filterChips = filterChips;
    this.countAllEl = countAllEl;
    this.countRepoEl = countRepoEl;
    this.countLocalEl = countLocalEl;

    this.onOpenModel = onOpenModel;
    this.onQuickDownload = onQuickDownload;
    this.onDeleteLocal = onDeleteLocal;

    this.allModels = [];
    this.activeFilter = 'all';
    this.searchQuery = '';

    this.bindEvents();
  }

  bindEvents() {
    if (this.searchInputEl) {
      this.searchInputEl.addEventListener('input', (e) => {
        this.searchQuery = (e.target.value || '').trim().toLowerCase();
        this.render();
      });
    }

    if (this.filterChips) {
      this.filterChips.forEach((chip) => {
        chip.addEventListener('click', () => {
          this.filterChips.forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          this.activeFilter = chip.dataset.filter || 'all';
          this.render();
        });
      });
    }
  }

  setModels(models = []) {
    this.allModels = models;
    this.updateCounts();
    this.render();
  }

  updateCounts() {
    const repoCount = this.allModels.filter((m) => m.source === 'repo').length;
    const localCount = this.allModels.filter((m) => m.source === 'local').length;
    if (this.countAllEl) this.countAllEl.textContent = String(this.allModels.length);
    if (this.countRepoEl) this.countRepoEl.textContent = String(repoCount);
    if (this.countLocalEl) this.countLocalEl.textContent = String(localCount);
  }

  render() {
    if (!this.gridEl) return;

    const filtered = this.allModels.filter((m) => {
      if (this.activeFilter !== 'all' && m.source !== this.activeFilter) {
        return false;
      }
      if (!this.searchQuery) return true;
      const haystack = `${m.name || ''} ${m.slug || ''} ${m.category || ''} ${m.description || ''} ${(m.tags || []).join(' ')}`.toLowerCase();
      return haystack.includes(this.searchQuery);
    });

    if (filtered.length === 0) {
      this.gridEl.innerHTML = `
        <div class="card" style="grid-column: 1 / -1; text-align: center; padding: 36px 20px;">
          <h3 class="card-title">Nessun modello trovato</h3>
          <p class="card-desc">Prova a modificare i filtri di ricerca oppure genera una nuova scheda 3D dal Wizard.</p>
        </div>
      `;
      return;
    }

    this.gridEl.innerHTML = filtered
      .map((model) => {
        const dims = model.dimensions || { length: 86, width: 50, height: 11.2 };
        const dimStr = `${Number(dims.length).toFixed(1)} × ${Number(dims.width).toFixed(1)} × ${Number(dims.height).toFixed(1)} mm`;
        const isRepo = model.source === 'repo';
        const hasOverride = Boolean(model.hasLocalOverride);
        const sourceBadge = isRepo
          ? hasOverride
            ? `<span class="badge badge-warning">Repo + Modificato</span>`
            : `<span class="badge badge-repo">Repo GitHub</span>`
          : `<span class="badge badge-local">Locale IndexedDB</span>`;
        const tagsHtml = (model.tags || ['PCB', 'Manifold', '3MF'])
          .slice(0, 5)
          .map((t) => `<span class="tag-mini">${this.escapeHtml(t)}</span>`)
          .join('');

        return `
          <article class="model-card" data-slug="${this.escapeHtml(model.slug)}" data-source="${this.escapeHtml(model.source)}">
            <div class="model-card-thumb" data-action="open" title="Clicca per aprire l'anteprima 3D interattiva">
              <img src="${this.escapeHtml(model.previewUrl || `./models/${model.slug}/preview.png`)}" alt="${this.escapeHtml(model.name)}" loading="lazy" onerror="this.src='./icon-512.png'">
              <div class="model-card-badges">
                ${sourceBadge}
                <span class="badge badge-emerald">100% Manifold</span>
              </div>
            </div>
            <div class="model-card-body">
              <h3 class="model-card-title">${this.escapeHtml(model.name)}</h3>
              <span class="model-card-dims">${dimStr}</span>
              <p class="model-card-desc">${this.escapeHtml(model.description || 'Modello parametrico 3D ad alto dettaglio per CAD e Slicer.')}</p>
              <div class="model-card-tags">${tagsHtml}</div>
              <div class="model-card-actions">
                <button type="button" class="btn btn-primary btn-sm" data-action="open">
                  Apri Studio 3D
                </button>
                <button type="button" class="btn btn-outline btn-sm" data-action="dl-stl" title="Scarica file .STL">
                  .STL
                </button>
                <button type="button" class="btn btn-outline btn-sm" data-action="dl-3mf" title="Scarica file .3MF multicolore">
                  .3MF
                </button>
                <button type="button" class="btn btn-outline btn-sm" data-action="dl-scad" title="Scarica script .SCAD">
                  .SCAD
                </button>
                ${
                  !isRepo
                    ? `<button type="button" class="btn btn-ghost btn-sm" data-action="delete-local" title="Elimina modello da IndexedDB locale">🗑</button>`
                    : ''
                }
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    // Delegazione click sulle card
    this.gridEl.querySelectorAll('.model-card').forEach((cardEl) => {
      const slug = cardEl.dataset.slug;
      const source = cardEl.dataset.source;

      cardEl.querySelectorAll('[data-action]').forEach((actionEl) => {
        actionEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const act = actionEl.dataset.action;
          if (act === 'open' && this.onOpenModel) {
            this.onOpenModel(slug, source);
          } else if (act === 'dl-stl' && this.onQuickDownload) {
            this.onQuickDownload(slug, source, 'stl');
          } else if (act === 'dl-3mf' && this.onQuickDownload) {
            this.onQuickDownload(slug, source, '3mf');
          } else if (act === 'dl-scad' && this.onQuickDownload) {
            this.onQuickDownload(slug, source, 'scad');
          } else if (act === 'delete-local' && this.onDeleteLocal) {
            this.onDeleteLocal(slug);
          }
        });
      });
    });
  }

  escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
