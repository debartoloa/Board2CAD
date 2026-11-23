// ============================================================================
// ESP32-WROOM-32 DevKitC 38-Pin (Versione Stretta 55x27mm - CP2102 + Micro-USB)
// Origine (0,0,0): Angolo inferiore sinistro della faccia inferiore del PCB
// ============================================================================

/* [Board] */
pcb_w = 55.0; // [40:0.1:80]
pcb_h = 27.0; // [20:0.1:50]
pcb_t = 1.6;  // [0.8:0.1:3.2]
corner_r = 1.2; // [0.1:0.1:5]
hole_d = 2.2; // [1.0:0.1:4.0]
hole_margin = 2.1; // [1.0:0.1:5.0]

/* [Pin Headers] */
show_headers = true;
pin_rows_dist = 22.86; // [15:0.01:26] // Interasse standard 900 mil (9 x 2.54mm)
pin_len_bottom = 6.0;  // [2:0.5:12]
pin_plastic_h = 2.54;  // [1.5:0.1:4.0]

/* [Detail] */
show_silkscreen = true;
facets = 32; // [12:1:80]
$fn = facets;

// ============================================================================
// MODULI COMPONENTI
// ============================================================================

module rounded_pcb(w, h, t, r) {
    hull() for (x = [r, w - r], y = [r, h - r])
        translate([x, y, 0]) cylinder(r = r, h = t);
}

module esp_wroom_32(x, y, z) {
    // Base PCB del modulo (25.5 x 18.0 mm)
    mod_w = 25.5; mod_h = 18.0; mod_t = 0.8;
    shield_w = 18.0; shield_l = 18.0; shield_h = 2.4;
    
    translate([x, y - mod_h/2, z - 0.05]) {
        // Basetta scura del modulo
        color("#1c1c1c") cube([mod_w, mod_h, mod_t + 0.05]);
        
        // Piazzole castellated (semi-fori stagnati sui 3 lati)
        color("Silver") {
            for (i = [0 : 13]) {
                px = 8.2 + i * 1.27;
                translate([px, -0.15, 0]) cylinder(d = 0.75, h = mod_t + 0.15);
                translate([px, mod_h + 0.15, 0]) cylinder(d = 0.75, h = mod_t + 0.15);
            }
            for (j = [0 : 9]) {
                py = 2.8 + j * 1.27;
                translate([mod_w + 0.1, py, 0]) cylinder(d = 0.75, h = mod_t + 0.15);
            }
        }
        
        // Traccia antenna PCB a meandro (primi 7mm a sinistra)
        color("#c8b560") {
            translate([1.2, 2.5, mod_t - 0.02]) cube([4.8, 0.7, 0.08]);
            translate([1.2, 2.5, mod_t - 0.02]) cube([0.7, 13.0, 0.08]);
            translate([1.2, 14.8, mod_t - 0.02]) cube([3.2, 0.7, 0.08]);
            translate([3.7, 6.0, mod_t - 0.02]) cube([0.7, 9.5, 0.08]);
            translate([3.7, 6.0, mod_t - 0.02]) cube([2.3, 0.7, 0.08]);
            translate([5.3, 6.0, mod_t - 0.02]) cube([0.7, 9.5, 0.08]);
        }
        
        // Scudo metallico RF (Shield)
        color("#b8bcc0") translate([mod_w - shield_w - 0.4, 0, mod_t - 0.05]) {
            cube([shield_w, shield_l, shield_h]);
            // Foro di sfiato/riferimento sulla lattina
            translate([3.5, shield_l/2, shield_h - 0.2]) cylinder(d = 1.1, h = 0.25);
        }
    }
}

module micro_usb(x, y, z) {
    // Posizionata sul bordo destro (x = pcb_w), sporge verso +X
    w = 7.6; l = 5.6; h = 2.6;
    translate([x - l + 1.5, y - w/2, z - 0.05]) {
        color("Silver") difference() {
            hull() {
                translate([0, 0.6, 0.6]) rotate([0, 90, 0]) cylinder(r = 0.6, h = l);
                translate([0, w - 0.6, 0.6]) rotate([0, 90, 0]) cylinder(r = 0.6, h = l);
                translate([0, 1.3, h - 0.5]) rotate([0, 90, 0]) cylinder(r = 0.5, h = l);
                translate([0, w - 1.3, h - 0.5]) rotate([0, 90, 0]) cylinder(r = 0.5, h = l);
            }
            // Cavità interna
            translate([1.2, 0.9, 0.5]) cube([l, w - 1.8, h - 1.0]);
        }
        // Linguetta interna
        color("#222222") translate([1.5, 1.5, 0.95]) cube([l - 2.2, w - 3.0, 0.45]);
        // Piedini saldatura laterali
        color("Silver") {
            translate([1.5, -0.5, 0]) cube([2.5, w + 1.0, 0.35]);
        }
    }
}

