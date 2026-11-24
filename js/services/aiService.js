/**
 * Board2CAD — AI Vision & OpenSCAD Parametric Generator Service (js/services/aiService.js)
 * Authentic Multimodal Vision Analysis (Google Gemini Vision / OpenAI GPT-4o Vision)
 * + Existing OpenSCAD (.scad) Code Modification Engine.
 *
 * ZERO Hardcoded Board Templates: Never substitutes fake ESP32/Freenove models.
 */

import { storageService } from './storageService.js';

/**
 * Calcola le nuove dimensioni proporzionali garantendo che il lato più lungo non superi maxSide (default 1024 px)
 * senza mai ingrandire immagini già più piccole.
 */
export function computeScaledDimensions(width, height, maxSide = 1024) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w <= 0 || h <= 0) {
    return { width: maxSide, height: maxSide };
  }
  if (w <= maxSide && h <= maxSide) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  if (w >= h) {
    return {
      width: maxSide,
      height: Math.max(1, Math.round((h * maxSide) / w))
    };
  }
  return {
    width: Math.max(1, Math.round((w * maxSide) / h)),
    height: maxSide
  };
}

const SYSTEM_PROMPT_MANIFOLD = `Sei un Senior CAD Automation Engineer specializzato nella modellazione 3D OpenSCAD ad alta fedeltà di schede elettroniche reali (PCB 3D Mechanical & Visual Models) a partire da fotografie e disegni tecnici quotati.

REGOLE FERREE E TASSATIVE:
1. ANALISI VISIVA AUTENTICA E FEDELTÀ ALLA FOTO:
   - Osserva attentamente le immagini allegate nel payload multimodale.
   - Leggi le quote reali direttamente dalle immagini (es. per un Arduino Uno R3: 68.6 mm × 53.4 mm, oppure le quote esatte stampate sul disegno quotato caricato) e rispetta rigorosamente i parametri confermati dall'utente.
   - Identifica e modella ESCLUSIVAMENTE i componenti realmente visibili nelle foto caricate, posizionandoli nelle coordinate (X, Y, Z) corrispondenti alla foto reale e con i loro colori realistici:
     * Esempio se vedi un Arduino Uno R3: PCB blu (#005c99 / #0e6ba8) con la sagoma/spalla caratteristica sul lato destro e 4 fori M3 (3.2 mm), connettore USB-B grande argentato (#cbd5e1) sul lato sinistro superiore, Jack DC cilindrico nero (#171717) sul lato sinistro inferiore, microcontrollore ATmega328P in package DIP-28 lungo nero su zoccolo a 28 pin nel quadrante inferiore destro, pin header femmina neri 2.54mm lungo i bordi superiore e inferiore, header ICSP 2x3 pin, pulsante RESET nell'angolo in alto a sinistra, quarzo metallico ovale 16MHz (#d1d5db), due condensatori elettrolitici cilindrici verticali vicino al jack DC, chip QFN ATmega16U2 vicino alla USB-B, LED SMD e serigrafie bianche ("ARDUINO", "UNO", "DIGITAL (PWM~)", "POWER", "ANALOG IN", "RESET", "ICSP").
     * Se vedi un'altra scheda (es. modulo relè, sensore breakout, display TFT, Arduino Nano, ESP32, Raspberry Pi, PCB custom), modella SOLO i componenti effettivamente presenti su quella specifica scheda.

2. ZERO MODULI ESTRANEI (DIVIETO ASSOLUTO DI TEMPLATE PRECONFEZIONATI):
   - NON includere MAI display IPS/LCD/OLED, slot microSD, connettori JST o moduli ESP32-WROOM se NON sono visibili nelle foto caricate!
   - Non usare mai template generici di altre schede cambiando solo la scritta serigrafica. Ogni modulo OpenSCAD deve corrispondere a un componente reale visibile nell'immagine allegata.

3. ORIENTAMENTO CORRETTO DEI CONNETTORI VERSO L'ESTERNO:
   - Tutte le aperture/imbocchi dei connettori periferici (porta USB-B, USB-C, Micro-USB, Jack DC cilindrico di alimentazione, connettori JST, morsettiere, slot microSD, RJ45) devono avere la cavità/apertura rivolta verso il PERIMETRO ESTERNO del PCB (aperta verso l'esterno del bordo su cui il connettore è montato, mai rivolta verso l'interno della scheda!).
   - Se è presente uno slot microSD senza linguetta sporgente, il suo bordo frontale di inserimento deve essere dritto e a filo con il bordo del PCB.

4. GEOMETRIA 100% MANIFOLD (WATERTIGHT — ZERO FACCE COPLANARI):
   - Definisci sempre in testa allo script: eps = 0.05;
   - Ogni componente appoggiato sulla faccia superiore del PCB deve compenetrare nel PCB di 0.05 mm: usa sempre z = pcb_thickness - eps (es. translate([x, y, pcb_thickness - eps])).
   - Ogni componente o pin sulla faccia inferiore deve compenetrare di +eps dentro z = 0.
   - Tutti i fori passanti in difference() devono partire da z = -0.1 ed avere altezza pcb_thickness + 0.2 (o più) per tagliare nettamente le superfici senza facce coplanari.

5. PARAMETRI CUSTOMIZER E COLORI SEMANTICI PER .3MF MULTICOLORE:
   - Includi sempre all'inizio dello script i blocchi Customizer con le variabili principali della scheda:
     /* [Board Dimensions] */
     pcb_length = ...;
     pcb_width = ...;
     pcb_thickness = ...;
     corner_radius = ...;
     hole_diameter = ...;
     /* [Detail & Features] */
     show_silkscreen = true;
     show_headers = true;
     show_components = true;
     $fn = 36;
     eps = 0.05;
   - Usa chiamate esplicite color("#RRGGBB") su ogni componente (PCB, pad dorati/ramati #d4af37, metalli/USB/quarzo #cbd5e1, plastica nera IC/header/jack #171717, condensatori, serigrafie #f8fafc).
   - Usa esclusivamente sintassi OpenSCAD nativa valida (module, function, union, difference, intersection, hull, linear_extrude, translate, rotate, scale, mirror, color, cube, cylinder, sphere, circle, square, polygon, text, for, if/else).
   - Restituisci SOLO il codice OpenSCAD completo e pronto alla compilazione.`;

