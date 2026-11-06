#version 450
layout(push_constant) uniform Push { float time; vec4 accent; } pc;
layout(location = 0) in vec2 uv;
layout(location = 0) out vec4 outColor;
void main() {
    vec3 base = mix(vec3(0.015, 0.018, 0.028), vec3(0.030, 0.034, 0.050), uv.y);
    float glow = exp(-8.0 * distance(uv, vec2(0.5 + 0.15 * sin(pc.time * 0.6), 0.45)));
    outColor = vec4(base + pc.accent.rgb * glow * 0.35, 1.0);
}
