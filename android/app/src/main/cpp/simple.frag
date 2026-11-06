#version 450
layout(location = 0) in vec2 uv;
layout(location = 0) out vec4 outColor;
void main() {
    vec3 base = mix(vec3(0.02, 0.03, 0.06), vec3(0.08, 0.10, 0.18), uv.y);
    outColor = vec4(base, 1.0);
}