export class AIService {
  /**
   * Step 2 del Wizard: Ispeziona le immagini caricate (e/o il codice .SCAD esistente).
   * - Se l'utente parte da foto senza codice .SCAD, richiede obbligatoriamente una API Key AI valida
   *   e invia le immagini in Base64 al modello multimodale per leggere quote e componenti reali.
   * - Se manca l'API Key o la chiamata fallisce, lancia un errore esplicito all'utente (zero fallback finti!).
   */
  async analyzeBoardImages({ name, category, preset, notes, images = [], existingScad = '' }) {
    const settings = storageService.getSettings();
    const hasExistingScad = Boolean(existingScad && existingScad.trim().length > 20);
    const parsedFromInput = this.extractDimensionsFromNotesAndScad(notes, existingScad);

    // Caso A: L'utente ha fornito un codice .SCAD esistente e non ha configurato un'API Key (o è in modalità offline)
    if (hasExistingScad && (!settings.aiApiKey || settings.aiProvider === 'offline')) {
      return this.buildScadOnlyClarificationPlan({
        name,
        notes,
        existingScad,
        parsedFromInput
      });
    }

    // Caso B: Generazione da Foto / Note -> Richiede API Key AI Vision valida (Zero mock / Zero template ESP32 finti!)
    if (!settings.aiApiKey || settings.aiProvider === 'offline') {
      throw new Error(
        'API Key AI Vision non configurata. Apri le Impostazioni (icona ingranaggio in alto a destra), seleziona Google Gemini o OpenAI e inserisci la tua API Key per analizzare le foto della scheda.'
      );
    }

    if (!hasExistingScad && (!images || images.length === 0) && !notes.trim()) {
      throw new Error(
        'Carica almeno una foto/disegno quotato della scheda (oppure incolla un codice .SCAD di partenza) prima di avviare l\'analisi.'
      );
    }

    // Chiamata autentica all'API Vision multimodale allegando le immagini in Base64
    return await this.callVisionAnalysisAPI(settings, {
      name,
      category,
      preset,
      notes,
      images,
      existingScad,
      parsedFromInput
    });
  }

