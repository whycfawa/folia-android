#version 450
layout(push_constant) uniform Push { float time; float power; int mode; float pad; vec4 accent; } pc;
layout(location = 0) in vec2 uv;
layout(location = 0) out vec4 outColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    vec3 color;
    if (pc.mode == 1) {
        // Lumiere dark field: soft stage beams and drifting dust.
        vec3 base = mix(vec3(0.008, 0.010, 0.018), vec3(0.020, 0.022, 0.040), uv.y);
        float beams = 0.0;
        for (int i = 0; i < 6; i++) {
            float fi = float(i);
            float x = 0.22 + fi * 0.11 + 0.08 * sin(pc.time * 0.25 + fi * 2.0);
            float d = abs(uv.x - x);
            beams += exp(-d * 24.0) * (0.30 + 0.22 * sin(pc.time * 0.4 + fi));
            beams += exp(-d * d * 1800.0) * 0.18;
        }
        float dust = 0.0;
        for (int i = 0; i < 14; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.41, fi * 0.67);
            vec2 pos = vec2(hash(seed) + 0.02 * sin(pc.time * 0.2 + fi), fract(hash(seed + vec2(2.0, 1.0)) - pc.time * 0.008));
            float d = distance(uv, pos);
            dust += exp(-d * d * 1200.0);
        }
        float floorGlow = exp(-pow((uv.y - 0.78) * 6.0, 2.0)) * 0.10;
        float vignette = smoothstep(0.95, 0.35, distance(uv, vec2(0.5)));
        color = (base + pc.accent.rgb * (beams * 0.38 + dust * 0.45) + vec3(0.02, 0.025, 0.035) * beams + pc.accent.rgb * floorGlow) * (0.55 + 0.45 * vignette);
    } else if (pc.mode == 16) {
        // Classic: neutral dark stage, subtle breathing glow.
        vec3 base = mix(vec3(0.012, 0.012, 0.018), vec3(0.025, 0.024, 0.032), uv.y);
        float glow = exp(-distance(uv, vec2(0.5, 0.45)) * 7.0);
        color = base + pc.accent.rgb * glow * (0.12 + pc.power * 0.18);
    } else if (pc.mode == 17) {
        // Still: quiet vignette, almost static.
        vec3 base = vec3(0.010, 0.011, 0.015);
        float vignette = smoothstep(0.95, 0.25, distance(uv, vec2(0.5)));
        color = base * (0.45 + 0.55 * vignette) + pc.accent.rgb * 0.015;
        if (pc.pad > 0.5) color *= 0.55;
    } else if (pc.mode == 15) {
        // Cappella: warm chat surface with floating bubbles.
        vec3 base = mix(vec3(0.035, 0.030, 0.032), vec3(0.08, 0.055, 0.050), uv.y);
        float bubbles = 0.0;
        for (int i = 0; i < 10; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.27, fi * 0.43);
            vec2 pos = vec2(hash(seed) + 0.02 * sin(pc.time * 0.1 + fi), hash(seed + vec2(4.0, 1.0)));
            float d = length((uv - pos) * vec2(1.0, 0.7));
            bubbles += smoothstep(0.035, 0.0, d) * 0.08;
        }
        color = base + pc.accent.rgb * bubbles * 0.5 + vec3(0.05, 0.035, 0.03) * bubbles;
    } else if (pc.mode == 14) {
        // Partita: composed columns with faint staff lines.
        vec3 base = vec3(0.012, 0.018, 0.030);
        float columns = 0.0;
        for (int i = 0; i < 3; i++) {
            float x = 0.36 + float(i) * 0.14;
            columns += smoothstep(0.003, 0.0, abs(uv.x - x));
        }
        float rows = 0.0;
        for (int i = 0; i < 4; i++) {
            float y = 0.32 + float(i) * 0.11;
            rows += smoothstep(0.0018, 0.0, abs(uv.y - y));
        }
        color = base + pc.accent.rgb * (columns * 0.10 + rows * 0.06);
    } else if (pc.mode == 13) {
        // Claddagh: interlocking celtic rings in a dark field.
        vec3 base = vec3(0.018, 0.025, 0.022);
        float rings = 0.0;
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            vec2 center = vec2(0.5 + 0.16 * cos(fi * 2.094), 0.5 + 0.16 * sin(fi * 2.094));
            float d = abs(length(uv - center) - (0.12 + 0.008 * sin(pc.time * 0.3 + fi)));
            rings += smoothstep(0.006, 0.0, d);
        }
        color = base + vec3(0.16, 0.13, 0.07) * rings * 0.7 + pc.accent.rgb * rings * 0.25;
    } else if (pc.mode == 12) {
        // Cadenza: manuscript staff and floating notes.
        vec3 base = vec3(0.055, 0.050, 0.045);
        float staff = 0.0;
        for (int i = 0; i < 5; i++) {
            float y = 0.32 + float(i) * 0.055;
            staff += smoothstep(0.0025, 0.0, abs(uv.y - y));
        }
        float notes = 0.0;
        for (int i = 0; i < 9; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.37, fi * 0.23);
            float nx = fract(hash(seed) + pc.time * 0.02);
            float ny = 0.30 + floor(hash(seed + vec2(2.0, 1.0)) * 5.0) * 0.055;
            float d = length((uv - vec2(nx, ny)) * vec2(2.4, 1.0));
            notes += smoothstep(0.012, 0.0, d);
        }
        color = base + vec3(0.10, 0.09, 0.075) * staff * 0.6 + pc.accent.rgb * notes * 0.65;
    } else if (pc.mode == 11) {
        // Tilt: intersecting geometric planes in low light.
        vec3 base = vec3(0.012, 0.014, 0.022);
        float planes = 0.0;
        for (int i = 0; i < 5; i++) {
            float fi = float(i);
            float angle = 0.5 + fi * 0.33 + pc.time * 0.035;
            float d = abs(sin(uv.x * cos(angle) + uv.y * sin(angle)) * 0.12 - (fi - 1.5) * 0.03);
            planes += smoothstep(0.008, 0.0, d) * (0.12 + fi * 0.02);
            planes += smoothstep(0.09, 0.0, d) * 0.03;
        }
        color = base + pc.accent.rgb * planes * 0.7;
    } else if (pc.mode == 10) {
        // Tempera: dry brush strokes on canvas.
        vec3 base = vec3(0.07, 0.06, 0.05);
        float strokes = 0.0;
        for (int i = 0; i < 18; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.31, fi * 0.17);
            float y = hash(seed);
            float thickness = 0.008 + hash(seed + vec2(3.0, 1.0)) * 0.02;
            float wobble = sin(uv.x * (7.0 + fi) + pc.time * 0.1 + fi) * 0.006;
            float d = abs(uv.y - y - wobble);
            strokes += smoothstep(thickness, 0.0, d) * (0.12 + 0.2 * hash(seed + vec2(5.0, 2.0)));
        }
        color = base + pc.accent.rgb * strokes * 0.5 + vec3(0.06, 0.05, 0.04) * strokes;
    } else if (pc.mode == 9) {
        // Pendolo: a pendulum swinging through a dark hall.
        vec3 base = vec3(0.006, 0.007, 0.012);
        float swing = 0.5 + 0.22 * sin(pc.time * 0.55);
        float lamp = exp(-distance(uv, vec2(swing, 0.24)) * 14.0);
        float cone = 0.0;
        if (uv.y > 0.24) {
            float spread = (uv.y - 0.24) * 0.45;
            cone = smoothstep(spread, spread * 0.2, abs(uv.x - swing)) * (1.0 - (uv.y - 0.24) * 1.2);
        }
        color = base + pc.accent.rgb * (lamp * 0.5 + cone * 0.18);
    } else if (pc.mode == 8) {
        // Diorama: layered paper ridges under a warm sky.
        vec3 sky = mix(vec3(0.08, 0.07, 0.12), vec3(0.18, 0.10, 0.09), uv.y);
        float sun = exp(-distance(uv, vec2(0.68, 0.28)) * 9.0);
        float ridges = 0.0;
        for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float base = 0.42 + fi * 0.10;
            float ridge = base + 0.05 * sin(uv.x * (3.0 + fi) + fi * 2.0) + 0.02 * sin(uv.x * 9.0 - fi);
            ridges += smoothstep(ridge, ridge - 0.006, uv.y) * (0.22 - fi * 0.035);
        }
        color = sky + pc.accent.rgb * sun * 0.25 + vec3(0.04, 0.035, 0.045) * ridges;
    } else if (pc.mode == 7) {
        // Monet: impressionist water-lily colour washes.
        vec3 base = mix(vec3(0.05, 0.07, 0.08), vec3(0.10, 0.12, 0.13), uv.y);
        float petals = 0.0;
        for (int i = 0; i < 16; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.19, fi * 0.37);
            vec2 pos = vec2(hash(seed), hash(seed + vec2(4.0, 2.0)));
            float d = length((uv - pos) * vec2(1.0, 1.4));
            petals += smoothstep(0.10, 0.0, d) * (0.15 + 0.35 * hash(seed + vec2(9.0, 3.0)));
        }
        float shimmer = 0.5 + 0.5 * sin(uv.x * 9.0 + pc.time * 0.3 + uv.y * 5.0);
        color = base + pc.accent.rgb * petals * 0.5 + vec3(0.04, 0.09, 0.07) * shimmer * 0.4;
    } else if (pc.mode == 6) {
        // Fume: ink smoke curling through a dark field.
        vec3 base = vec3(0.012, 0.014, 0.020);
        float smoke = 0.0;
        for (int i = 0; i < 4; i++) {
            float fi = float(i);
            vec2 q = uv * (2.0 + fi * 0.6) + vec2(pc.time * 0.02, -pc.time * 0.015);
            float n = sin(q.x + sin(q.y * 2.3 + fi)) * cos(q.y * 1.7 - pc.time * 0.1);
            smoke += smoothstep(0.15, 0.95, n) * (0.10 - fi * 0.015);
        }
        color = base + pc.accent.rgb * smoke * 0.7 + vec3(0.03, 0.035, 0.05) * smoke;
    } else if (pc.mode == 5) {
        // Machi: warm city bokeh and window lights.
        vec3 base = mix(vec3(0.02, 0.015, 0.018), vec3(0.08, 0.045, 0.035), uv.y);
        float bokeh = 0.0;
        for (int i = 0; i < 14; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.23, fi * 0.41);
            vec2 pos = vec2(hash(seed) + 0.02 * sin(pc.time * 0.12 + fi), hash(seed + vec2(3.0, 1.0)));
            float radius = 0.012 + hash(seed + vec2(5.0, 2.0)) * 0.03;
            float d = length((uv - pos) * vec2(1.0, 0.72));
            bokeh += smoothstep(radius, radius * 0.2, d) * (0.25 + 0.5 * hash(seed + vec2(7.0, 4.0)));
        }
        color = base + pc.accent.rgb * bokeh * 0.55 + vec3(0.08, 0.035, 0.02) * bokeh;
    } else if (pc.mode == 4) {
        // Hanabi: drifting night sky with burst sparks.
        vec3 base = vec3(0.010, 0.010, 0.020);
        float sparks = 0.0;
        for (int b = 0; b < 3; b++) {
            float fb = float(b);
            vec2 center = vec2(0.25 + hash(vec2(fb, 1.0)) * 0.5, 0.30 + hash(vec2(fb, 7.0)) * 0.35);
            float phase = fract(pc.time * 0.12 + fb * 0.37);
            for (int i = 0; i < 10; i++) {
                float fi = float(i);
                float angle = fi * 0.628 + fb;
                float radius = phase * 0.18;
                vec2 pos = center + vec2(cos(angle), sin(angle)) * radius;
                float d = distance(uv, pos);
                sparks += exp(-d * d * 5000.0) * (1.0 - phase);
            }
        }
        color = base + pc.accent.rgb * sparks * 0.8;
    } else if (pc.mode == 3) {
        // Nebbia: deep fog layers with slow drifting density.
        vec3 base = vec3(0.008, 0.012, 0.018);
        float fog = 0.0;
        for (int i = 0; i < 5; i++) {
            float fi = float(i);
            vec2 q = uv * (1.0 + fi * 0.35);
            float n = sin(q.x * 3.1 + pc.time * 0.10 + fi) * cos(q.y * 2.7 - pc.time * 0.08 + fi * 1.3);
            fog += smoothstep(0.2, 1.0, n) * (0.10 - fi * 0.012);
        }
        color = base + pc.accent.rgb * fog * 0.55 + vec3(0.02, 0.03, 0.045) * fog;
    } else if (pc.mode == 2) {
        // Sonnet: warm paper, ink wash and drifting specks.
        vec3 paper = mix(vec3(0.055, 0.048, 0.042), vec3(0.11, 0.095, 0.080), uv.y);
        float wash = 0.5 + 0.5 * sin(uv.x * 5.0 + pc.time * 0.08 + uv.y * 3.0);
        float ink = exp(-distance(uv, vec2(0.32 + 0.05 * sin(pc.time * 0.1), 0.55)) * 5.0);
        float specks = 0.0;
        for (int i = 0; i < 12; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.29, fi * 0.53);
            vec2 pos = vec2(hash(seed), fract(hash(seed + vec2(1.0, 2.0)) - pc.time * 0.006));
            float d = distance(uv, pos);
            specks += exp(-d * d * 2400.0) * 0.25;
        }
        color = paper * (0.8 + 0.15 * wash) + pc.accent.rgb * (ink * 0.10 + specks * 0.2);
    } else {
        vec3 base = mix(vec3(0.015, 0.018, 0.028), vec3(0.030, 0.034, 0.050), uv.y);
        float glow = exp(-8.0 * distance(uv, vec2(0.5 + 0.15 * sin(pc.time * 0.6), 0.45)));
        float particles = 0.0;
        for (int i = 0; i < 18; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.37, fi * 0.71);
            float speed = 0.02 + hash(seed) * 0.035 + pc.power * 0.02;
            vec2 pos = vec2(hash(seed + vec2(1.0, 0.0)) + 0.03 * sin(pc.time * 0.3 + fi),
                            fract(hash(seed + vec2(0.0, 2.0)) - pc.time * speed));
            float d = distance(uv, pos);
            particles += exp(-d * d * 900.0) * (0.3 + 0.7 * hash(seed + vec2(3.0, 1.0)));
        }
        color = base + pc.accent.rgb * (glow * (0.35 + pc.power * 0.45) + particles * (0.55 + pc.power * 0.35));
    }
    outColor = vec4(color, 1.0);
}
