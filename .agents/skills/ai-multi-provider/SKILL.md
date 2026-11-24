---
name: ai-multi-provider
description: >-
  Architettura standard Multi-Provider AI (Zero Single-Point-of-Failure) in puro JavaScript
  Vanilla (ES Modules) per Web App e PWA: adapter unificato per Google AI Studio (Gemini 3.x /
  Gemma 4), OpenRouter (Free Models) e Groq Cloud, template fetch testo e multimodale Base64,
  ridimensionamento immagini su canvas (max 1024px JPEG 0.85), gestione chiavi separate in
  localStorage, stati UI espliciti e fallback "Copia Prompt per Chat AI". Usa questa skill ogni
  volta che progetti, implementi o aggiorni funzionalità basate su LLM o Vision AI.
---

# AI Multi-Provider Architecture Skill (Vanilla JS ES Modules)

Usa questa skill ogni volta che progetti, implementi o aggiorni una funzionalità basata su **LLM o Vision AI** in una Web App o PWA Vanilla JS, garantendo l'assenza di Single-Point-of-Failure e un fallback manuale **Zero-API**.

---

## 1. Principi Architetturali Vincolanti

1. **Divieto di Provider Singolo (Zero Single-Point-of-Failure):**
   - Nessuna app deve dipendere esclusivamente da Google AI Studio. Ogni adapter AI (`js/services/aiService.js` o equivalente) deve integrare nativamente almeno **3 provider selezionabili dall'utente**:
     - `gemini` — **Google AI Studio (Gemini / Gemma)**
     - `openrouter` — **OpenRouter (Modelli Free Vision & Text)**
     - `groq` — **Groq Cloud (Inferenza ultraveloce OpenAI-compatibile)**
2. **Zero Build Step & Pure Vanilla ES6+:**
   - Usa esclusivamente `fetch` nativo, `<canvas>` offscreen e moduli ESM (`type="module"`), senza SDK npm o bundler.
3. **Zero Segreti nel Codice:**
   - Nessuna API Key deve mai essere scritta nei sorgenti o committata su Git. Tutte le chiavi risiedono esclusivamente in `localStorage`.

---

## 2. Gestione Chiavi Multiple & Modelli in `localStorage`

Le chiavi dei diversi provider devono essere salvate in chiavi `localStorage` **separate** (`api_key_gemini`, `api_key_openrouter`, `api_key_groq` più `ai_provider`, `ai_model` e memorie modello per singolo provider), affinché il cambio di provider nelle Impostazioni non sovrascriva le API Key già inserite per gli altri servizi.

