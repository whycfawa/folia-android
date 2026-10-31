package top.izuna.foliamajor;

import android.content.Context;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

// 当前文件：原生可视化器的 GL 渲染层（试验）。
//
// 目的：把「整屏背景 + 频谱条」从 WebView 的 6.8MP 合成面上挪到一个独立的 Surface 上，
// 由 GL 线程直接画，不经过 Chromium 的合成器。频谱由 JS 以 20Hz 推过来（真实音频分析结果），
// 这里只做插值与绘制。默认关闭，由设置里的开关启动（见 FoliaNativeVisualizerPlugin）。

public class NativeVisualizerView extends GLSurfaceView {

    /** 频谱条数量：32 条在手机上已经足够密，顶点数也小。 */
    private static final int BAR_COUNT = 32;

    private final Renderer renderer = new Renderer();

    public NativeVisualizerView(Context context) {
        super(context);
        setEGLContextClientVersion(2);
        setPreserveEGLContextOnPause(true);
        setRenderer(renderer);
        setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
    }

    /** JS 推来一帧：32 条频谱（0..255）、总能量（0..255）、主题的两个颜色。 */
    public void pushFrame(float[] bands, float power, int primaryColor, int accentColor) {
        renderer.pushFrame(bands, power, primaryColor, accentColor);
    }

    private static final class Renderer implements GLSurfaceView.Renderer {

        private static final String VERTEX_SHADER =
            "attribute vec2 aPos;\n" +
            "void main() { gl_Position = vec4(aPos, 0.0, 1.0); }\n";

        private static final String FRAGMENT_SHADER =
            "precision mediump float;\n" +
            "uniform vec4 uColor;\n" +
            "void main() { gl_FragColor = uColor; }\n";

        /** 背景渐变用全屏四边形，颜色按屏幕高度插值。 */
        private static final String GRADIENT_VERTEX_SHADER =
            "attribute vec2 aPos;\n" +
            "varying float vY;\n" +
            "void main() { vY = aPos.y * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }\n";

        private static final String GRADIENT_FRAGMENT_SHADER =
            "precision mediump float;\n" +
            "varying float vY;\n" +
            "uniform vec4 uTop;\n" +
            "uniform vec4 uBottom;\n" +
            "void main() { gl_FragColor = mix(uBottom, uTop, vY); }\n";

        private int barProgram;
        private int gradientProgram;
        private int barPosAttr;
        private int barColorUniform;
        private int gradientPosAttr;
        private int gradientTopUniform;
        private int gradientBottomUniform;

        private FloatBuffer quadBuffer;
        private FloatBuffer gradientBuffer;
        private final FloatBuffer barBuffer = ByteBuffer
            .allocateDirect(BAR_COUNT * 6 * 2 * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer();

        private final float[] targetBands = new float[BAR_COUNT];
        private final float[] shownBands = new float[BAR_COUNT];
        private volatile float targetPower = 0f;
        private volatile float shownPower = 0f;
        private volatile int primary = 0xFF74EFD0;
        private volatile int accent = 0xFFFFFFFF;
        private volatile boolean hasFrame = false;

        void pushFrame(float[] bands, float power, int primaryColor, int accentColor) {
            if (bands != null && bands.length > 0) {
                for (int i = 0; i < BAR_COUNT; i++) {
                    final int source = Math.min(bands.length - 1, i * bands.length / BAR_COUNT);
                    targetBands[i] = Math.max(0f, Math.min(1f, bands[source] / 255f));
                }
            }
            targetPower = Math.max(0f, Math.min(1f, power / 255f));
            primary = primaryColor;
            accent = accentColor;
            hasFrame = true;
        }

        @Override
        public void onSurfaceCreated(GL10 unused, EGLConfig config) {
            barProgram = buildProgram(VERTEX_SHADER, FRAGMENT_SHADER);
            gradientProgram = buildProgram(GRADIENT_VERTEX_SHADER, GRADIENT_FRAGMENT_SHADER);
            barPosAttr = GLES20.glGetAttribLocation(barProgram, "aPos");
            barColorUniform = GLES20.glGetUniformLocation(barProgram, "uColor");
            gradientPosAttr = GLES20.glGetAttribLocation(gradientProgram, "aPos");
            gradientTopUniform = GLES20.glGetUniformLocation(gradientProgram, "uTop");
            gradientBottomUniform = GLES20.glGetUniformLocation(gradientProgram, "uBottom");

            quadBuffer = floatBuffer(new float[] {
                -1f, -1f, 1f, -1f, -1f, 1f,
                -1f, 1f, 1f, -1f, 1f, 1f,
            });
            gradientBuffer = floatBuffer(new float[] {
                -1f, -1f, 1f, -1f, -1f, 1f,
                -1f, 1f, 1f, -1f, 1f, 1f,
            });
            GLES20.glClearColor(0f, 0f, 0f, 1f);
        }

        @Override
        public void onSurfaceChanged(GL10 unused, int width, int height) {
            GLES20.glViewport(0, 0, width, height);
        }

        @Override
        public void onDrawFrame(GL10 unused) {
            // 平滑：向目标靠拢，避免 20Hz 的参数在 120Hz 的屏幕上跳。
            for (int i = 0; i < BAR_COUNT; i++) {
                shownBands[i] += (targetBands[i] - shownBands[i]) * 0.18f;
            }
            shownPower += (targetPower - shownPower) * 0.12f;

            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);

            drawGradient();
            drawBars();
        }