module tactile_button_mini(x, y, z) {
    translate([x, y, z - 0.05]) {
        color("#d0d3d6") translate([-1.5, -1.8, 0]) cube([3.0, 3.6, 1.1]);
        color("#1e1e1e") translate([0, 0, 1.05]) cylinder(d = 1.6, h = 0.65);
        color("#c8b560") for (dx = [-1.7, 1.3], dy = [-1.3, 0.8])
            translate([dx, dy, 0]) cube([0.4, 0.5, 0.3]);
    }
}

module ams1117(x, y, z) {
    // Package SOT-223
    translate([x, y, z - 0.05]) {
        color("#202020") translate([-3.25, -1.75, 0.15]) cube([6.5, 3.5, 1.5]);
        color("Silver") {
            // Aletta dissipatrice superiore
            translate([-1.5, 1.6, 0]) cube([3.0, 1.4, 0.45]);
            // 3 pin inferiori
            for (dx = [-2.3, 0, 2.3])
                translate([dx - 0.35, -3.0, 0]) cube([0.7, 1.4, 0.35]);
        }
    }
}

module cp2102_qfn(x, y, z) {
    // QFN-28 (5x5mm)
    translate([x, y, z - 0.05]) {
        color("#1c1c1c") translate([-2.5, -2.5, 0.1]) cube([5.0, 5.0, 0.85]);
        color("Silver") {
            for (i = [0 : 6]) {
                p = -1.8 + i * 0.6;
                translate([p - 0.12, -2.7, 0]) cube([0.24, 5.4, 0.2]);
                translate([-2.7, p - 0.12, 0]) cube([5.4, 0.24, 0.2]);
            }
        }
    }
}

module tantalum_cap(x, y, z) {
    // Condensatore al tantalio giallo Case A/B
    translate([x, y, z - 0.05]) {
        color("#e69c24") translate([-1.6, -1.4, 0.1]) cube([3.2, 2.8, 1.6]);
        // Banda polarità marrone
        color("#7a4410") translate([0.9, -1.42, 1.45]) cube([0.75, 2.84, 0.3]);
        color("Silver") {
            translate([-1.75, -0.9, 0]) cube([0.35, 1.8, 0.9]);
            translate([1.4, -0.9, 0]) cube([0.35, 1.8, 0.9]);
        }
    }
}

module smd_part(x, y, z, w, l, h, col) {
    translate([x, y, z - 0.05]) {
        color(col) translate([-w/2, -l/2, 0]) cube([w, l, h + 0.05]);
        color("Silver") {
            translate([-w/2 - 0.1, -l/2, 0]) cube([0.35, l, h + 0.08]);
            translate([w/2 - 0.25, -l/2, 0]) cube([0.35, l, h + 0.08]);
        }
    }
}

module silk_text(txt, x, y, z, sz, rot = 0) {
    if (show_silkscreen) {
        color("#f2f2f2")
        translate([x, y, z - 0.02])
        rotate([0, 0, rot])
        linear_extrude(height = 0.07)
            text(txt, size = sz, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
    }
}

// ============================================================================
// ASSEMBLAGGIO COMPLETO
// ============================================================================

union() {
    // 1. PCB Principale con 4 fori d'angolo e 38 piazzole passanti
    color("#1a1a1a") difference() {
        rounded_pcb(pcb_w, pcb_h, pcb_t, corner_r);
        
        // 4 Fori di montaggio agli angoli
        for (x = [hole_margin, pcb_w - hole_margin],
             y = [hole_margin, pcb_h - hole_margin])
            translate([x, y, -1]) cylinder(d = hole_d, h = pcb_t + 2);
            
        // 38 Fori passanti per i pin header (passo 2.54mm)
        start_x = (pcb_w - 18 * 2.54) / 2;
        y_bot = (pcb_h - pin_rows_dist) / 2;
        y_top = (pcb_h + pin_rows_dist) / 2;
        for (i = [0 : 18]) {
            translate([start_x + i * 2.54, y_bot, -1]) cylinder(d = 1.0, h = pcb_t + 2);
            translate([start_x + i * 2.54, y_top, -1]) cylinder(d = 1.0, h = pcb_t + 2);
        }
    }

