package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.GLUtils;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

// 当前文件：原生可视化器（试验）的 GL 渲染层。
//
// 画三样东西：整屏渐变背景、32 条频谱、当前/下一句歌词（文字先画进 Bitmap，再当纹理贴上去）。
// 频谱与歌词由 JS 推过来（歌词只在换行时推），插值与动画全在 GL 线程完成，不经过 Chromium 的合成器。
// 默认关闭；开启时页面会卸载自己的可视化器（见 App.tsx 的 nativeStageOn），这一层就成了播放页的画面。

public class NativeVisualizerView extends GLSurfaceView {

    private static final int BAR_COUNT = 32;
    /** 歌词纹理的横向像素：1024 足够一行中文在手机上清楚，也不会让纹理上传变慢。 */
    private static final int LYRIC_TEXTURE_WIDTH = 1024;

    private final Renderer renderer = new Renderer();

    public NativeVisualizerView(Context context) {
        super(context);
        setEGLContextClientVersion(2);
        setPreserveEGLContextOnPause(true);
        setRenderer(renderer);
        setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
    }

    public void pushFrame(float[] bands, float power, int primaryColor, int accentColor) {
        renderer.pushFrame(bands, power, primaryColor, accentColor);
    }

    /** 0=频谱条 1=环形 2=波形；JS 按当前歌词效果映射过来。 */
    public void setStyle(int style) {
        renderer.setStyle(style);
    }

    /** 换行时才调：把两句歌词画成位图交给 GL 线程。 */
    public void setLyrics(String current, String next) {
        final Bitmap currentBitmap = current == null || current.isEmpty()
            ? null
            : renderLine(current, 46, 0xFFFFFFFF, true);
        final Bitmap nextBitmap = next == null || next.isEmpty()
            ? null
            : renderLine(next, 30, 0xB3FFFFFF, false);
        renderer.setLyricBitmaps(currentBitmap, nextBitmap);
    }

    /** 一行文字 → 位图：居中、超宽自动缩小，中文字形由系统字体给。 */
    private static Bitmap renderLine(String text, int textSizeSp, int color, boolean bold) {
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setTypeface(bold ? Typeface.create(Typeface.DEFAULT, Typeface.BOLD) : Typeface.DEFAULT);
        paint.setTextSize(textSizeSp * 2.4f);
        paint.setColor(color);
        paint.setTextAlign(Paint.Align.CENTER);

        float measured = paint.measureText(text);
        final float maxWidth = LYRIC_TEXTURE_WIDTH - 48f;
        if (measured > maxWidth && measured > 0f) {
            paint.setTextSize(paint.getTextSize() * maxWidth / measured);
        }
        final int height = Math.max(1, Math.round(paint.getTextSize() * 2.2f));
        final Bitmap bitmap = Bitmap.createBitmap(LYRIC_TEXTURE_WIDTH, height, Bitmap.Config.ARGB_8888);
        final Canvas canvas = new Canvas(bitmap);
        canvas.drawText(text, LYRIC_TEXTURE_WIDTH / 2f, height * 0.72f, paint);
        return bitmap;
    }

    private static final class Renderer implements GLSurfaceView.Renderer {

        private static final String SOLID_VERTEX =
            "attribute vec2 aPos;\n" +
            "void main() { gl_Position = vec4(aPos, 0.0, 1.0); }\n";

        private static final String SOLID_FRAGMENT =
            "precision mediump float;\n" +
            "uniform vec4 uColor;\n" +
            "void main() { gl_FragColor = uColor; }\n";

        private static final String GRADIENT_VERTEX =
            "attribute vec2 aPos;\n" +
            "varying float vY;\n" +
            "void main() { vY = aPos.y * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }\n";

        private static final String GRADIENT_FRAGMENT =
            "precision mediump float;\n" +
            "varying float vY;\n" +
            "uniform vec4 uTop;\n" +
            "uniform vec4 uBottom;\n" +
            "void main() { gl_FragColor = mix(uBottom, uTop, vY); }\n";

        private static final String TEXT_VERTEX =
            "attribute vec2 aPos;\n" +
            "attribute vec2 aTex;\n" +
            "varying vec2 vTex;\n" +
            "void main() { vTex = aTex; gl_Position = vec4(aPos, 0.0, 1.0); }\n";

        private static final String TEXT_FRAGMENT =
            "precision mediump float;\n" +
            "varying vec2 vTex;\n" +
            "uniform sampler2D uTex;\n" +
            "void main() { gl_FragColor = texture2D(uTex, vTex); }\n";

