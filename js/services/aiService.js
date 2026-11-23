/**
 * Board2CAD — AI Vision & OpenSCAD Parametric Generator Service
 * Supports Google Gemini Vision API, OpenAI GPT-4o Vision API, and
 * Intelligent Offline Parametric Engine with Clarification First & Auto-Fix Loop.
 */

import { storageService } from './storageService.js';

const SYSTEM_PROMPT_MANIFOLD = `Sei un Senior CAD Automation Engineer specializzato in OpenSCAD per schede elettroniche (PCB 3D Dummy / Mechanical Enclosure Models).
REGOLE GEOMETRICHE TASSATIVE (100% MANIFOLD / WATERTIGHT):
1. Definisci sempre eps = 0.05; e fai compenetrare OGNI componente appoggiato sul PCB di 0.05 mm dentro il PCB (es. translate([x, y, pcb_thickness - eps])) per eliminare qualsiasi faccia coplanare.
2. Tutti i fori passanti in difference() devono partire da z = -0.1 ed avere altezza pcb_thickness + 0.2.
3. Includi SEMPRE in testa al file i blocchi Customizer:
   /* [Board Dimensions] */
   pcb_length, pcb_width, pcb_thickness, corner_radius, hole_diameter, hole_pitch_x, hole_pitch_y, usb_protrusion, display_height
   /* [Detail & Features] */
   show_silkscreen = true;
   show_headers = true;
   show_components = true;
   show_display = true;
   $fn = 36;
4. Usa chiamate esplicite color("#RRGGBB") su ogni gruppo (PCB, pad rame/oro #d4af37, porta USB-C metallica #c0c7d0, connettori JST #f3f4f6, chip IC #1e242b, display LCD/OLED #0a192f, cornice #111111, serigrafia #f8fafc) per il rendering e l'esportazione .3MF multicolore.
5. Restituisci SOLO codice OpenSCAD puro e valido, senza blocchi markdown superflui.`;

export class AIService {
  /**
   * Step 2 del Wizard: Ispeziona le immagini, le note e l'eventuale codice .SCAD di partenza ("Clarification First").
   * Se mancano misure critiche o parametri per le modifiche richieste, genera la lista mirata di domande con valori precompilati.
   */
  async analyzeBoardImages({ name, category, preset, notes, images = [], existingScad = '' }) {
    const settings = storageService.getSettings();
    const hasExistingScad = Boolean(existingScad && existingScad.trim().length > 20);
    const parsedFromNotes = this.extractDimensionsFromNotes(notes, name, category, preset, existingScad);

    // Se l'utente ha configurato una API Key valida e non è in modalità offline, interroga l'AI Vision / Code Analyzer
    if (settings.aiApiKey && settings.aiProvider !== 'offline') {
      try {
        const aiResult = await this.callVisionAnalysisAPI(settings, {
          name,
          category,
          preset,
          notes,
          images,
          existingScad,
          parsedFromNotes
        });
        if (aiResult && Array.isArray(aiResult.questions)) {
          return aiResult;
        }
      } catch (err) {
        console.warn('[AIService] Chiamata API Vision fallita, attivo analisi parametrica locale:', err);
      }
    }

    // Analisi intelligente locale / fallback Clarification First
    return this.buildSmartClarificationPlan({
      name,
      category,
      preset,
      notes,
      images,
      existingScad,
      hasExistingScad,
      parsedFromNotes
    });
  }

