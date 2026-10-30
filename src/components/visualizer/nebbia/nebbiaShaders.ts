import { NEBBIA_SCENE_GLSL } from './nebbiaSceneGlsl';

// src/components/visualizer/nebbia/nebbiaShaders.ts
// 雾笺的着色器：全屏四边形的主着色器（uPass 0 = 雾的预渲染，两层模糊的窗外写进两张 1/4 分辨率的浮点纹理；
// 1 = 主画面：雾、擦痕、水珠折射合成，照搬 raindrop-fx 的 compose.glsl），和画水珠精灵的实例化着色器。

export const NEBBIA_VS = /* glsl */ `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const NEBBIA_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uMask, uDrop, uField;
// 哈气的白气遮罩（R 形状、G 浓度，nebbiaBreath.ts）；屏上没有哈气时 uBreathOn 为假，不采样
uniform sampler2D uBreath; uniform bool uBreathOn; uniform float uBreathThick;
uniform vec2 uRes, uGlassShift, uSceneShift; uniform float uTime, uMist, uEdge, uRefract, uBus, uGlint, uNeon;
uniform vec3 uSky0, uSky1, uLa, uLb, uLc;
// uPass 0：雾的预渲染；1：主画面。uFogTex 为假时主画面自己算（不支持浮点渲染目标时）
uniform int uPass; uniform bool uFogTex; uniform sampler2D uFogBlur, uFogGlow;
// 聚光灯：光源（远处楼底）、照到玻璃上的点、光斑半径，都在 scene 坐标；uSpotI 强度
uniform vec2 uSpotSrc, uSpotSrc2, uSpotTgt; uniform float uSpotR, uSpotI;
in vec2 vUv; layout(location = 0) out vec4 outColor; layout(location = 1) out vec4 outGlow;
${NEBBIA_SCENE_GLSL}
void main() {
  // 雾里的两层窗外（模糊半径 0.03、0.09 屏高）本来就很糊，在 1/4 分辨率下算好、主画面放大采样，结果几乎一样，
  // 却省掉每个像素两次完整的场景计算（2880×1800 下约 8 毫秒）
  if (uPass == 0) {
    vec2 s0 = vUv + uSceneShift, q0 = vec2(s0.x * uRes.x / uRes.y, s0.y);
    outColor = vec4(scene(q0, 0.03), 1.0);
    outGlow = vec4(scene(q0, 0.09), 1.0);
    return;
  }
  // 颠簸：玻璃上的东西（雾、擦痕、水珠）跟车身一起晃，窗外晃得更多
  vec2 gv = vUv + uGlassShift, sv = vUv + uSceneShift;
  vec2 px = gv * uRes;
  float aspect = uRes.x / uRes.y;
  vec2 q = vec2(sv.x * aspect, sv.y);
  float m = texture(uMask, gv).r;
  // 擦痕边缘：细噪声让边缘毛糙，大块噪声让重新起雾时一片片回来
  float fine = vnoise(px / 6.0) * 0.6 + vnoise(px / 2.2) * 0.4;
  float blotch = vnoise(px / 55.0 + 3.1);
  float th = 0.3 + (fine - 0.5) * 0.22 * uEdge + (blotch - 0.5) * 0.12;
  float clear = smoothstep(th - 0.05, th + 0.06, m);
  // 哈气：就是这一片的雾一下变密（更细密的一层水汽凝上来），不是另盖一层。边由大块噪声揉散成一卷卷的、
  // 细噪声让它发毛，散的时候从薄的地方先透。在白气上写的字照样擦开，水珠周围照样抹开一圈
  float breath = 0.0;
  if (uBreathOn) {
    vec2 bm = texture(uBreath, gv).rg;
    if (bm.r > 0.003) {
      // 值噪声直接取阈值会露出横平竖直的格子：每层转一个角度、叠三层，边缘才是一卷卷的
      vec2 r1 = mat2(0.80, -0.60, 0.60, 0.80) * px, r2 = mat2(0.36, 0.93, -0.93, 0.36) * px;
      float bn = vnoise(r1 / 34.0 + 7.0) * 0.55 + vnoise(r2 / 15.0 + 2.3) * 0.3 + vnoise(px / 6.5) * 0.15;
      float bth = 0.3 + (bn - 0.5) * 0.5;
      breath = smoothstep(bth - 0.2, bth + 0.25, bm.r) * bm.g * uBreathThick;
    }
  }
  // 雾：模糊的窗外提亮发灰，光晕散得更开，加浓淡起伏和细颗粒，下半部分略浓
  float dens = uMist * (0.82 + 0.3 * vnoise(px / 380.0 + uTime * 0.015)) * (0.9 + 0.2 * vUv.y) + breath * 0.9;
  vec3 haze = vec3(0.70, 0.74, 0.78);
  vec3 blur, glow;
  if (uFogTex) {
    // 预渲染纹理的第 0 行是 vUv.y = 1（屏幕底部），所以纵向翻一下
    vec2 fu = vec2(vUv.x, 1.0 - vUv.y);
    blur = texture(uFogBlur, fu).rgb;
    glow = texture(uFogGlow, fu).rgb;
  } else {
    blur = scene(q, 0.03);
    glow = scene(q, 0.09);
  }
  // 密到普通雾的范围以上（哈气）时，窗外再暗一点、乳白再多一点
  vec3 fog = blur * max(0.08, 1.0 - 0.45 * dens - 0.25 * breath) + glow * 0.9 * dens + haze * (0.2 * dens + 0.25 * breath);
  fog += (hash(px) - 0.5) * 0.025;
  // 聚光灯照到玻璃上：雾里的小水滴把光散开，字周围一圈雾被照成强调色
  vec2 sd = q - uSpotTgt;
  fog += uLa * uSpotI * exp(-dot(sd, sd) / (uSpotR * uSpotR * 2.2)) * (0.18 + 0.4 * dens);
  fog += smoothstep(0.78, 0.98, vnoise(px / 1.6)) * 0.05 * dens;
  // 水珠纹理：擦痕边 / 下淌的水珠 rd，雾上的凝结水珠 fd（擦开的地方没有）
  vec4 rd = texture(uDrop, gv);
  vec4 fd = texture(uField, gv) * (1.0 - clear);
  // 和 raindrop-fx 一样，水珠周围一圈的雾也被抹掉
  clear = max(clear, smoothstep(0.93, 1.0, rd.a));
  vec3 col = fog;
  if (clear > 0.001) {
    // 擦开的地方：清晰的窗外，留一层很薄的水膜
    vec3 wiped = scene(q, 0.0012) * 1.05 + haze * 0.02 * dens;
    float rim = clear * (1.0 - clear) * 4.0;
    col = mix(fog, wiped, clear) + rim * haze * 0.16 * dens;
  }
  // 合成方式照搬 raindrop-fx 的 compose.glsl：阈值成形、按法线折射清晰的窗外、按光照明暗
  vec4 comp = vec4(rd.rgb + fd.rgb - 2.0 * rd.rgb * fd.rgb, max(rd.a, fd.a));
  float dmask = smoothstep(0.96, 0.99, comp.a);
  if (dmask > 0.001) {
    vec2 nn = comp.rg - 0.5;
    vec2 ruv = sv + vec2(-nn.x, nn.y) * (comp.b * 0.6 + 0.4) * uRefract;
    // 雾笺 demo 用的是轻度模糊的背景、漫反射 0.2–0.5、高光指数 48
    vec3 lens = scene(vec2(ruv.x * aspect, ruv.y), 0.006);
    vec3 normal = normalize(vec3(nn * 2.0, 1.0));
    vec3 lightDir = normalize(vec3(-1.0, 1.0, 2.0));
    float lambert = clamp(dot(lightDir, normal), 0.0, 1.0);
    float spec = pow(max(dot(normal, normalize(lightDir + vec3(0.0, 0.0, 1.0))), 0.0), 48.0);
    lens += (lambert - 0.8) * vec3(0.3, 0.3, 0.32) + spec * vec3(0.3, 0.3, 0.33) * uGlint;
    // 车厢里的灯照在水珠表面：比纯透过去的窗外亮一点，不会在灰白的雾上显成黑点
    lens = max(lens, fog * 0.55) + haze * 0.08 * dens;
    col = mix(col, lens, dmask);
  }
  outColor = vec4(col, 1.0);
  outGlow = vec4(0.0);
}`;

// 水珠精灵：实例化四边形画进水珠纹理，混合方式同 raindrop-fx 的 "smoother"
export const NEBBIA_SPRITE_VS = /* glsl */ `#version 300 es
in vec2 aCorner; in vec4 aRect; in vec2 aParam;
uniform vec2 uView;
out vec2 vUV; out float vSize; out float vAlpha;
void main() {
  vec2 p = aRect.xy + (aCorner - 0.5) * aRect.zw;
  vUV = aCorner; vSize = aParam.x; vAlpha = aParam.y;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, p.y / uView.y * 2.0 - 1.0, 0.0, 1.0);
}`;

export const NEBBIA_SPRITE_FS = /* glsl */ `#version 300 es
precision mediump float;
uniform sampler2D uSprite;
in vec2 vUV; in float vSize; in float vAlpha; out vec4 o;
void main() {
  vec4 c = texture(uSprite, vUV);
  c.a *= vAlpha;
  o = vec4(c.rg * c.a, vSize * c.a, c.a);
}`;