        private int solidProgram;
        private int gradientProgram;
        private int textProgram;
        private int solidPosAttr;
        private int solidColorUniform;
        private int gradientPosAttr;
        private int gradientTopUniform;
        private int gradientBottomUniform;
        private int textPosAttr;
        private int textTexAttr;
        private int textSamplerUniform;

        private int viewportWidth = 1;
        private int viewportHeight = 1;

        private FloatBuffer quadBuffer;
        private FloatBuffer textBuffer;
        /** 环形 / 波形用的段数，比频谱条多，缓冲统一按它分配。 */
        private static final int SEGMENTS = 64;
        private final FloatBuffer barBuffer = ByteBuffer
            .allocateDirect(SEGMENTS * 6 * 2 * 4)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer();

        private final float[] targetBands = new float[SEGMENTS];
        private final float[] shownBands = new float[SEGMENTS];
        private volatile int style = 0;
        private float clock = 0f;
        private volatile float targetPower = 0f;
        private volatile float shownPower = 0f;
        private volatile int primary = 0xFF74EFD0;
        private volatile int accent = 0xFFFFFFFF;

        private volatile Bitmap pendingCurrent;
        private volatile Bitmap pendingNext;
        private int currentTexture = 0;
        private int nextTexture = 0;
        private int currentWidth = 1;
        private int currentHeight = 1;
        private int nextWidth = 1;
        private int nextHeight = 1;

        void pushFrame(float[] bands, float power, int primaryColor, int accentColor) {
            if (bands != null && bands.length > 0) {
                for (int i = 0; i < SEGMENTS; i++) {
                    final int source = Math.min(bands.length - 1, i * bands.length / SEGMENTS);
                    targetBands[i] = Math.max(0f, Math.min(1f, bands[source] / 255f));
                }
            }
            targetPower = Math.max(0f, Math.min(1f, power / 255f));
            primary = primaryColor;
            accent = accentColor;
        }

        void setStyle(int next) {
            style = next;
        }

        void setLyricBitmaps(Bitmap current, Bitmap next) {
            pendingCurrent = current;
            pendingNext = next;
        }

        @Override
        public void onSurfaceCreated(GL10 unused, EGLConfig config) {
            solidProgram = buildProgram(SOLID_VERTEX, SOLID_FRAGMENT);
            gradientProgram = buildProgram(GRADIENT_VERTEX, GRADIENT_FRAGMENT);
            textProgram = buildProgram(TEXT_VERTEX, TEXT_FRAGMENT);
            solidPosAttr = GLES20.glGetAttribLocation(solidProgram, "aPos");
            solidColorUniform = GLES20.glGetUniformLocation(solidProgram, "uColor");
            gradientPosAttr = GLES20.glGetAttribLocation(gradientProgram, "aPos");
            gradientTopUniform = GLES20.glGetUniformLocation(gradientProgram, "uTop");
            gradientBottomUniform = GLES20.glGetUniformLocation(gradientProgram, "uBottom");
            textPosAttr = GLES20.glGetAttribLocation(textProgram, "aPos");
            textTexAttr = GLES20.glGetAttribLocation(textProgram, "aTex");
            textSamplerUniform = GLES20.glGetUniformLocation(textProgram, "uTex");

            quadBuffer = floatBuffer(new float[] {
                -1f, -1f, 1f, -1f, -1f, 1f,
                -1f, 1f, 1f, -1f, 1f, 1f,
            });
            textBuffer = floatBuffer(new float[12]);
            GLES20.glClearColor(0f, 0f, 0f, 1f);
        }

        @Override
        public void onSurfaceChanged(GL10 unused, int width, int height) {
            viewportWidth = Math.max(1, width);
            viewportHeight = Math.max(1, height);
            GLES20.glViewport(0, 0, viewportWidth, viewportHeight);
        }

        @Override
        public void onDrawFrame(GL10 unused) {
            for (int i = 0; i < SEGMENTS; i++) {
                shownBands[i] += (targetBands[i] - shownBands[i]) * 0.18f;
            }
            shownPower += (targetPower - shownPower) * 0.12f;
            clock += 0.016f;

            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
            drawGradient();
            if (style == 1) {
                drawRing();
            } else if (style == 2) {
                drawWave();
            } else {
                drawBars();
            }
            uploadPendingTextures();
            drawLyrics();
        }

        private void uploadPendingTextures() {
            final Bitmap next = pendingNext;
            if (next != null) {
                pendingNext = null;
                nextTexture = upload(nextTexture, next, true);
                nextWidth = next.getWidth();
                nextHeight = next.getHeight();
            }
            final Bitmap current = pendingCurrent;
            if (current != null) {
                pendingCurrent = null;
                currentTexture = upload(currentTexture, current, false);
                currentWidth = current.getWidth();
                currentHeight = current.getHeight();
            }
        }