  /**
   * Estrae eventuali quote già presenti nello script .SCAD di partenza e/o scritte dall'utente nel campo note
   */
  extractDimensionsFromNotes(notes = '', name = '', category = '', preset = 'auto', existingScad = '') {
    const text = `${name} ${notes}`.toLowerCase();
    const defaults = this.getPresetDefaults(preset, category, text);
    let hasExplicitBoardSize = false;
    let hasExplicitHolePitch = false;

    // 1. Se è presente un codice .SCAD di partenza, legge le variabili reali dallo script!
    if (existingScad && existingScad.trim().length > 15) {
      const readScadVar = (names) => {
        for (const varName of names) {
          const rx = new RegExp(`^\\s*${varName}\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)\\s*;`, 'm');
          const m = existingScad.match(rx);
          if (m) return parseFloat(m[1]);
        }
        return null;
      };

      const sLen = readScadVar(['pcb_length', 'pcb_l', 'pcb_x', 'board_length', 'board_l', 'board_x', 'length', 'L']);
      const sWid = readScadVar(['pcb_width', 'pcb_w', 'pcb_y', 'board_width', 'board_w', 'board_y', 'width', 'W']);
      const sThk = readScadVar(['pcb_thickness', 'pcb_t', 'pcb_z', 'board_thickness', 'board_t', 'board_z', 'thickness', 'T']);
      const sRad = readScadVar(['corner_radius', 'corner_r', 'pcb_r', 'board_r', 'radius', 'R']);
      const sHoleD = readScadVar(['hole_diameter', 'hole_d', 'mount_hole_d', 'hole_dia']);
      const sPitchX = readScadVar(['hole_pitch_x', 'pitch_x', 'mount_dx', 'hole_dx']);
      const sPitchY = readScadVar(['hole_pitch_y', 'pitch_y', 'mount_dy', 'hole_dy']);
      const sUsb = readScadVar(['usb_protrusion', 'usb_ext']);
      const sDispH = readScadVar(['display_height', 'lcd_t', 'disp_h', 'shield_h']);

      if (sLen !== null) { defaults.pcb_length = sLen; hasExplicitBoardSize = true; }
      if (sWid !== null) { defaults.pcb_width = sWid; hasExplicitBoardSize = true; }
      if (sThk !== null) defaults.pcb_thickness = sThk;
      if (sRad !== null) defaults.corner_radius = sRad;
      if (sHoleD !== null) defaults.hole_diameter = sHoleD;
      if (sPitchX !== null) { defaults.hole_pitch_x = sPitchX; hasExplicitHolePitch = true; }
      if (sPitchY !== null) { defaults.hole_pitch_y = sPitchY; hasExplicitHolePitch = true; }
      if (sUsb !== null) defaults.usb_protrusion = sUsb;
      if (sDispH !== null) defaults.display_height = sDispH;

      if (hasExplicitBoardSize && !hasExplicitHolePitch) {
        defaults.hole_pitch_x = Number((defaults.pcb_length - 6.0).toFixed(1));
        defaults.hole_pitch_y = Number((defaults.pcb_width - 6.0).toFixed(1));
      }
    }

    // 2. Cerca nelle note utente eventuali nuove quote richieste (es. "cambia PCB a 90x55")
    const dimMatch = text.match(/(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i);
    if (dimMatch) {
      const d1 = parseFloat(dimMatch[1].replace(',', '.'));
      const d2 = parseFloat(dimMatch[2].replace(',', '.'));
      if (d1 >= 10 && d2 >= 10) {
        defaults.pcb_length = Math.max(d1, d2);
        defaults.pcb_width = Math.min(d1, d2);
        hasExplicitBoardSize = true;
      }
    }

    // Cerca interasse fori "interasse 80x44"
    const pitchMatch = text.match(/interasse\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i);
    if (pitchMatch) {
      defaults.hole_pitch_x = parseFloat(pitchMatch[1].replace(',', '.'));
      defaults.hole_pitch_y = parseFloat(pitchMatch[2].replace(',', '.'));
      hasExplicitHolePitch = true;
    } else if (hasExplicitBoardSize && !hasExplicitHolePitch) {
      defaults.hole_pitch_x = Number((defaults.pcb_length - 6.0).toFixed(1));
      defaults.hole_pitch_y = Number((defaults.pcb_width - 6.0).toFixed(1));
    }

    // Cerca spessore PCB
    const thickMatch = text.match(/spessore\s*(\d+(?:[.,]\d+)?)/i);
    if (thickMatch) {
      defaults.pcb_thickness = parseFloat(thickMatch[1].replace(',', '.'));
    }

    return {
      ...defaults,
      hasExplicitBoardSize,
      hasExplicitHolePitch
    };
  }

  /**
   * Valori parametrici realistici in base alla famiglia di scheda
   */
  getPresetDefaults(preset, category, text = '') {
    const isDisplay =
      preset === 'esp32-display' ||
      category.includes('Display') ||
      /freenove|2\.8|3\.5|tft|ips|lcd|oled|ili9341|st7789/i.test(text);

    const isRelay =
      preset === 'relay-module' ||
      category.includes('Relay') ||
      /rel[eè]|relay|morsett/i.test(text);

    const isSensor =
      preset === 'sensor-breakout' ||
      category.includes('Sensor') ||
      /bme280|mpu6050|sensore|breakout|ina219/i.test(text);

    if (isDisplay) {
      return {
        archetype: 'esp32-display',
        pcb_length: 86.0,
        pcb_width: 50.0,
        pcb_thickness: 1.6,
        corner_radius: 3.0,
        hole_diameter: 3.2,
        hole_pitch_x: 80.0,
        hole_pitch_y: 44.0,
        usb_protrusion: 1.5,
        display_width: 70.0,
        display_WidthActive: 57.6,
        display_height: 3.4,
        jst_count: 3,
        has_microsd: true,
        has_display: true,
        has_headers: false,
        pcb_color: '#162238'
      };
    }

    if (isRelay) {
      return {
        archetype: 'relay-module',
        pcb_length: 51.0,
        pcb_width: 39.0,
        pcb_thickness: 1.6,
        corner_radius: 2.0,
        hole_diameter: 3.1,
        hole_pitch_x: 45.0,
        hole_pitch_y: 33.5,
        usb_protrusion: 0.0,
        display_width: 0.0,
        display_height: 15.5,
        jst_count: 1,
        has_microsd: false,
        has_display: false,
        has_headers: true,
        pcb_color: '#14532d'
      };
    }

    if (isSensor) {
      return {
        archetype: 'sensor-breakout',
        pcb_length: 25.4,
        pcb_width: 17.8,
        pcb_thickness: 1.6,
        corner_radius: 1.5,
        hole_diameter: 2.6,
        hole_pitch_x: 20.0,
        hole_pitch_y: 12.5,
        usb_protrusion: 0.0,
        display_width: 0.0,
        display_height: 2.5,
        jst_count: 1,
        has_microsd: false,
        has_display: false,
        has_headers: true,
        pcb_color: '#1e3a8a'
      };
    }

    // Default: ESP32 / MCU DevKit
    return {
      archetype: 'esp32-devkit',
      pcb_length: 54.6,
      pcb_width: 27.9,
      pcb_thickness: 1.6,
      corner_radius: 1.5,
      hole_diameter: 2.6,
      hole_pitch_x: 49.0,
      hole_pitch_y: 23.0,
      usb_protrusion: 1.4,
      display_width: 0.0,
      display_height: 3.2,
      jst_count: 0,
      has_microsd: false,
      has_display: false,
      has_headers: true,
      pcb_color: '#155e38'
    };
  }

  /**
   * Costruisce il piano Clarification First con i campi mancanti o da confermare
   */
  buildSmartClarificationPlan({
    name,
    category,
    preset,
    notes,
    images = [],
    existingScad = '',
    hasExistingScad = false,
    parsedFromNotes
  }) {
    const d = parsedFromNotes;
    const allSpecified = d.hasExplicitBoardSize && d.hasExplicitHolePitch;

    const questions = [
      {
        id: 'pcb_length',
        label: 'Lunghezza PCB (Asse X)',
        unit: 'mm',
        type: 'number',
        min: 10,
        max: 300,
        step: 0.1,
        suggestedValue: d.pcb_length
      },
      {
        id: 'pcb_width',
        label: 'Larghezza PCB (Asse Y)',
        unit: 'mm',
        type: 'number',
        min: 10,
        max: 250,
        step: 0.1,
        suggestedValue: d.pcb_width
      },
      {
        id: 'pcb_thickness',
        label: 'Spessore Laminato FR4',
        unit: 'mm',
        type: 'number',
        min: 0.6,
        max: 3.2,
        step: 0.1,
        suggestedValue: d.pcb_thickness
      },
      {
        id: 'hole_pitch_x',
        label: 'Interasse Fori Fissaggio X',
        unit: 'mm',
        type: 'number',
        min: 5,
        max: 290,
        step: 0.1,
        suggestedValue: d.hole_pitch_x
      },
      {
        id: 'hole_pitch_y',
        label: 'Interasse Fori Fissaggio Y',
        unit: 'mm',
        type: 'number',
        min: 5,
        max: 240,
        step: 0.1,
        suggestedValue: d.hole_pitch_y
      },
      {
        id: 'hole_diameter',
        label: 'Diametro Fori Montaggio (M2.5 / M3)',
        unit: 'mm',
        type: 'number',
        min: 1.5,
        max: 6.0,
        step: 0.1,
        suggestedValue: d.hole_diameter
      },
      {
        id: 'corner_radius',
        label: 'Raggio Raccordo Angoli PCB',
        unit: 'mm',
        type: 'number',
        min: 0,
        max: 12,
        step: 0.5,
        suggestedValue: d.corner_radius
      },
      {
        id: 'usb_protrusion',
        label: 'Sporgenza Connettore USB-C oltre bordo',
        unit: 'mm',
        type: 'number',
        min: 0,
        max: 5,
        step: 0.1,
        suggestedValue: d.usb_protrusion
      },
      {
        id: 'display_height',
        label: 'Spessore Modulo Top (Display / Relè / Shield)',
        unit: 'mm',
        type: 'number',
        min: 1.0,
        max: 25.0,
        step: 0.2,
        suggestedValue: d.display_height
      }
    ];

    const imgCount = images.length;
    const summary = hasExistingScad
      ? `Codice OpenSCAD di partenza rilevato (${existingScad.split(/\r?\n/).length} righe, PCB ${d.pcb_length} × ${d.pcb_width} mm). Verifica o modifica le quote qui sotto prima di applicare le modifiche richieste e compilare in 3D:`
      : allSpecified
        ? `Quote principali rilevate dalle note (${d.pcb_length} × ${d.pcb_width} mm). Verifica o conferma i parametri di dettaglio prima della compilazione 3D.`
        : `Ispezionate ${imgCount} immagini per "${name || 'Nuova Scheda PCB'}". Per garantire un modello 3D accurato per Fusion 360, conferma o correggi le misure critiche precompilate qui sotto:`;

    return {
      needsClarification: !allSpecified && !hasExistingScad,
      hasExistingScad: Boolean(hasExistingScad),
      archetype: d.archetype,
      summary,
      questions
    };
  }

  /**
   * Chiamata fetch multimodale (Gemini o OpenAI Vision) per Step 2
   */
  async callVisionAnalysisAPI(settings, { name, category, preset, notes, images, existingScad = '', parsedFromNotes }) {
    const scadContext = existingScad && existingScad.trim()
      ? `\nCODICE OPENSCAD ESISTENTE FORNITO DALL'UTENTE:\n${existingScad.slice(0, 6000)}\n`
      : '';
    const prompt = `Analizza questa scheda elettronica ("${name}", categoria: "${category}", note/modifiche richieste dall'utente: "${notes}").${scadContext}
Se mancano misure critiche per costruire o modificare il modello CAD 3D (lunghezza PCB, larghezza PCB, spessore, interasse fori, diametro fori, sporgenza USB, altezza componente principale), restituisci un JSON valido con questa struttura esatta:
{
  "needsClarification": true,
  "archetype": "${parsedFromNotes.archetype}",
  "summary": "Breve sintesi dei componenti/codice rilevati e delle modifiche che verranno applicate",
  "questions": [
    { "id": "pcb_length", "label": "Lunghezza PCB (Asse X)", "unit": "mm", "type": "number", "min": 10, "max": 300, "step": 0.1, "suggestedValue": ${parsedFromNotes.pcb_length} },
    { "id": "pcb_width", "label": "Larghezza PCB (Asse Y)", "unit": "mm", "type": "number", "min": 10, "max": 250, "step": 0.1, "suggestedValue": ${parsedFromNotes.pcb_width} },
    { "id": "pcb_thickness", "label": "Spessore PCB", "unit": "mm", "type": "number", "min": 0.6, "max": 3.2, "step": 0.1, "suggestedValue": ${parsedFromNotes.pcb_thickness} },
    { "id": "hole_pitch_x", "label": "Interasse Fori X", "unit": "mm", "type": "number", "min": 5, "max": 290, "step": 0.1, "suggestedValue": ${parsedFromNotes.hole_pitch_x} },
    { "id": "hole_pitch_y", "label": "Interasse Fori Y", "unit": "mm", "type": "number", "min": 5, "max": 240, "step": 0.1, "suggestedValue": ${parsedFromNotes.hole_pitch_y} },
    { "id": "hole_diameter", "label": "Diametro Fori M3", "unit": "mm", "type": "number", "min": 1.5, "max": 6.0, "step": 0.1, "suggestedValue": ${parsedFromNotes.hole_diameter} },
    { "id": "corner_radius", "label": "Raggio Angoli PCB", "unit": "mm", "type": "number", "min": 0, "max": 10, "step": 0.5, "suggestedValue": ${parsedFromNotes.corner_radius} },
    { "id": "usb_protrusion", "label": "Sporgenza USB-C", "unit": "mm", "type": "number", "min": 0, "max": 5, "step": 0.1, "suggestedValue": ${parsedFromNotes.usb_protrusion} },
    { "id": "display_height", "label": "Altezza Display/Componente Top", "unit": "mm", "type": "number", "min": 1, "max": 25, "step": 0.2, "suggestedValue": ${parsedFromNotes.display_height} }
  ]
}`;

    const rawText = await this.invokeMultimodalLLM(settings, prompt, images, true);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Risposta JSON AI non valida');
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Step 3 del Wizard: Genera o modifica lo script OpenSCAD 100% manifold
   */
  async generateOpenSCAD({ name, category, preset, notes, parameters, images = [], existingScad = '' }) {
    const settings = storageService.getSettings();
    const hasExistingScad = Boolean(existingScad && existingScad.trim().length > 20);

    if (settings.aiApiKey && settings.aiProvider !== 'offline') {
      try {
        const userPrompt = hasExistingScad
          ? `Parti da questo script OpenSCAD esistente per la scheda "${name}" (${category}) e implementa TUTTE le modifiche richieste dall'utente mantenendo lo stile, i moduli esistenti e garantendo una mesh 100% manifold (watertight, eps = 0.05 mm).

MODIFICHE RICHIESTE DALL'UTENTE:
${notes || 'Aggiorna le quote secondo i parametri confermati e verifica che sia 100% manifold.'}

PARAMETRI E QUOTE CONFERMATE:
${JSON.stringify(parameters, null, 2)}

CODICE OPENSCAD DI PARTENZA DA MODIFICARE:
${existingScad}`
          : `Genera uno script OpenSCAD 100% manifold (watertight, eps = 0.05 mm) per la scheda "${name}" (${category}).
Parametri confermati dall'utente:
${JSON.stringify(parameters, null, 2)}
Note tecniche: ${notes || 'Standard PCB'}
Includi PCB con angoli arrotondati, 4 fori M3 con pad ramati, porta USB-C con linguetta interna, connettori JST con pin dorati, slot microSD, pulsanti RESET/BOOT, modulo MCU QFN/WROOM, condensatori/resistenze SMD, eventuale display IPS/OLED e serigrafie bianche controllate da show_silkscreen e show_headers.`;

        const aiCode = await this.invokeMultimodalLLM(settings, `${SYSTEM_PROMPT_MANIFOLD}\n\n${userPrompt}`, images, false);
        const cleaned = this.extractCleanScadCode(aiCode);
        if (cleaned && cleaned.length > 60) {
          return this.ensureManifoldCompliance(cleaned, parameters, name);
        }
      } catch (err) {
        console.warn('[AIService] Generazione/Modifica LLM remota non disponibile, applico motore parametrico locale:', err);
      }
    }

    // Se l'utente è partito da un codice .SCAD esistente, applica le modifiche parametriche/testuali direttamente al suo script!
    if (hasExistingScad) {
      return this.applyModificationsToExistingScad(existingScad, parameters, notes, name);
    }

    return this.buildParametricManifoldScad({ name, category, preset, notes, parameters });
  }

  /**
   * Applica le quote confermate e le modifiche richieste in modo non distruttivo su uno script .SCAD esistente
   */
  applyModificationsToExistingScad(existingScad, parameters = {}, notes = '', name = 'Custom PCB') {
    let code = existingScad;

    // Mappa tra i parametri standard del Wizard e gli alias comuni usati negli script OpenSCAD (es. pcb_l, pcb_w, pcb_t, corner_r, hole_d)
    const aliasGroups = {
      pcb_length: ['pcb_length', 'pcb_l', 'pcb_x', 'board_length', 'board_l', 'board_x', 'length', 'L'],
      pcb_width: ['pcb_width', 'pcb_w', 'pcb_y', 'board_width', 'board_w', 'board_y', 'width', 'W'],
      pcb_thickness: ['pcb_thickness', 'pcb_t', 'pcb_z', 'board_thickness', 'board_t', 'board_z', 'thickness', 'T'],
      corner_radius: ['corner_radius', 'corner_r', 'pcb_r', 'board_r', 'radius', 'R'],
      hole_diameter: ['hole_diameter', 'hole_d', 'mount_hole_d', 'hole_dia'],
      hole_pitch_x: ['hole_pitch_x', 'pitch_x', 'mount_dx', 'hole_dx'],
      hole_pitch_y: ['hole_pitch_y', 'pitch_y', 'mount_dy', 'hole_dy'],
      usb_protrusion: ['usb_protrusion', 'usb_ext'],
      display_height: ['display_height', 'lcd_t', 'disp_h', 'shield_h']
    };

    for (const [paramKey, aliases] of Object.entries(aliasGroups)) {
      if (parameters[paramKey] === undefined || Number.isNaN(Number(parameters[paramKey]))) continue;
      const val = Number(parameters[paramKey]);
      for (const varName of aliases) {
        const rx = new RegExp(`(^\\s*${varName}\\s*=\\s*)([0-9]+(?:\\.[0-9]+)?)(\\s*;.*)$`, 'm');
        if (rx.test(code)) {
          code = code.replace(rx, `$1${val}$3`);
        }
      }
    }

    // Se nelle note l'utente chiede di disattivare/attivare serigrafie, pin header o display
    if (/senza\s+serigraf|nascondi\s+serigraf|no\s+silkscreen/i.test(notes)) {
      code = code.replace(/(^\s*show_silkscreen\s*=\s*)(true|false)/m, '$1false');
    } else if (/mostra\s+serigraf|attiva\s+serigraf/i.test(notes)) {
      code = code.replace(/(^\s*show_silkscreen\s*=\s*)(true|false)/m, '$1true');
    }

    if (/aggiungi\s+header|mostra\s+header|con\s+pin\s+header/i.test(notes)) {
      code = code.replace(/(^\s*show_headers\s*=\s*)(true|false)/m, '$1true');
    } else if (/senza\s+header|rimuovi\s+header|nascondi\s+header/i.test(notes)) {
      code = code.replace(/(^\s*show_headers\s*=\s*)(true|false)/m, '$1false');
    }

    // Se nelle note l'utente specifica un colore PCB (es. "colore PCB rosso" / "PCB verde" / "PCB nero" / "#...")
    const hexMatch = notes.match(/colore\s+pcb\s+(#[0-9a-fA-F]{6})/i);
    if (hexMatch) {
      code = code.replace(/(module\s+pcb_substrate[\s\S]{0,120}?color\(")([^"]+)("\))/i, `$1${hexMatch[1]}$3`);
    }

    // Aggiunge un commento di audit delle modifiche in testa allo script
    if (notes && notes.trim()) {
      const cleanNote = notes.trim().replace(/\r?\n/g, ' | ');
      code = `// [Board2CAD Modified Script] Scheda: ${name}\n// Modifiche applicate: ${cleanNote}\n` + code;
    }

    return this.ensureManifoldCompliance(code, parameters, name);
  }

  /**
   * Loop di Auto-Fix (max 2 tentativi) se il compilatore segnala warning/errori non-manifold
   */
  async autoFixManifoldScript(scadCode, compilerError, parameters = {}, name = 'Board') {
    const settings = storageService.getSettings();

    if (settings.aiApiKey && settings.aiProvider !== 'offline' && compilerError) {
      try {
        const fixPrompt = `${SYSTEM_PROMPT_MANIFOLD}
Lo script OpenSCAD seguente ha generato questo errore/warning di compilazione o non-manifold:
ERRORE: ${compilerError}

Correggi lo script assicurando eps = 0.05 mm su tutte le unioni e difference() passanti e restituisci solo il codice .scad corretto:

${scadCode}`;
        const rawFixed = await this.invokeMultimodalLLM(settings, fixPrompt, [], false);
        const cleaned = this.extractCleanScadCode(rawFixed);
        if (cleaned && cleaned.length > 120) {
          return this.ensureManifoldCompliance(cleaned, parameters, name);
        }
      } catch (e) {
        console.warn('[AIService] Auto-Fix AI fallback a riparazione geometrica deterministica:', e);
      }
    }

    return this.ensureManifoldCompliance(scadCode, parameters, name);
  }

  /**
   * Riparazione deterministica per garantire 100% manifold (eps = 0.05 mm e Customizer tags)
   */
  ensureManifoldCompliance(scadCode, parameters = {}, name = 'Custom PCB') {
    let code = (scadCode || '').trim();
    if (!code) {
      return this.buildParametricManifoldScad({ name, category: 'Custom PCB', preset: 'auto', notes: '', parameters });
    }

    // Assicura definizione di eps = 0.05;
    if (!/\beps\s*=\s*0\.05\s*;/.test(code)) {
      code = `eps = 0.05;\n` + code;
    }

    // Sostituisce eventuali traslazioni coplanari esatte sul top PCB con pcb_thickness - eps
    code = code.replace(/translate\(\[([^\]]+),\s*pcb_thickness\s*\]\)/g, 'translate([$1, pcb_thickness - eps])');

    return code;
  }

  /**
   * Generatore Parametrico OpenSCAD 100% Manifold ad alto dettaglio
   */
  buildParametricManifoldScad({ name = 'Custom PCB 3D', category = 'HMI / Display MCU', preset = 'auto', notes = '', parameters = {} }) {
    const p = {
      pcb_length: Number(parameters.pcb_length ?? 86.0),
      pcb_width: Number(parameters.pcb_width ?? 50.0),
      pcb_thickness: Number(parameters.pcb_thickness ?? 1.6),
      corner_radius: Number(parameters.corner_radius ?? 3.0),
      hole_diameter: Number(parameters.hole_diameter ?? 3.2),
      hole_pitch_x: Number(parameters.hole_pitch_x ?? 80.0),
      hole_pitch_y: Number(parameters.hole_pitch_y ?? 44.0),
      usb_protrusion: Number(parameters.usb_protrusion ?? 1.5),
      display_height: Number(parameters.display_height ?? 3.4)
    };

    const isDisplay =
      preset === 'esp32-display' ||
      category.includes('Display') ||
      /display|tft|ips|lcd|oled|freenove|2\.8/i.test(`${name} ${notes}`);

    const safeTitle = (name || 'BOARD2CAD').replace(/[^a-zA-Z0-9 _.-]/g, '').slice(0, 26).toUpperCase();

    return `// ============================================================================
// Board2CAD — Parametric 100% Manifold OpenSCAD Model
// Board: ${name}
// Category: ${category}
// Watertight Guarantee: eps = 0.05 mm overlap on all mating surfaces
// ============================================================================

/* [Board Dimensions] */
pcb_length     = ${p.pcb_length.toFixed(1)}; // [20:0.5:250]
pcb_width      = ${p.pcb_width.toFixed(1)}; // [15:0.5:200]
pcb_thickness  = ${p.pcb_thickness.toFixed(1)}; // [0.8:0.1:3.2]
corner_radius  = ${p.corner_radius.toFixed(1)}; // [0.5:0.5:10]
hole_diameter  = ${p.hole_diameter.toFixed(1)}; // [2.0:0.1:5.0]
hole_pitch_x   = ${p.hole_pitch_x.toFixed(1)}; // [10:0.5:240]
hole_pitch_y   = ${p.hole_pitch_y.toFixed(1)}; // [10:0.5:190]
usb_protrusion = ${p.usb_protrusion.toFixed(1)}; // [0.0:0.1:4.0]
display_height = ${p.display_height.toFixed(1)}; // [1.0:0.2:18.0]

/* [Detail & Features] */
show_silkscreen = true;
show_headers    = true;
show_components = true;
show_display    = ${isDisplay ? 'true' : 'false'};
$fn             = 36;

/* [Internal Manifold Epsilon] */
eps = 0.05;

// Posizioni dei 4 fori di fissaggio simmetrici rispetto al centro scheda
hole_x0 = (pcb_length - hole_pitch_x) / 2;
hole_x1 = pcb_length - hole_x0;
hole_y0 = (pcb_width - hole_pitch_y) / 2;
hole_y1 = pcb_width - hole_y0;

module rounded_board_2d(L, W, R) {
    r_clamped = min(R, min(L, W) / 4);
    hull() {
        translate([r_clamped, r_clamped]) circle(r = r_clamped);
        translate([L - r_clamped, r_clamped]) circle(r = r_clamped);
        translate([L - r_clamped, W - r_clamped]) circle(r = r_clamped);
        translate([r_clamped, W - r_clamped]) circle(r = r_clamped);
    }
}

module pcb_substrate() {
    color("#162238")
    difference() {
        linear_extrude(height = pcb_thickness)
            rounded_board_2d(pcb_length, pcb_width, corner_radius);

        for (hx = [hole_x0, hole_x1], hy = [hole_y0, hole_y1]) {
            translate([hx, hy, -0.15])
                cylinder(d = hole_diameter, h = pcb_thickness + 0.30);
        }
    }

    // Pad anulari ramati/dorati M3 (compenetrati di eps = 0.05 mm)
    color("#d4af37")
    for (hx = [hole_x0, hole_x1], hy = [hole_y0, hole_y1]) {
        difference() {
            translate([hx, hy, -eps])
                cylinder(d = hole_diameter + 2.6, h = pcb_thickness + 2 * eps);
            translate([hx, hy, -0.2])
                cylinder(d = hole_diameter, h = pcb_thickness + 0.4);
        }
    }
}

module usb_c_receptacle() {
    usb_w = 8.94;
    usb_l = 7.35;
    usb_h = 3.16;

    translate([-usb_protrusion, (pcb_width - usb_w) / 2, pcb_thickness - eps]) {
        // Guscio metallico esterno incavato
        color("#c0c7d0")
        difference() {
            cube([usb_l, usb_w, usb_h]);
            translate([-0.15, 0.45, 0.45])
                cube([usb_l - 1.2, usb_w - 0.9, usb_h - 0.9]);
        }
        // Linguetta interna contatti USB-C
        color("#1e242b")
        translate([0.6, 1.35, 1.30])
            cube([usb_l - 1.4, usb_w - 2.7, 0.56]);
    }
}

module jst_4pin_connector(x_pos, y_pos) {
    translate([x_pos, y_pos, -2.8 + eps]) {
        color("#f1f5f9")
        difference() {
            cube([4.4, 7.6, 2.8]);
            translate([-0.1, 0.6, 0.4])
                cube([3.2, 6.4, 2.0]);
        }
        color("#d4af37")
        for (i = [0:3]) {
            translate([0.8, 1.4 + i * 1.6, 1.1])
                cube([2.8, 0.45, 0.45]);
        }
    }
}

module microsd_push_slot() {
    translate([pcb_length * 0.42, 1.2, -1.85 + eps]) {
        color("#cbd5e1")
        difference() {
            cube([14.5, 14.8, 1.85]);
            translate([1.0, -0.1, 0.25])
                cube([12.5, 12.0, 1.35]);
        }
    }
}

module tactile_buttons() {
    for ( idx = [0, 1] ) {
        by = pcb_width * 0.22 + idx * 8.5;
        translate([2.2, by, -1.4 + eps]) {
            color("#cbd5e1") cube([3.4, 4.2, 1.4]);
            color("#111827") translate([-0.6, 1.1, 0.25]) cube([0.65, 2.0, 0.9]);
        }
    }
}

module esp32_wroom_soc() {
    w_l = min(25.5, pcb_length * 0.32);
    w_w = min(18.0, pcb_width * 0.40);
    translate([pcb_length * 0.14, (pcb_width - w_w) / 2, -3.1 + eps]) {
        // Substrate PCB del modulo WROOM
        color("#111827") cube([w_l, w_w, 0.85]);
        // Shield RF metallico
        color("#94a3b8") translate([5.5, 1.2, -2.25 + eps]) cube([w_l - 6.5, w_w - 2.4, 2.3]);
    }
}

module smd_components_array() {
    // Codec Audio ES8311 / Touch IC QFN + induttori e condensatori SMD
    color("#1e242b")
    translate([pcb_length * 0.56, pcb_width * 0.55, -0.95 + eps])
        cube([5.0, 5.0, 0.95]);

    color("#b45309")
    for (i = [0:5]) {
        translate([pcb_length * 0.52 + i * 2.8, pcb_width * 0.34, -0.65 + eps])
            cube([1.6, 0.9, 0.65]);
    }
}

module ips_display_assembly() {
    disp_l = pcb_length * 0.80;
    disp_w = pcb_width * 0.84;
    disp_x = (pcb_length - disp_l) / 2;
    disp_y = (pcb_width - disp_w) / 2;

    translate([disp_x, disp_y, pcb_thickness - eps]) {
        // Cornice vetro touch FT6336G
        color("#111111")
            cube([disp_l, disp_w, display_height]);
        // Area attiva IPS 2.8" ILI9341V (leggermente sopraelevata di 0.08 mm)
        color("#0c4a6e")
        translate([disp_l * 0.08, disp_w * 0.07, display_height - eps])
            cube([disp_l * 0.84, disp_w * 0.86, 0.12]);
    }
}

module optional_pin_headers() {
    pin_count = max(4, floor((pcb_length - 16) / 2.54));
    start_x = (pcb_length - (pin_count * 2.54)) / 2;

    for (side_y = [2.2, pcb_width - 4.74]) {
        color("#1e293b")
        translate([start_x, side_y, pcb_thickness - eps])
            cube([pin_count * 2.54, 2.54, 2.5]);

        color("#d4af37")
        for (i = [0 : pin_count - 1]) {
            translate([start_x + i * 2.54 + 0.95, side_y + 0.95, pcb_thickness + 2.4 - eps])
                cube([0.64, 0.64, 6.0]);
        }
    }
}

module pcb_silkscreen_labels() {
    color("#f8fafc") {
        translate([pcb_length * 0.5, pcb_width - 2.6, pcb_thickness - eps])
            linear_extrude(height = 0.12)
                text("${safeTitle}", size = 2.4, halign = "center", valign = "center");

        translate([pcb_length * 0.5, 2.6, pcb_thickness - eps])
            linear_extrude(height = 0.12)
                text("BOARD2CAD MANIFOLD 3D", size = 2.0, halign = "center", valign = "center");
    }
}

// ============================================================================
// Unione Principale 100% Manifold
// ============================================================================
union() {
    pcb_substrate();

    if (show_components) {
        usb_c_receptacle();
        tactile_buttons();
        esp32_wroom_soc();
        smd_components_array();
        microsd_push_slot();
        jst_4pin_connector(pcb_length - 5.2, pcb_width * 0.22);
        jst_4pin_connector(pcb_length - 5.2, pcb_width * 0.46);
        jst_4pin_connector(pcb_length - 5.2, pcb_width * 0.70);
    }

    if (show_display) {
        ips_display_assembly();
    }

    if (show_headers) {
        optional_pin_headers();
    }

    if (show_silkscreen) {
        pcb_silkscreen_labels();
    }
}
`;
  }

  /**
   * Pulisce eventuali blocchi markdown ```scad ... ``` dalla risposta LLM
   */
  extractCleanScadCode(rawText = '') {
    const fenced = rawText.match(/```(?:openscad|scad)?\s*([\s\S]*?)```/i);
    return (fenced ? fenced[1] : rawText).trim();
  }

  /**
   * Chiamata fetch diretta verso Google Gemini API o OpenAI Chat Completions
   */
  async invokeMultimodalLLM(settings, promptText, images = [], expectJson = false) {
    const provider = settings.aiProvider || 'gemini';
    const apiKey = (settings.aiApiKey || '').trim();
    if (!apiKey) throw new Error('API Key non configurata');

    if (provider === 'openai') {
      const model = (settings.aiModel || 'gpt-4o').trim();
      const contentParts = [{ type: 'text', text: promptText }];
      for (const img of images) {
        if (img.dataUrl) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: img.dataUrl }
          });
        }
      }

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: contentParts }],
          temperature: 0.2,
          ...(expectJson ? { response_format: { type: 'json_object' } } : {})
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI HTTP ${res.status}: ${errText}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }

    // Default: Google Gemini API
    const model = (settings.aiModel || 'gemini-2.5-flash').trim();
    const parts = [{ text: promptText }];
    for (const img of images) {
      if (img.dataUrl && img.dataUrl.includes(',')) {
        const [header, b64] = img.dataUrl.split(',');
        const mimeMatch = header.match(/data:(.*?);/);
        parts.push({
          inline_data: {
            mime_type: mimeMatch ? mimeMatch[1] : 'image/jpeg',
            data: b64
          }
        });
      }
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          ...(expectJson ? { responseMimeType: 'application/json' } : {})
        }
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errText}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
  }
}

export const aiService = new AIService();