```javascript
// js/services/aiConfig.js — Gestione Configurazione Multi-Provider in localStorage
export const AI_PROVIDERS = {
  gemini: {
    id: 'gemini',
    label: 'Google AI Studio (Gemini)',
    endpointBase: 'https://generativelanguage.googleapis.com/v1beta/models',
    defaultModel: 'gemini-3.8-flash',
    recommendedModels: [
      'gemini-3.8-flash',
      'gemini-3.6-flash',
      'gemini-3.1-pro-preview',
      'gemma-4-31b-it'
    ],
    storageKey: 'api_key_gemini',
    modelStorageKey: 'ai_model_gemini',
    keyPlaceholder: 'AIzaSy...'
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (Free Vision & Text)',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'qwen/qwen2.5-vl-72b-instruct:free',
    recommendedModels: [
      'qwen/qwen2.5-vl-72b-instruct:free',
      'google/gemma-3-27b-it:free',
      'meta-llama/llama-3.3-70b-instruct:free'
    ],
    storageKey: 'api_key_openrouter',
    modelStorageKey: 'ai_model_openrouter',
    keyPlaceholder: 'sk-or-v1-...'
  },
  groq: {
    id: 'groq',
    label: 'Groq Cloud (Ultraveloce)',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    recommendedModels: [
      'meta-llama/llama-4-scout-17b-16e-instruct',
      'llama-3.3-70b-versatile'
    ],
    storageKey: 'api_key_groq',
    modelStorageKey: 'ai_model_groq',
    keyPlaceholder: 'gsk_...'
  }
};

export function loadAIConfig() {
  const providerRaw = localStorage.getItem('ai_provider') || 'gemini';
  const provider = AI_PROVIDERS[providerRaw] ? providerRaw : 'gemini';
  const cfg = AI_PROVIDERS[provider];

  const keys = {
    gemini: localStorage.getItem('api_key_gemini') || '',
    openrouter: localStorage.getItem('api_key_openrouter') || '',
    groq: localStorage.getItem('api_key_groq') || ''
  };

  const models = {
    gemini: localStorage.getItem('ai_model_gemini') || AI_PROVIDERS.gemini.defaultModel,
    openrouter: localStorage.getItem('ai_model_openrouter') || AI_PROVIDERS.openrouter.defaultModel,
    groq: localStorage.getItem('ai_model_groq') || AI_PROVIDERS.groq.defaultModel
  };

  const activeModel = localStorage.getItem('ai_model') || models[provider] || cfg.defaultModel;

  return {
    ai_provider: provider,
    ai_model: activeModel,
    apiKey: keys[provider] || '',
    keys,
    models
  };
}

export function saveAIConfig({ provider, model, apiKey, keys = {}, models = {} }) {
  const validProvider = AI_PROVIDERS[provider] ? provider : 'gemini';
  const cfg = AI_PROVIDERS[validProvider];
  const cleanModel = (model || cfg.defaultModel).trim();
  const cleanKey = (apiKey || '').trim();

  localStorage.setItem('ai_provider', validProvider);
  localStorage.setItem('ai_model', cleanModel);
  localStorage.setItem(cfg.storageKey, cleanKey);
  localStorage.setItem(cfg.modelStorageKey, cleanModel);

  // Preserva eventuali chiavi/modelli modificati sugli altri tab/provider
  for (const p of Object.keys(AI_PROVIDERS)) {
    if (p !== validProvider && typeof keys[p] === 'string') {
      localStorage.setItem(AI_PROVIDERS[p].storageKey, keys[p].trim());
    }
    if (p !== validProvider && typeof models[p] === 'string' && models[p].trim()) {
      localStorage.setItem(AI_PROVIDERS[p].modelStorageKey, models[p].trim());
    }
  }
}
```

---

## 3. Ridimensionamento Immagini Lato Client (`<canvas>` max `1024px`, JPEG `0.85`)

Prima di inviare immagini nel payload Base64, ridimensionale sempre tramite `<canvas>` offscreen affinché il lato più lungo non superi `1024 px` (senza ingrandire foto più piccole), esportando in `image/jpeg` qualità `0.85` su sfondo bianco `#ffffff` (essenziale per schemi/disegni PNG trasparenti).

```javascript
export function computeScaledDimensions(width, height, maxSide = 1024) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) return { width: maxSide, height: maxSide };
  if (w <= maxSide && h <= maxSide) return { width: Math.round(w), height: Math.round(h) };
  if (w >= h) {
    return { width: maxSide, height: Math.max(1, Math.round((h * maxSide) / w)) };
  }
  return { width: Math.max(1, Math.round((w * maxSide) / h)), height: maxSide };
}

export async function optimizeImageToJpegDataUrl(fileOrDataUrl, maxSide = 1024, quality = 0.85) {
  const isBlob = typeof Blob !== 'undefined' && fileOrDataUrl instanceof Blob;
  const objectUrl = isBlob ? URL.createObjectURL(fileOrDataUrl) : null;
  const src = isBlob ? objectUrl : String(fileOrDataUrl || '');

  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Impossibile caricare l\'immagine sul canvas.'));
      el.src = src;
    });

    const { width, height } = computeScaledDimensions(
      img.naturalWidth || img.width,
      img.naturalHeight || img.height,
      maxSide
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { dataUrl, mimeType: 'image/jpeg', width, height, resized: true };
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
```

---

## 4. Template Pronti dei Payload `fetch` (Testo & Multimodale Base64)

### 4.1 Google AI Studio (`generativelanguage.googleapis.com`)

- **Solo Testo:**
  ```javascript
  const body = {
    contents: [{ role: 'user', parts: [{ text: promptText }] }],
    generationConfig: {
      temperature: 0.15,
      maxOutputTokens: 8192,
      ...(isGeminiThinking ? { thinkingConfig: { thinkingBudget: 2048 } } : {})
    }
  };
  ```
