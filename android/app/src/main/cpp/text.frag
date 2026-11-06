#version 450
layout(binding = 0) uniform sampler2D tex;
layout(push_constant) uniform Push { float alpha; } pc;
layout(location = 0) in vec2 uv;
layout(location = 0) out vec4 outColor;
void main() {
    vec4 c = texture(tex, uv);
    outColor = vec4(c.rgb, c.a * pc.alpha);
}