  /**
   * Estrae eventuali quote esplicite scritte dall'utente nelle note o presenti nel codice .SCAD di partenza.
   * NON restituisce alcun template o dimensione hardcodata di altre schede!
   */
  extractDimensionsFromNotesAndScad(notes = '', existingScad = '') {
    const extracted = {
      pcb_length: null,
      pcb_width: null,
      pcb_thickness: 1.6,
      corner_radius: 1.5,
      hole_diameter: 3.2,
      hole_pitch_x: null,
      hole_pitch_y: null
    };

    // 1. Legge variabili reali se c'è un codice .SCAD di partenza
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

      if (sLen !== null) extracted.pcb_length = sLen;
      if (sWid !== null) extracted.pcb_width = sWid;
      if (sThk !== null) extracted.pcb_thickness = sThk;
      if (sRad !== null) extracted.corner_radius = sRad;
      if (sHoleD !== null) extracted.hole_diameter = sHoleD;
      if (sPitchX !== null) extracted.hole_pitch_x = sPitchX;
      if (sPitchY !== null) extracted.hole_pitch_y = sPitchY;
    }

    // 2. Legge eventuali quote esplicite scritte dall'utente nelle note (es. "68.6 x 53.4")
    const dimMatch = (notes || '').match(/(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i);
    if (dimMatch) {
      const d1 = parseFloat(dimMatch[1].replace(',', '.'));
      const d2 = parseFloat(dimMatch[2].replace(',', '.'));
      if (d1 >= 5 && d2 >= 5) {
        extracted.pcb_length = Math.max(d1, d2);
        extracted.pcb_width = Math.min(d1, d2);
      }
    }

    const pitchMatch = (notes || '').match(/interasse\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i);
    if (pitchMatch) {
      extracted.hole_pitch_x = parseFloat(pitchMatch[1].replace(',', '.'));
      extracted.hole_pitch_y = parseFloat(pitchMatch[2].replace(',', '.'));
    }

    const thickMatch = (notes || '').match(/spessore\s*(\d+(?:[.,]\d+)?)/i);
    if (thickMatch) {
      extracted.pcb_thickness = parseFloat(thickMatch[1].replace(',', '.'));
    }

    return extracted;
  }

  /**
   * Piano di verifica quote quando l'utente parte esclusivamente da un proprio file .SCAD esistente (senza AI)
   */
  buildScadOnlyClarificationPlan({ name, existingScad, parsedFromInput }) {
    const pLen = parsedFromInput.pcb_length ?? 68.6;
    const pWid = parsedFromInput.pcb_width ?? 53.4;
    const pThk = parsedFromInput.pcb_thickness ?? 1.6;
    const pRad = parsedFromInput.corner_radius ?? 1.5;
    const pHole = parsedFromInput.hole_diameter ?? 3.2;

    return {
      needsClarification: false,
      hasExistingScad: true,
      detectedComponents: ['Script OpenSCAD fornito dall\'utente'],
      summary: `Codice OpenSCAD di partenza rilevato (${existingScad.split(/\r?\n/).length} righe, PCB ${pLen} × ${pWid} mm). Verifica o modifica le quote estratte dallo script prima della compilazione 3D:`,
      questions: [
        { id: 'pcb_length', label: 'Lunghezza PCB (Asse X)', unit: 'mm', type: 'number', min: 5, max: 400, step: 0.1, suggestedValue: pLen },
        { id: 'pcb_width', label: 'Larghezza PCB (Asse Y)', unit: 'mm', type: 'number', min: 5, max: 400, step: 0.1, suggestedValue: pWid },
        { id: 'pcb_thickness', label: 'Spessore Laminato PCB (Asse Z)', unit: 'mm', type: 'number', min: 0.4, max: 5.0, step: 0.1, suggestedValue: pThk },
        { id: 'hole_diameter', label: 'Diametro Fori di Fissaggio', unit: 'mm', type: 'number', min: 1.0, max: 8.0, step: 0.1, suggestedValue: pHole },
        { id: 'corner_radius', label: 'Raggio Raccordo Angoli PCB', unit: 'mm', type: 'number', min: 0, max: 20, step: 0.5, suggestedValue: pRad }
      ]
    };
  }