        private int upload(int texture, Bitmap bitmap, boolean recycle) {
            if (texture == 0) {
                final int[] names = new int[1];
                GLES20.glGenTextures(1, names, 0);
                texture = names[0];
            }
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
            if (recycle) bitmap.recycle();
            return texture;
        }

        private void drawGradient() {
            GLES20.glUseProgram(gradientProgram);
            GLES20.glUniform4f(
                gradientTopUniform,
                Color.red(primary) / 255f * 0.40f,
                Color.green(primary) / 255f * 0.40f,
                Color.blue(primary) / 255f * 0.40f,
                1f
            );
            GLES20.glUniform4f(gradientBottomUniform, 0.02f, 0.02f, 0.03f, 1f);
            GLES20.glEnableVertexAttribArray(gradientPosAttr);
            GLES20.glVertexAttribPointer(gradientPosAttr, 2, GLES20.GL_FLOAT, false, 0, quadBuffer);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6);
            GLES20.glDisableVertexAttribArray(gradientPosAttr);
        }

        private void drawBars() {
            GLES20.glUseProgram(solidProgram);
            GLES20.glEnable(GLES20.GL_BLEND);
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE);

            final int bars = 32;
            final float slot = 2f / bars;
            final float barWidth = slot * 0.55f;
            barBuffer.clear();
            for (int i = 0; i < bars; i++) {
                final float x = -1f + slot * i + (slot - barWidth) / 2f;
                final float height = 0.05f + shownBands[i * 2] * 0.55f * (0.6f + shownPower * 0.8f);
                final float top = Math.min(-1f + height, 1f);
                barBuffer.put(x).put(-1f);
                barBuffer.put(x + barWidth).put(-1f);
                barBuffer.put(x).put(top);
                barBuffer.put(x).put(top);
                barBuffer.put(x + barWidth).put(-1f);
                barBuffer.put(x + barWidth).put(top);
            }
            barBuffer.position(0);

