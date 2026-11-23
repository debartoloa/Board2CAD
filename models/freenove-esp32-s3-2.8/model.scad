// ============================================================================
// Board2CAD — Parametric 100% Manifold OpenSCAD Model
// Board: Freenove ESP32-S3 Display 2.8" IPS (FNK0104B - ESP32-S3-WROOM-1 N16R8)
// Watertight Guarantee: eps = 0.05 mm overlap on all mating surfaces
// ============================================================================

/* [Board Dimensions] */
pcb_length     = 86.0; // [50:0.5:160]
pcb_width      = 50.0; // [30:0.5:120]
pcb_thickness  = 1.6;  // [0.8:0.1:3.2]
corner_radius  = 3.0;  // [0.5:0.5:8.0]
hole_diameter  = 3.2;  // [2.0:0.1:5.0]
hole_pitch_x   = 80.0; // [30:0.5:150]
hole_pitch_y   = 44.0; // [20:0.5:110]
usb_protrusion = 1.5;  // [0.0:0.1:4.0]
display_height = 3.4;  // [1.5:0.2:10.0]

/* [Detail & Features] */
show_silkscreen = true;
show_headers    = false;
show_components = true;
show_display    = true;
$fn             = 36;

/* [Internal Manifold Epsilon] */
eps = 0.05;

// Coordinate dei 4 fori di montaggio M3
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

    // Pad anulari dorati M3 con compenetrazione eps = 0.05 mm
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
        color("#c0c7d0")
        difference() {
            cube([usb_l, usb_w, usb_h]);
            translate([-0.15, 0.45, 0.45])
                cube([usb_l - 1.2, usb_w - 0.9, usb_h - 0.9]);
        }
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
    for (idx = [0, 1]) {
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
        color("#111827") cube([w_l, w_w, 0.85]);
        color("#94a3b8") translate([5.5, 1.2, -2.25 + eps]) cube([w_l - 6.5, w_w - 2.4, 2.3]);
    }
}

module smd_components_array() {
    // Audio Codec ES8311 QFN + NS4150B Amp + WS2812 RGB LED (GPIO 42)
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
        color("#111111")
            cube([disp_l, disp_w, display_height]);
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
                text("FREENOVE ESP32-S3 2.8 FNK0104B", size = 2.2, halign = "center", valign = "center");

        translate([pcb_length * 0.5, 2.6, pcb_thickness - eps])
            linear_extrude(height = 0.12)
                text("UART(RX=44)  IO(2,3,14,21)  I2C(16,15)", size = 1.9, halign = "center", valign = "center");
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