  /**
   * Step 2: Chiamata multimodale autentica (Gemini Vision / OpenAI Vision).
   * Invia le immagini reali in Base64 e chiede all'AI di leggere le quote stampate nell'immagine
   * e identificare i componenti effettivamente visibili sulla scheda.
   */
  async callVisionAnalysisAPI(settings, { name, category, notes, images = [], existingScad = '', parsedFromInput }) {
    const scadContext = existingScad && existingScad.trim()
      ? `\nCODICE OPENSCAD DI PARTENZA FORNITO DALL'UTENTE:\n${existingScad.slice(0, 6000)}\n`
      : '';

    const notesHint = notes && notes.trim()
      ? `\nNOTE / ISTRUZIONI DELL'UTENTE: "${notes.trim()}"`
      : '';

    const prompt = `Esamina con estrema attenzione le immagini allegate di questa scheda elettronica (Nome indicato: "${name}", Categoria: "${category}").${notesHint}${scadContext}

COMPITO DI ANALISI VISIVA (CLARIFICATION FIRST):
1. Leggi TUTTE le quote numeriche (in mm o pollici convertiti in mm) direttamente dalle frecce di quotatura o dal testo visibile nell'immagine allegata (ad esempio se nell'immagine sono quotati 68.6mm e 53.4mm per un Arduino Uno R3, usa esattamente 68.6 e 53.4!).
2. Riconosci il modello esatto della scheda e tutti i componenti realmente presenti nella foto (es. colore e forma del PCB, tipo e posizione del connettore USB-B / USB-C / Micro-USB, eventuale Jack DC cilindrico, chip DIP su zoccolo o SMD QFN/SOIC, pin header femmina o maschi, pulsante RESET, quarzo, condensatori, fori di fissaggio e relative coordinate).
3. NON inventare componenti che non sono presenti nella foto (non citare mai display IPS, microSD, JST o ESP32 se nella foto c'è un Arduino Uno o un'altra scheda!).
4. Restituisci un oggetto JSON valido con questa struttura:
{
  "needsClarification": true,
  "boardIdentified": "Nome esatto della scheda riconosciuta dalla foto",
  "pcbColorHex": "#005c99",
  "detectedComponents": [
    "Elenco dettagliato di ogni componente reale visto nella foto con la sua posizione e dimensione stimata in mm"
  ],
  "summary": "Sintesi tecnica precisa di ciò che si vede nell'immagine allegata e delle quote lette direttamente dalla foto",
  "questions": [
    { "id": "pcb_length", "label": "Lunghezza Totale PCB (letta dalla foto, Asse X)", "unit": "mm", "type": "number", "min": 5, "max": 400, "step": 0.1, "suggestedValue": <numero_letto_dalla_foto> },
    { "id": "pcb_width", "label": "Larghezza Totale PCB (letta dalla foto, Asse Y)", "unit": "mm", "type": "number", "min": 5, "max": 400, "step": 0.1, "suggestedValue": <numero_letto_dalla_foto> },
    { "id": "pcb_thickness", "label": "Spessore PCB FR4", "unit": "mm", "type": "number", "min": 0.6, "max": 3.2, "step": 0.1, "suggestedValue": 1.6 },
    { "id": "hole_diameter", "label": "Diametro Fori di Montaggio", "unit": "mm", "type": "number", "min": 1.5, "max": 6.0, "step": 0.1, "suggestedValue": 3.2 },
    { "id": "corner_radius", "label": "Raggio Raccordo Angoli PCB", "unit": "mm", "type": "number", "min": 0, "max": 12, "step": 0.5, "suggestedValue": 1.0 }
  ]
}
Puoi aggiungere nell'array "questions" altri 1-3 parametri specifici della scheda vista in foto se sono utili per l'ingombro meccanico (es. sporgenza connettore USB/Jack DC o altezza pin header/zoccolo).`;

    const rawText = await this.invokeMultimodalLLM(settings, prompt, images, true);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('L\'API AI Vision non ha restituito un JSON di analisi valido. Riprova o verifica il modello selezionato nelle Impostazioni.');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Se l'utente aveva già scritto esplicitamente delle quote nelle note, assicuriamoci che siano proposte
    if (Array.isArray(parsed.questions)) {
      for (const q of parsed.questions) {
        if (q.id === 'pcb_length' && parsedFromInput.pcb_length !== null && (!q.suggestedValue || q.suggestedValue <= 0)) {
          q.suggestedValue = parsedFromInput.pcb_length;
        }
        if (q.id === 'pcb_width' && parsedFromInput.pcb_width !== null && (!q.suggestedValue || q.suggestedValue <= 0)) {
          q.suggestedValue = parsedFromInput.pcb_width;
        }
      }
    }

    return {
      ...parsed,
      hasExistingScad: Boolean(existingScad && existingScad.trim().length > 20)
    };
  }