    // Pad ramati/stagnati attorno ai fori d'angolo e ai 38 pin
    color("#c8b560") {
        for (x = [hole_margin, pcb_w - hole_margin],
             y = [hole_margin, pcb_h - hole_margin])
            translate([x, y, -0.02]) difference() {
                cylinder(d = 3.8, h = pcb_t + 0.04);
                translate([0, 0, -0.5]) cylinder(d = hole_d, h = pcb_t + 1);
            }
            
        start_x = (pcb_w - 18 * 2.54) / 2;
        y_bot = (pcb_h - pin_rows_dist) / 2;
        y_top = (pcb_h + pin_rows_dist) / 2;
        for (i = [0 : 18], yy = [y_bot, y_top]) {
            translate([start_x + i * 2.54, yy, -0.02]) difference() {
                cylinder(d = 1.85, h = pcb_t + 0.04);
                translate([0, 0, -0.5]) cylinder(d = 1.0, h = pcb_t + 1);
            }
        }
    }

    // 2. Pin Header Gialli (38 pin totali sotto al PCB)
    if (show_headers) {
        start_x = (pcb_w - 18 * 2.54) / 2;
        y_bot = (pcb_h - pin_rows_dist) / 2;
        y_top = (pcb_h + pin_rows_dist) / 2;
        
        for (i = [0 : 18], yy = [y_bot, y_top]) {
            px = start_x + i * 2.54;
            // Base isolante gialla
            color("#f2c922")
            translate([px - 1.25, yy - 1.25, -pin_plastic_h])
                cube([2.50, 2.50, pin_plastic_h + 0.05]);
            // Pin metallico dorato passante
            color("#d4af37")
            translate([px - 0.32, yy - 0.32, -pin_plastic_h - pin_len_bottom])
                cube([0.64, 0.64, pin_plastic_h + pin_len_bottom + pcb_t + 0.6]);
        }
    }

    // 3. Modulo ESP-WROOM-32 a sinistra
    esp_wroom_32(-0.4, pcb_h/2, pcb_t);

    // 4. Lato Destro: Porta Micro-USB e Tasti BOOT / RST
    micro_usb(pcb_w, pcb_h/2, pcb_t);
    tactile_button_mini(50.8, 20.8, pcb_t); // BOOT
    tactile_button_mini(50.8, 6.2, pcb_t);  // RST

    // 5. Area Centrale: CP2102, AMS1117-3.3, Condensatori Tantalio C1 & C2
    cp2102_qfn(42.2, 16.5, pcb_t);
    ams1117(42.5, 8.2, pcb_t);
    tantalum_cap(32.5, 10.2, pcb_t); // C1
    tantalum_cap(36.8, 10.2, pcb_t); // C2

    // Transistor SOT-23 (Q1, Q2) e resistenze/diodi SMD
    smd_part(31.2, 19.2, pcb_t, 2.8, 1.5, 1.0, "#1c1c1c"); // Q1
    smd_part(35.8, 15.2, pcb_t, 2.8, 1.5, 1.0, "#1c1c1c"); // Q2
    
    // Colonna verticale resistenze tra ESP-WROOM-32 e regolatori
    for (y = [7.5, 10.2, 12.8, 15.4, 18.0, 20.5])
        smd_part(27.8, y, pcb_t, 1.8, 1.0, 0.6, "#222222");
        
    // Fila orizzontale resistenze in alto a destra (sotto i pin G4..SDO)
    for (x = [36.5, 39.2, 41.8, 44.5, 47.2])
        smd_part(x, 20.6, pcb_t, 1.2, 2.0, 0.6, "#222222");
        
    // Diodi/condensatori in basso al centro
    for (x = [32.2, 34.8, 37.4])
        smd_part(x, 6.4, pcb_t, 1.8, 1.1, 0.8, "#1c1c1c");

    // 6. Serigrafie Bianche Principali
    silk_text("BOOT", 47.6, 20.8, pcb_t, 1.2, 180);
    silk_text("RST", 47.6, 6.2, pcb_t, 1.2, 180);
    silk_text("ESP-WROOM-32", 14.5, 13.5, pcb_t + 3.2, 1.25, 90);
    silk_text("AMS1117", 42.5, 8.6, pcb_t + 1.65, 0.9, 90);
    silk_text("CP2102", 42.2, 16.5, pcb_t + 0.95, 0.85, 90);
    
    // Etichette pin principali sopra e sotto
    silk_text("GND G23 G22 TXD RXD G21 GND G19 G18 G5 G17 G16 G4 G0 G2 G15 SD1 SD0 CLK", 27.5, 22.8, pcb_t, 0.95, 0);
    silk_text("3V3 EN SP SN G34 G35 G32 G33 G25 G26 G27 G14 G12 GND G13 SD2 SD3 CMD V5", 27.5, 4.2, pcb_t, 0.95, 180);
}