// ============================================================================
// Board2CAD — Parametric 100% Manifold OpenSCAD Model
// Board: Arduino Uno R3 (Standard 68.6 x 53.4 mm)
// Origine (0,0,0): Angolo inferiore sinistro faccia inferiore PCB
// ============================================================================

/* [Board Dimensions] */
pcb_length    = 68.6; // [50:0.1:100]
pcb_width     = 53.4; // [40:0.1:80]
pcb_thickness = 1.6;  // [0.8:0.1:3.2]
hole_diameter = 3.2;  // [2.5:0.1:4.0]

/* [Detail & Features] */
show_silkscreen = true;
show_headers    = true;
show_components = true;
$fn             = 36;

eps = 0.05;

// Coordinate standard dei 4 fori di montaggio Arduino Uno R3
uno_holes = [
    [14.0, 2.5],
    [15.3, 50.7],
    [66.1, 7.6],
    [66.1, 35.5]
];

// ============================================================================
// MODULI COMPONENTI ARDUINO UNO R3
// ============================================================================

module uno_pcb_2d() {
    // Sagoma ufficiale Arduino Uno con smusso sul lato sinistro (lato opposto a USB/DC)
    polygon(points = [
        [2.5, 0.0],
        [pcb_length, 0.0],
        [pcb_length, pcb_width],
        [2.5, pcb_width],
        [2.5, pcb_width - 2.5],
        [0.0, pcb_width - 5.0],
        [0.0, 12.7],
        [2.5, 10.2]
    ]);
}

module pcb_substrate() {
    color("#00878F") // Verde/ottanio tipico Arduino
    difference() {
        linear_extrude(height = pcb_thickness)
            uno_pcb_2d();

        for (h = uno_holes) {
            translate([h[0], h[1], -0.2])
                cylinder(d = hole_diameter, h = pcb_thickness + 0.4);
        }
    }

    // Pad stagnati attorno ai 4 fori
    color("#d4d8dd")
    for (h = uno_holes) {
        difference() {
            translate([h[0], h[1], -eps])
                cylinder(d = hole_diameter + 2.4, h = pcb_thickness + 2 * eps);
            translate([h[0], h[1], -0.3])
                cylinder(d = hole_diameter, h = pcb_thickness + 0.6);
        }
    }
}

module usb_b_connector() {
    // Porta USB Type-B (sporge a destra oltre 68.6 mm di ~6.5 mm)
    w = 12.0; l = 16.2; h = 10.8;
    translate([pcb_length - l + 6.5, 11.5, pcb_thickness - eps]) {
        color("#c8cdd3")
        difference() {
            cube([l, w, h]);
            // Cavità interna USB-B
            translate([3.0, 1.2, 1.2])
                cube([l, w - 2.4, h - 2.4]);
        }
        // Isolante bianco centrale
        color("#f1f5f9")
        translate([3.2, 3.2, 3.2])
            cube([l - 4.5, w - 6.4, h - 6.4]);
    }
}

module dc_barrel_jack() {
    // Connettore alimentazione DC 2.1mm (sporge a destra di ~3.2 mm)
    w = 9.0; l = 14.4; h = 11.0;
    translate([pcb_length - l + 3.2, 41.2, pcb_thickness - eps]) {
        color("#1e242b")
        difference() {
            cube([l, w, h]);
            // Foro cilindrico frontale
            translate([l - 8.0, w/2, h/2 + 0.3])
                rotate([0, 90, 0])
                    cylinder(d = 6.3, h = 9.0);
        }
        // Pin centrale metallico
        color("#d4af37")
        translate([l - 7.5, w/2, h/2 + 0.3])
            rotate([0, 90, 0])
                cylinder(d = 2.1, h = 7.0);
    }
}

module female_header_strip(x, y, pins) {
    len = pins * 2.54;
    w = 2.54;
    h = 8.5;
    translate([x, y, pcb_thickness - eps]) {
        color("#18181b")
        difference() {
            cube([len, w, h]);
            for (i = [0 : pins - 1]) {
                translate([i * 2.54 + 0.67, 0.67, 2.0])
                    cube([1.2, 1.2, h]);
            }
        }
    }
}

