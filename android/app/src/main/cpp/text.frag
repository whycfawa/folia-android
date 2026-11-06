#version 450
layout(location = 0) in vec2 uv;
layout(location = 1) in vec4 color;
layout(binding = 0) uniform sampler2D atlas;
layout(location = 0) out vec4 outColor;
void main() {
    float alpha = texture(atlas, uv).a;
    outColor = vec4(color.rgb, color.a * alpha);
}