  /**
   * Step 3 del Wizard: Genera o modifica lo script OpenSCAD 100% manifold.
   * Allega SEMPRE le immagini originali in Base64 insieme alle quote confermate e alla lista componenti rilevati nello Step 2!
   */
  async generateOpenSCAD({
    name,
    category,
    preset,
    notes,
    parameters,
    images = [],
    existingScad = '',
    analysisContext = null
  }) {
    const settings = storageService.getSettings();
    const hasExistingScad = Boolean(existingScad && existingScad.trim().length > 20);

    // Se l'utente è in modalità offline e ha fornito un proprio script .SCAD esistente, applica le modifiche locali allo script
    if (hasExistingScad && (!settings.aiApiKey || settings.aiProvider === 'offline')) {
      return this.applyModificationsToExistingScad(existingScad, parameters, notes, name);
    }

    if (!settings.aiApiKey || settings.aiProvider === 'offline') {
      throw new Error(
        'API Key AI non configurata. Configura una API Key valida (Gemini o OpenAI) nelle Impostazioni per generare lo script OpenSCAD dalle foto.'
      );
    }

    const detectedSummary = analysisContext
      ? `\nSCHEDA RICONOSCIUTA NELLO STEP 2: ${analysisContext.boardIdentified || name}
COLORE PCB RILEVATO: ${analysisContext.pcbColorHex || 'come da foto'}
SINTESI VISIVA: ${analysisContext.summary || ''}
COMPONENTI REALI RILEVATI NELLA FOTO (MODELLA SOLO QUESTI, NESSUN COMPONENTE ESTRANEO!):
${(analysisContext.detectedComponents || []).map((c) => `- ${c}`).join('\n')}\n`
      : '';

    const userPrompt = hasExistingScad
      ? `Parti da questo script OpenSCAD esistente per la scheda "${name}" (${category}) e implementa TUTTE le modifiche richieste dall'utente mantenendo lo stile, i moduli esistenti e garantendo una mesh 100% manifold (watertight, eps = 0.05 mm).
${detectedSummary}
MODIFICHE RICHIESTE DALL'UTENTE:
${notes || 'Aggiorna le quote secondo i parametri confermati e verifica che sia 100% manifold.'}

PARAMETRI E QUOTE CONFERMATE DALL'UTENTE:
${JSON.stringify(parameters, null, 2)}

CODICE OPENSCAD DI PARTENZA DA MODIFICARE:
${existingScad}`
      : `Osserva attentamente le immagini allegate della scheda "${name}" (${category}) e genera lo script OpenSCAD 3D parametrico completo e 100% manifold (watertight, eps = 0.05 mm) che riproduce FEDELMENTE la scheda mostrata nella foto.
${detectedSummary}
PARAMETRI E QUOTE CONFERMATE DALL'UTENTE (USA ESATTAMENTE QUESTE MISURE IN TESTA ALLO SCRIPT):
${JSON.stringify(parameters, null, 2)}

NOTE UTENTE:
${notes || 'Riproduci fedelmente la scheda, la forma del PCB, i fori di fissaggio e tutti i componenti visibili nella foto.'}

VERIFICA FINALE PRIMA DI SCRIVERE IL CODICE:
1. Le dimensioni pcb_length (${parameters.pcb_length} mm) e pcb_width (${parameters.pcb_width} mm) devono corrispondere esattamente ai parametri confermati.
2. Modella SOLO i componenti realmente visibili nella foto allegata, nella loro posizione, forma e colore reale. NON inserire MAI display IPS, microSD, connettori JST o moduli ESP32 se non sono visibili nella foto!
3. Tutti i connettori sul bordo (es. USB-B, USB-C, Jack DC cilindrico, ecc.) devono avere l'imbocco/apertura rivolto verso l'ESTERNO del perimetro del PCB.
4. Ogni componente appoggiato sul PCB deve partire da z = pcb_thickness - eps (con eps = 0.05) per garantire una mesh 100% manifold senza facce coplanari.
5. Chiudi correttamente tutte le parentesi graffe { } e restituisci esclusivamente il codice OpenSCAD completo.`;

    const aiCode = await this.invokeMultimodalLLM(
      settings,
      `${SYSTEM_PROMPT_MANIFOLD}\n\n${userPrompt}`,
      images,
      false
    );

    const cleaned = this.extractCleanScadCode(aiCode);
    if (!cleaned || cleaned.length < 40) {
      throw new Error('Il modello AI ha restituito uno script OpenSCAD vuoto o incompleto.');
    }

    return this.ensureManifoldCompliance(cleaned);
  }

