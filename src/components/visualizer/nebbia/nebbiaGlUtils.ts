// src/components/visualizer/nebbia/nebbiaGlUtils.ts
// 雾笺 WebGL2 的小工具：着色器编译链接、纹理创建，以及主着色器每帧的 uniform 类型（从 nebbiaGl.ts 拆出）。

export interface Tex { t: WebGLTexture; unit: number; fb?: WebGLFramebuffer }
export interface NebbiaUniforms {
    time: number; mist: number; edge: number; refract: number; bus: number; glint: number; neon: number;
    glassShift: [number, number]; sceneShift: [number, number];
    spotSrc: [number, number]; spotSrc2: [number, number]; spotTgt: [number, number]; spotR: number; spotI: number;
}

const compile = (gl: WebGL2RenderingContext, type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Nebbia shader: ${gl.getShaderInfoLog(s)}`);
    return s;
};
export const link = (gl: WebGL2RenderingContext, vs: string, fs: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Nebbia program: ${gl.getProgramInfoLog(p)}`);
    return p;
};

/** 一张线性过滤、边缘夹紧的纹理，挂在采样单元 `unit` 上；`name` 是主程序里对应的采样器。 */
export const makeTex = (gl: WebGL2RenderingContext, prog: WebGLProgram, unit: number, name: string | null): Tex => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (name) gl.uniform1i(gl.getUniformLocation(prog, name), unit);
    return { t, unit };
};
