#version 450
layout(push_constant) uniform Push { vec4 color; } pc;
layout(location = 0) in vec2 inPos;
layout(location = 1) in vec2 inUv;
layout(location = 0) out vec2 uv;
layout(location = 1) out vec4 color;
void main() {
    gl_Position = vec4(inPos.x * 2.0 - 1.0, 1.0 - inPos.y * 2.0, 0.0, 1.0);
    uv = inUv;
    color = pc.color;
}