  /**
   * Applica le quote confermate e le modifiche richieste in modo non distruttivo su uno script .SCAD esistente dell'utente
   */
  applyModificationsToExistingScad(existingScad, parameters = {}, notes = '', name = 'Custom PCB') {
    let code = existingScad;

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

    if (notes && notes.trim()) {
      const cleanNote = notes.trim().replace(/\r?\n/g, ' | ');
      code = `// [Board2CAD Modified Script] Scheda: ${name}\n// Modifiche applicate: ${cleanNote}\n` + code;
    }

    return this.ensureManifoldCompliance(code);
  }

  /**
   * Loop di Auto-Fix (max 2 tentativi) se il compilatore OpenSCAD restituisce un vero errore di sintassi/compilazione
   */
  async autoFixManifoldScript(scadCode, compilerError, parameters = {}, name = 'Board', images = []) {
    const settings = storageService.getSettings();

    if (settings.aiApiKey && settings.aiProvider !== 'offline' && compilerError) {
      try {
        const fixPrompt = `${SYSTEM_PROMPT_MANIFOLD}

Lo script OpenSCAD seguente per la scheda "${name}" ha generato questo errore nel compilatore OpenSCAD:
ERRORE COMPILATORE: ${compilerError}

Correggi l'errore di sintassi o geometria mantenendo intatti tutti i componenti e le dimensioni della scheda (${JSON.stringify(parameters)}), assicurando eps = 0.05 mm su tutte le unioni e restituendo SOLO il codice .scad completo e corretto:

${scadCode}`;
        const rawFixed = await this.invokeMultimodalLLM(settings, fixPrompt, images, false);
        const cleaned = this.extractCleanScadCode(rawFixed);
        if (cleaned && cleaned.length > 60) {
          return this.ensureManifoldCompliance(cleaned);
        }
      } catch (e) {
        console.warn('[AIService] Auto-Fix AI call error:', e);
      }
    }

    return this.ensureManifoldCompliance(scadCode);
  }