module male_pin_header(x, y, cols, rows) {
    translate([x, y, pcb_thickness - eps]) {
        color("#18181b")
        cube([cols * 2.54, rows * 2.54, 2.5]);
        color("#d4af37")
        for (ix = [0 : cols - 1], iy = [0 : rows - 1]) {
            translate([ix * 2.54 + 0.95, iy * 2.54 + 0.95, 2.4 - eps])
                cube([0.64, 0.64, 6.0]);
        }
    }
}

module atmega328p_dip() {
    // Zoccolo + Microcontrollore DIP-28
    translate([16.5, 31.0, pcb_thickness - eps]) {
        color("#1e1e1e") cube([35.6, 7.6, 3.2]);
        color("#2b2b2b") translate([0.4, 0.5, 3.1]) cube([34.8, 6.6, 3.0]);
        color("#cbd5e1")
        for (i = [0 : 13]) {
            px = 1.3 + i * 2.54;
            translate([px, -0.4, 0]) cube([0.6, 0.6, 4.5]);
            translate([px, 7.4, 0]) cube([0.6, 0.6, 4.5]);
        }
    }
}

module reset_button() {
    // Tasto RESET in basso a destra (vicino USB)
    translate([57.5, 3.5, pcb_thickness - eps]) {
        color("#cbd5e1") cube([6.0, 6.0, 2.2]);
        color("#e2e8f0") translate([3.0, 3.0, 2.1]) cylinder(d = 3.2, h = 1.6);
    }
}

module smd_and_caps() {
    // 2 Condensatori elettrolitici cilindrici (vicino DC Jack)
    for (cx = [38.0, 45.5]) {
        translate([cx, 43.5, pcb_thickness - eps]) {
            color("#1e293b") cylinder(d = 6.3, h = 5.4);
            color("#e2e8f0") translate([0, 0, 5.35]) cylinder(d = 6.0, h = 0.15);
        }
    }
    // Quarzo HC-49S 16MHz
    translate([42.0, 26.5, pcb_thickness - eps]) {
        color("#cbd5e1")
        hull() {
            translate([1.8, 2.3, 0]) cylinder(d = 4.6, h = 3.5);
            translate([9.2, 2.3, 0]) cylinder(d = 4.6, h = 3.5);
        }
    }
    // ATmega16U2 (USB interface QFN)
    color("#1e242b")
    translate([46.5, 16.5, pcb_thickness - eps])
        cube([5.0, 5.0, 0.9]);
    // Regolatore SOT-223
    color("#1e242b")
    translate([56.0, 41.0, pcb_thickness - eps])
        cube([6.5, 3.5, 1.6]);
}

module uno_silkscreen() {
    color("#f8fafc") {
        translate([34.0, 22.5, pcb_thickness - eps])
            linear_extrude(height = 0.12)
                text("UNO", size = 4.8, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
        translate([34.0, 27.5, pcb_thickness - eps])
            linear_extrude(height = 0.12)
                text("ARDUINO", size = 2.4, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
    }
}

// ============================================================================
// ASSEMBLAGGIO PRINCIPALE
// ============================================================================
union() {
    pcb_substrate();

    if (show_components) {
        usb_b_connector();
        dc_barrel_jack();
        atmega328p_dip();
        reset_button();
        smd_and_caps();
    }

    if (show_headers) {
        // Fila superiore: POWER (8 pin) + ANALOG IN (6 pin)
        female_header_strip(25.5, pcb_width - 3.8, 8);
        female_header_strip(4.5, pcb_width - 3.8, 6);
        // Fila inferiore: DIGITAL PWM (10 pin + 8 pin)
        female_header_strip(29.0, 1.2, 10);
        female_header_strip(7.0, 1.2, 8);
        // Header ICSP (2x3)
        male_pin_header(3.2, 24.0, 2, 3);
        male_pin_header(48.0, 6.0, 3, 2);
    }

    if (show_silkscreen) {
        uno_silkscreen();
    }
}