- **Multimodale (Immagini Base64 + Testo):**
  - Inserisci prima ogni immagine come `{ inline_data: { mime_type: 'image/jpeg', data: base64WithoutPrefix } }` e infine `{ text: promptText }`.
  - **Regola modelli `gemma-*` (es. `gemma-4-31b-it`):** NON inviare `thinkingConfig` né `responseMimeType` (provocano `HTTP 400`).
  - **Regola filtro Gemini 3.x (`thought: true`):** filtra sempre `candidate.content.parts.filter(p => p && p.thought !== true && typeof p.text === 'string')`.

```javascript
export function extractGeminiResponseText(data) {
  const candidate = data?.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error(`Risposta Gemini vuota (${data?.promptFeedback?.blockReason || candidate?.finishReason || 'unknown'}).`);
  }
  const text = candidate.content.parts
    .filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Gemini ha restituito solo blocchi thought senza output finale.');
  return text;
}
```

### 4.2 OpenRouter (`https://openrouter.ai/api/v1/chat/completions`)

- **Header richiesti:** `Authorization: Bearer ${apiKey}`, `HTTP-Referer: location.origin`, `X-Title: 'AppName'`.
- **Solo Testo (`meta-llama/llama-3.3-70b-instruct:free`):**
  ```javascript
  const body = {
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: promptText }] }],
    temperature: 0.15,
    max_tokens: 4096
  };
  ```
- **Multimodale Vision (`qwen/qwen2.5-vl-72b-instruct:free`, `google/gemma-3-27b-it:free`):**
  ```javascript
  const content = [
    { type: 'text', text: promptText },
    ...images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } }))
  ];
  const body = {
    model,
    messages: [{ role: 'user', content }],
    temperature: 0.15,
    max_tokens: 4096
  };
  ```
  - Evita di forzare `response_format: { type: 'json_object' }` in combinazione con `image_url` sui modelli `:free` per prevenire `HTTP 400`.

### 4.3 Groq Cloud (`https://api.groq.com/openai/v1/chat/completions`)

- **Solo Testo (`llama-3.3-70b-versatile`):** usa `{ role: 'user', content: promptText }`.
- **Multimodale Vision (`meta-llama/llama-4-scout-17b-16e-instruct`):** usa lo stesso array OpenAI standard `content: [{ type: 'text', text: promptText }, { type: 'image_url', image_url: { url: dataUrl } }]`.
- **Filtro risposte OpenAI-compatibili:** rimuovi eventuali tag `<think>[\s\S]*?</think>` e blocchi con `part.thought === true` o `part.type === 'thinking'`.

---

## 5. Schema Architetturale Completo dell'Adapter (`js/services/aiService.js`)

