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
        for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float x = 0.35 + fi * 0.15 + 0.08 * sin(pc.time * 0.25 + fi * 2.0);
            float d = abs(uv.x - x);
            beams += exp(-d * 28.0) * (0.35 + 0.25 * sin(pc.time * 0.4 + fi));
        }
        float dust = 0.0;
        for (int i = 0; i < 14; i++) {
            float fi = float(i);
            vec2 seed = vec2(fi * 0.41, fi * 0.67);
            vec2 pos = vec2(hash(seed) + 0.02 * sin(pc.time * 0.2 + fi), fract(hash(seed + vec2(2.0, 1.0)) - pc.time * 0.008));
            float d = distance(uv, pos);
            dust += exp(-d * d * 1200.0);
        }
        color = base + pc.accent.rgb * (beams * 0.35 + dust * 0.4) + vec3(0.02, 0.025, 0.035) * beams;
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