        private void drawGradient() {
            GLES20.glUseProgram(gradientProgram);
            final float topR = ((primary >> 16) & 0xFF) / 255f * 0.45f;
            final float topG = ((primary >> 8) & 0xFF) / 255f * 0.45f;
            final float topB = (primary & 0xFF) / 255f * 0.45f;
            GLES20.glUniform4f(gradientTopUniform, topR, topG, topB, 1f);
            GLES20.glUniform4f(gradientBottomUniform, 0.02f, 0.02f, 0.03f, 1f);
            GLES20.glEnableVertexAttribArray(gradientPosAttr);
            GLES20.glVertexAttribPointer(gradientPosAttr, 2, GLES20.GL_FLOAT, false, 0, gradientBuffer);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6);
            GLES20.glDisableVertexAttribArray(gradientPosAttr);
        }

        private void drawBars() {
            GLES20.glUseProgram(barProgram);
            GLES20.glEnable(GLES20.GL_BLEND);
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE);

            final float slot = 2f / BAR_COUNT;
            final float barWidth = slot * 0.55f;
            barBuffer.clear();
            for (int i = 0; i < BAR_COUNT; i++) {
                final float x = -1f + slot * i + (slot - barWidth) / 2f;
                final float height = 0.08f + shownBands[i] * 1.2f * (0.6f + shownPower * 0.8f);
                final float y = -1f;
                final float top = Math.min(y + height, 1f);
                barBuffer.put(x).put(y);
                barBuffer.put(x + barWidth).put(y);
                barBuffer.put(x).put(top);
                barBuffer.put(x).put(top);
                barBuffer.put(x + barWidth).put(y);
                barBuffer.put(x + barWidth).put(top);
            }
            barBuffer.position(0);

            final float r = ((accent >> 16) & 0xFF) / 255f;
            final float g = ((accent >> 8) & 0xFF) / 255f;
            final float b = (accent & 0xFF) / 255f;
            GLES20.glUniform4f(barColorUniform, r, g, b, 0.55f);

            GLES20.glEnableVertexAttribArray(barPosAttr);
            GLES20.glVertexAttribPointer(barPosAttr, 2, GLES20.GL_FLOAT, false, 0, barBuffer);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, BAR_COUNT * 6);
            GLES20.glDisableVertexAttribArray(barPosAttr);
            GLES20.glDisable(GLES20.GL_BLEND);
        }

        private static FloatBuffer floatBuffer(float[] data) {
            final FloatBuffer buffer = ByteBuffer
                .allocateDirect(data.length * 4)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer();
            buffer.put(data);
            buffer.position(0);
            return buffer;
        }

        private static int buildProgram(String vertexSource, String fragmentSource) {
            final int vertex = compileShader(GLES20.GL_VERTEX_SHADER, vertexSource);
            final int fragment = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource);
            final int program = GLES20.glCreateProgram();
            GLES20.glAttachShader(program, vertex);
            GLES20.glAttachShader(program, fragment);
            GLES20.glLinkProgram(program);
            GLES20.glDeleteShader(vertex);
            GLES20.glDeleteShader(fragment);
            return program;
        }

        private static int compileShader(int type, String source) {
            final int shader = GLES20.glCreateShader(type);
            GLES20.glShaderSource(shader, source);
            GLES20.glCompileShader(shader);
            return shader;
        }
    }
}
