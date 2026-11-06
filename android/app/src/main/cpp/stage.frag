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