  /**
   * Garantisce la presenza di eps = 0.05 e la compenetrazione non-coplanare senza mai sostituire lo script
   */
  ensureManifoldCompliance(scadCode) {
    let code = (scadCode || '').trim();
    if (!code) return '';

    if (!/\beps\s*=\s*[0-9.]+\s*;/.test(code)) {
      code = `eps = 0.05;\n` + code;
    }

    code = code.replace(/translate\(\[([^\]]+),\s*pcb_thickness\s*\]\)/g, 'translate([$1, pcb_thickness - eps])');
    return code;
  }

  /**
   * Pulisce eventuali blocchi markdown ```scad ... ``` dalla risposta LLM
   */
  extractCleanScadCode(rawText = '') {
    const fenced = rawText.match(/```(?:openscad|scad)?\s*([\s\S]*?)```/i);
    return (fenced ? fenced[1] : rawText).trim();
  }

  /**
   * Ridimensiona un File/Blob o DataURL su <canvas> offscreen mantenendo le proporzioni:
   * lato lungo <= maxSide (default 1024 px), export image/jpeg con qualità 0.85.
   * Riduce il peso del payload API di 5–10x preservando la leggibilità di pin, quote e serigrafie.
   */
  async optimizeImageToJpegDataUrl(fileOrDataUrl, maxSide = 1024, quality = 0.85) {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      if (typeof fileOrDataUrl === 'string') {
        const comma = fileOrDataUrl.indexOf(',');
        const b64Len = comma >= 0 ? fileOrDataUrl.length - comma - 1 : fileOrDataUrl.length;
        return {
          dataUrl: fileOrDataUrl,
          mimeType: 'image/jpeg',
          width: 0,
          height: 0,
          sizeKb: Math.max(1, Math.round((b64Len * 0.75) / 1024)),
          resized: false
        };
      }
      throw new Error('Ambiente canvas non disponibile per il ridimensionamento immagine.');
    }

    const isBlobInput = typeof Blob !== 'undefined' && fileOrDataUrl instanceof Blob;
    const objectUrl = isBlobInput ? URL.createObjectURL(fileOrDataUrl) : null;
    const srcUrl = isBlobInput ? objectUrl : String(fileOrDataUrl || '');

    try {
      const img = await new Promise((resolve, reject) => {
        const imageEl = new Image();
        imageEl.onload = () => resolve(imageEl);
        imageEl.onerror = () => reject(new Error('Impossibile decodificare l\'immagine caricata.'));
        imageEl.src = srcUrl;
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
      if (!ctx) {
        throw new Error('Impossibile ottenere il contesto 2D del canvas.');
      }

      // Sfondo bianco solido per evitare sfondi neri su PNG trasparenti convertiti in JPEG
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);

      const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
      const comma = jpegDataUrl.indexOf(',');
      const b64Len = comma >= 0 ? jpegDataUrl.length - comma - 1 : jpegDataUrl.length;
      const sizeKb = Math.max(1, Math.round((b64Len * 0.75) / 1024));

      return {
        dataUrl: jpegDataUrl,
        mimeType: 'image/jpeg',
        width,
        height,
        sizeKb,
        resized: true
      };
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  /**
   * Verifica se il modello Gemini supporta thinkingConfig.thinkingBudget (serie 2.5 / 3.x / thinking)
   */
  supportsThinkingBudget(modelName = '') {
    const m = String(modelName || '').trim();
    return /gemini-(?:2\.5|[3-9](?:\.\d+)?)/i.test(m) || /thinking/i.test(m);
  }

  /**
   * Compone in modo sincrono il prompt completo pronto per la copia negli appunti (Modalità Zero-API)
   */
  buildExternalChatPrompt({
    name = '',
    category = '',
    presetLabel = '',
    notes = '',
    existingScad = '',
    parameters = null,
    imageCount = 0
  }) {
    const cleanName = (name || '').trim() || 'Da rilevare dalle foto allegate';
    const cleanCategory = (category || '').trim() || 'Custom PCB';
    const cleanPreset = (presetLabel || '').trim() || 'Rilevamento Automatico';
    const cleanNotes =
      (notes || '').trim() || 'Rileva tutte le quote, i fori di fissaggio e i componenti reali direttamente dalle foto allegate.';

    const sections = [
      SYSTEM_PROMPT_MANIFOLD,
      '',
      '=== DATI SCHEDA INSERITI DALL\'UTENTE ===',
      `- Nome Scheda: ${cleanName}`,
      `- Categoria: ${cleanCategory}`,
      `- Modalità / Template: ${cleanPreset}`,
      `- Note Dimensionali / Modifiche Richieste: ${cleanNotes}`
    ];

    if (parameters && typeof parameters === 'object') {
      const entries = Object.entries(parameters).filter(([, v]) => v !== null && v !== undefined && !Number.isNaN(v));
      if (entries.length > 0) {
        sections.push(
          '- Quote Confermate (mm): ' + entries.map(([k, v]) => `${k}=${v}`).join(', ')
        );
      }
    }

    if (existingScad && existingScad.trim()) {
      sections.push(
        '',
        '=== CODICE OPENSCAD (.SCAD) DI PARTENZA DA MODIFICARE ===',
        existingScad.trim()
      );
    }

    sections.push(
      '',
      '=== ISTRUZIONI FINALI PER LA CHAT AI ===',
      `1. [Promemoria Utente] Allega a questo messaggio le foto/disegni quotati della scheda${imageCount > 0 ? ` (${imageCount} foto caricate in Board2CAD)` : ''}.`,
      '2. Analizza visivamente le immagini allegate rispettando tutte le quote reali, l\'orientamento verso l\'esterno dei connettori e la compenetrazione eps = 0.05 mm (zero componenti estranei non visibili in foto).',
      '3. Rispondi ESCLUSIVAMENTE con codice OpenSCAD (.scad) completo, valido e pronto da copiare e incollare direttamente in Board2CAD (Studio 3D -> Editor .SCAD) per la compilazione in .STL e .3MF, senza testo introduttivo né commenti fuori dal codice.'
    );

    return sections.join('\n');
  }

  /**
   * Chiamata fetch diretta verso Google Gemini API o OpenAI Chat Completions
   * Verifica, ridimensiona (<=1024px JPEG 0.85) e allega tutte le immagini nel payload multimodale!
   */
  async invokeMultimodalLLM(settings, promptText, images = [], expectJson = false) {
    const provider = settings.aiProvider || 'gemini';
    const apiKey = (settings.aiApiKey || '').trim();
    if (!apiKey) {
      throw new Error('API Key AI non configurata nelle Impostazioni.');
    }

    // Filtra e valida le immagini Base64 caricate dall'utente (ridimensionamento difensivo <= 1024px JPEG 0.85)
    const rawValidImages = (images || []).filter(
      (img) => img && typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:image/')
    );

    const validImages = [];
    for (const img of rawValidImages) {
      if (img.resized === true || typeof document === 'undefined') {
        validImages.push(img);
      } else {
        const optimized = await this.optimizeImageToJpegDataUrl(img.dataUrl, 1024, 0.85);
        validImages.push({ ...img, ...optimized });
      }
    }

    console.info(
      `[AIService] Invio richiesta multimodale a ${provider} (${settings.aiModel}) con ${validImages.length} immagini allegate.`
    );

    if (provider === 'openai') {
      const model = (settings.aiModel || 'gpt-4o').trim();
      const contentParts = [{ type: 'text', text: promptText }];
      for (const img of validImages) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: img.dataUrl,
            detail: 'high'
          }
        });
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
          temperature: 0.15,
          max_tokens: 8192,
          ...(expectJson ? { response_format: { type: 'json_object' } } : {})
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenAI API Error (HTTP ${res.status}): ${errText}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    }

    // Default: Google Gemini API (Multimodal Vision + Code Generation)
    const model = (settings.aiModel || 'gemini-2.5-flash').trim();
    const parts = [];

    // Inserisce prima tutte le immagini inline_data Base64 e poi il prompt testuale (best practice Gemini Vision)
    for (const img of validImages) {
      const commaIdx = img.dataUrl.indexOf(',');
      if (commaIdx !== -1) {
        const header = img.dataUrl.slice(0, commaIdx);
        const b64 = img.dataUrl.slice(commaIdx + 1).trim();
        const mimeMatch = header.match(/data:(image\/[a-zA-Z0-9.+-]+);/);
        parts.push({
          inline_data: {
            mime_type: mimeMatch ? mimeMatch[1] : 'image/jpeg',
            data: b64
          }
        });
      }
    }

    parts.push({ text: promptText });

    const generationConfig = {
      temperature: 0.15,
      maxOutputTokens: 8192,
      ...(expectJson ? { responseMimeType: 'application/json' } : {}),
      ...(this.supportsThinkingBudget(model)
        ? { thinkingConfig: { thinkingBudget: 2048 } }
        : {})
    };

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API Error (HTTP ${res.status}): ${errText}`);
    }
    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate || !candidate.content || !Array.isArray(candidate.content.parts)) {
      throw new Error('Risposta Gemini vuota o bloccata dai filtri.');
    }
    return candidate.content.parts.map((p) => p.text || '').join('\n');
  }
}

export const aiService = new AIService();