            GLES20.glUniform4f(
                solidColorUniform,
                Color.red(accent) / 255f,
                Color.green(accent) / 255f,
                Color.blue(accent) / 255f,
                0.42f
            );
            GLES20.glEnableVertexAttribArray(solidPosAttr);
            GLES20.glVertexAttribPointer(solidPosAttr, 2, GLES20.GL_FLOAT, false, 0, barBuffer);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, bars * 6);
            GLES20.glDisableVertexAttribArray(solidPosAttr);
            GLES20.glDisable(GLES20.GL_BLEND);
        }


        /** 环形：绕着屏幕中心的一圈频谱，半径随能量呼吸，缓慢旋转。 */
        private void drawRing() {
            GLES20.glUseProgram(solidProgram);
            GLES20.glEnable(GLES20.GL_BLEND);
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE);

            final float aspect = viewportWidth / (float) viewportHeight;
            final float baseRadius = 0.26f + shownPower * 0.12f;
            final float rotation = clock * 0.35f;
            barBuffer.clear();
            for (int i = 0; i < SEGMENTS; i++) {
                final float angle = (float) (Math.PI * 2 * i / SEGMENTS) + rotation;
                final float band = shownBands[i];
                final float inner = baseRadius;
                final float outer = baseRadius + 0.05f + band * 0.36f;
                final float thickness = 0.010f + 0.010f * band;
                final float cos = (float) Math.cos(angle);
                final float sin = (float) Math.sin(angle);
                final float nx = -sin * thickness;
                final float ny = cos * thickness * aspect;

                final float ix = cos * inner;
                final float iy = sin * inner * aspect;
                final float ox = cos * outer;
                final float oy = sin * outer * aspect;

                barBuffer.put(ix - nx).put(iy - ny);
                barBuffer.put(ix + nx).put(iy + ny);
                barBuffer.put(ox - nx).put(oy - ny);
                barBuffer.put(ox - nx).put(oy - ny);
                barBuffer.put(ix + nx).put(iy + ny);
                barBuffer.put(ox + nx).put(oy + ny);
            }
            barBuffer.position(0);

            GLES20.glUniform4f(
                solidColorUniform,
                Color.red(accent) / 255f,
                Color.green(accent) / 255f,
                Color.blue(accent) / 255f,
                0.55f
            );
            GLES20.glEnableVertexAttribArray(solidPosAttr);
            GLES20.glVertexAttribPointer(solidPosAttr, 2, GLES20.GL_FLOAT, false, 0, barBuffer);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, SEGMENTS * 6);
            GLES20.glDisableVertexAttribArray(solidPosAttr);
            GLES20.glDisable(GLES20.GL_BLEND);
        }

        /** 波形：屏幕下部一条起伏的带子，左右铺满。 */
        private void drawWave() {
            GLES20.glUseProgram(solidProgram);
            GLES20.glEnable(GLES20.GL_BLEND);
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE);

            final float left = -0.9f;
            final float right = 0.9f;
            final float step = (right - left) / (SEGMENTS - 1);
            final float baseline = -0.45f;
            barBuffer.clear();
            for (int i = 0; i < SEGMENTS - 1; i++) {
                final float x0 = left + step * i;
                final float x1 = x0 + step;
                final float y0 = baseline + shownBands[i] * 0.45f;
                final float y1 = baseline + shownBands[i + 1] * 0.45f;
                final float thickness = 0.008f + shownPower * 0.012f;

                barBuffer.put(x0).put(y0 - thickness);
                barBuffer.put(x1).put(y1 - thickness);
                barBuffer.put(x0).put(y0 + thickness);
                barBuffer.put(x0).put(y0 + thickness);
                barBuffer.put(x1).put(y1 - thickness);
                barBuffer.put(x1).put(y1 + thickness);
            }
            barBuffer.position(0);

            GLES20.glUniform4f(
                solidColorUniform,
                Color.red(primary) / 255f,
                Color.green(primary) / 255f,
                Color.blue(primary) / 255f,
                0.75f
            );
            GLES20.glEnableVertexAttribArray(solidPosAttr);
            GLES20.glVertexAttribPointer(solidPosAttr, 2, GLES20.GL_FLOAT, false, 0, barBuffer);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, (SEGMENTS - 1) * 6);
            GLES20.glDisableVertexAttribArray(solidPosAttr);
            GLES20.glDisable(GLES20.GL_BLEND);
        }

        private void drawLyrics() {
            drawTexture(currentTexture, currentWidth, currentHeight, 0.02f, 0.86f);
            drawTexture(nextTexture, nextWidth, nextHeight, -0.12f, 0.55f);
        }

        /** 按纹理宽高比把两块四边形摆在屏幕中部；宽度按屏幕比例收一点，长句不至于顶满。 */
        private void drawTexture(int texture, int bitmapWidth, int bitmapHeight, float centerY, float widthFraction) {
            if (texture == 0 || bitmapWidth <= 1 || bitmapHeight <= 1) return;
            final float aspect = (float) bitmapWidth / (float) bitmapHeight;
            final float halfWidth = widthFraction;
            // NDC 的高度要按屏幕宽高比换算，否则字会被拉扁。
            final float halfHeight = halfWidth * viewportHeight / (float) viewportWidth / aspect;

            textBuffer.clear();
            putQuad(textBuffer, -halfWidth, centerY - halfHeight, halfWidth, centerY + halfHeight);
            textBuffer.position(0);

            GLES20.glUseProgram(textProgram);
            GLES20.glEnable(GLES20.GL_BLEND);
            GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture);
            GLES20.glUniform1i(textSamplerUniform, 0);
            GLES20.glEnableVertexAttribArray(textPosAttr);
            GLES20.glVertexAttribPointer(textPosAttr, 2, GLES20.GL_FLOAT, false, 0, textBuffer);
            GLES20.glEnableVertexAttribArray(textTexAttr);
            GLES20.glVertexAttribPointer(textTexAttr, 2, GLES20.GL_FLOAT, false, 0, uvBuffer());
            GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6);
            GLES20.glDisableVertexAttribArray(textPosAttr);
            GLES20.glDisableVertexAttribArray(textTexAttr);
            GLES20.glDisable(GLES20.GL_BLEND);
        }

        private FloatBuffer uvBufferCache;

        private FloatBuffer uvBuffer() {
            if (uvBufferCache == null) {
                // 位图上传后纹理坐标原点在左上，这里翻一下 Y。
                uvBufferCache = floatBuffer(new float[] {
                    0f, 1f, 1f, 1f, 0f, 0f,
                    0f, 0f, 1f, 1f, 1f, 0f,
                });
            }
            return uvBufferCache;
        }

        private static void putQuad(FloatBuffer buffer, float left, float bottom, float right, float top) {
            buffer.put(left).put(bottom);
            buffer.put(right).put(bottom);
            buffer.put(left).put(top);
            buffer.put(left).put(top);
            buffer.put(right).put(bottom);
            buffer.put(right).put(top);
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