```javascript
import { AI_PROVIDERS, loadAIConfig } from './aiConfig.js';
import { optimizeImageToJpegDataUrl } from './imageOptimizer.js';

export function formatApiHttpError(providerLabel, status, rawBody = '') {
  let detail = String(rawBody || '').trim();
  try {
    const parsed = JSON.parse(detail);
    detail = parsed?.error?.message || parsed?.message || detail;
  } catch { /* non-JSON body */ }
  if (detail.length > 320) detail = `${detail.slice(0, 320)}...`;
  return `Errore API ${providerLabel} (HTTP ${status}): ${detail || 'Risposta non valida'}`;
}

export class AIService {
  async generate({ systemPrompt = '', userPrompt, images = [], expectJson = false }) {
    const cfg = loadAIConfig();
    const provider = cfg.ai_provider;
    const apiKey = (cfg.apiKey || '').trim();
    const model = (cfg.ai_model || AI_PROVIDERS[provider].defaultModel).trim();

    if (!apiKey) {
      throw new Error(`API Key non configurata per ${AI_PROVIDERS[provider].label} (HTTP 401).`);
    }

    const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;

    // Ridimensionamento difensivo immagini <= 1024px JPEG 0.85
    const optimizedImages = [];
    for (const img of images) {
      if (!img?.dataUrl?.startsWith('data:image/')) continue;
      optimizedImages.push(
        img.resized ? img : await optimizeImageToJpegDataUrl(img.dataUrl, 1024, 0.85)
      );
    }

    if (provider === 'openrouter' || provider === 'groq') {
      return this.#callOpenAICompatible({ provider, model, apiKey, fullPrompt, images: optimizedImages });
    }
    return this.#callGemini({ model, apiKey, fullPrompt, images: optimizedImages, expectJson });
  }

  async #callGemini({ model, apiKey, fullPrompt, images, expectJson }) {
    const parts = [];
    for (const img of images) {
      const idx = img.dataUrl.indexOf(',');
      if (idx !== -1) {
        parts.push({
          inline_data: { mime_type: 'image/jpeg', data: img.dataUrl.slice(idx + 1).trim() }
        });
      }
    }
    parts.push({ text: fullPrompt });

    const isGemma = /^gemma-/i.test(model);
    const isThinking = /gemini-(?:2\.5|[3-9](?:\.\d+)?)|thinking/i.test(model);
    const generationConfig = {
      temperature: 0.15,
      maxOutputTokens: 8192,
      ...(expectJson && !isGemma ? { responseMimeType: 'application/json' } : {}),
      ...(!isGemma && isThinking ? { thinkingConfig: { thinkingBudget: 2048 } } : {})
    };

    const url = `${AI_PROVIDERS.gemini.endpointBase}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig })
    });

    if (!res.ok) throw new Error(formatApiHttpError('Google Gemini', res.status, await res.text()));
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts
      ?.filter((p) => p && p.thought !== true && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n')
      .trim();
  }

  async #callOpenAICompatible({ provider, model, apiKey, fullPrompt, images }) {
    const cfg = AI_PROVIDERS[provider];
    const content = images.length > 0
      ? [{ type: 'text', text: fullPrompt }, ...images.map((i) => ({ type: 'image_url', image_url: { url: i.dataUrl } }))]
      : fullPrompt;

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(provider === 'openrouter' ? { 'HTTP-Referer': location.origin, 'X-Title': document.title || 'PWA App' } : {})
    };

    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0.15, max_tokens: 4096 })
    });

    if (!res.ok) throw new Error(formatApiHttpError(cfg.label, res.status, await res.text()));
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content;
    const text = Array.isArray(raw)
      ? raw.filter((p) => p && p.thought !== true && p.type !== 'thinking').map((p) => p.text || '').join('\n')
      : String(raw || '');
    return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  buildExternalChatPrompt({ systemPrompt, userDataSummary, instructions }) {
    return [
      systemPrompt,
      '',
      '=== DATI INSERITI DALL\'UTENTE ===',
      userDataSummary,
      '',
      '=== ISTRUZIONI FINALI ===',
      instructions
    ].join('\n');
  }
}
```

---

## 6. Checklist Stati UI Obbligatori & Paracadute Offline

Ogni flusso UI che invoca l'adapter AI deve sempre implementare:

1. **Blocco `try / catch / finally` completo:**
   - All'avvio: disabilita i pulsanti (`btn.disabled = true`) e mostra un banner `.is-loading` con spinner animato e stato corrente.
   - Su errore (`catch`): mostra un **banner rosso persistente** (`.is-error`, non solo un toast a scomparsa) con codice HTTP reale (`HTTP 401 / 429 / 503`) e dettaglio dell'API, più un pulsante inline per aprire `Config` e un pulsante **`Copia Prompt per Chat AI`**.
   - Su successo (`try`): mostra un banner `.is-success` prima di passare al risultato.
   - Nel `finally`: riabilita sempre i pulsanti e ripristina le etichette originali.
2. **Pulsante "Copia Prompt per Chat AI" (Zero-API Fallback):**
   - Deve funzionare in modo **sincrono** rispetto al click utente (nessun `await` prima di `navigator.clipboard.writeText`) con fallback su `<textarea>` offscreen + `document.execCommand('copy')` per compatibilità iOS Safari e HTTP locale.
3. **Verifica Post-Implementazione:**
   - Controllare con `node --check` la sintassi di tutti i moduli JS.
   - Testare con `fetch` mockato i 3 provider (`gemini` con filtro `part.thought === true` e omissione `thinkingConfig` su `gemma-*`, `openrouter` con `HTTP-Referer` + `X-Title`, `groq` con `image_url`), e verificare che errori `HTTP 401 / 429 / 503` arrivino intatti al banner UI.
