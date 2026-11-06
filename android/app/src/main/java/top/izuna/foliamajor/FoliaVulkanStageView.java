package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.text.TextPaint;
import android.view.Choreographer;

import java.util.ArrayList;
import java.util.List;
import android.view.Surface;
import android.graphics.SurfaceTexture;
import android.view.TextureView;
import android.util.AttributeSet;

/** Vulkan-only 原生舞台的 Surface 宿主。当前只验证 swapchain clear，后续效果全部走 Vulkan。 */
public class FoliaVulkanStageView extends TextureView implements TextureView.SurfaceTextureListener, Runnable {
    static { System.loadLibrary("folia_vulkan"); }

    private Thread renderThread;
    private volatile boolean running;
    private long frameCount;
    private long lastCanvasFrameMs;
    private String mode = "classic";
    private String line = "";
    private String prevLine = "";
    private String nextLine = "";
    private String translation = "";
    private String prevTranslation = "";
    private String nextTranslation = "";
    private int accent = 0xFF7C9BFF;
    private boolean playing = true;
    private boolean daylight = false;
    private boolean surfaceReady;
    private boolean chorus;
    private FoliaNativeStageView canvasStage;
    private VulkanTextAtlas textAtlas;
    private VulkanTextAtlas textAtlasSmall;
    private String atlasKey = "";
    private Bitmap frameBitmap;
    private int[] framePixels;
    private Canvas frameCanvas;
    private boolean frameScheduled;

    private final Choreographer.FrameCallback frameCallback = new Choreographer.FrameCallback() {
        @Override public void doFrame(long frameTimeNanos) {
            frameScheduled = false;
            if (!running || !surfaceReady) return;
            renderText();
            scheduleFrame();
        }
    };

    private void scheduleFrame() {
        if (frameScheduled || !running || !surfaceReady) return;
        frameScheduled = true;
        Choreographer.getInstance().postFrameCallback(frameCallback);
    }

    public FoliaVulkanStageView(Context context) { super(context); init(); }
    public FoliaVulkanStageView(Context context, AttributeSet attrs) { super(context, attrs); init(); }

    private void init() {
        setSurfaceTextureListener(this);
        setOpaque(false);
        setBackgroundColor(0x00000000);
        canvasStage = new FoliaNativeStageView(getContext());
    }

    private native long nativeCreate(Surface surface);
    private native boolean nativeRender();
    private native boolean nativeReady();
    private native boolean nativeHasPipeline();
    private native String nativeLastError();
    private native void nativeSetAccent(int color);
    private native void nativeSetPower(float power);
    private native void nativeSetMode(int mode);
    private native void nativeSetDaylight(boolean daylight);

    public boolean isVulkanReady() { return nativeReady(); }
    public boolean hasVulkanPipeline() { return nativeHasPipeline(); }
    public String getVulkanError() { return nativeLastError(); }
    private native void nativeDestroy();
    private native void nativeUpdateText(int width, int height, int[] pixels);
    private native void nativeUpdateAtlas(int width, int height, int[] pixels);
    private native void nativeUpdateQuads(float[] vertices, int count);

    private int sceneMode(String mode) {
        switch (mode) {
            case "lumiere": return 1;
            case "sonnet": return 2;
            case "nebbia": return 3;
            case "hanabi": return 4;
            case "machi": return 5;
            case "fume": return 6;
            case "monet": return 7;
            case "diorama": return 8;
            case "pendolo": return 9;
            case "tempera": return 10;
            case "tilt": return 11;
            case "cadenza": return 12;
            case "claddagh": return 13;
            case "partita": return 14;
            case "cappella": return 15;
            case "classic": return 16;
            case "still": return 17;
            default: return 0;
        }
    }

    public void update(String mode, String line, String nextLine, String prevLine,
                       String lineTranslation, String prevTranslation, String nextTranslation,
                       String title, String artist, String accentHex, boolean playing, boolean chorus) {
        this.mode = mode == null ? "classic" : mode;
        nativeSetMode(sceneMode(this.mode));
        this.line = line == null ? "" : line;
        this.prevLine = prevLine == null ? "" : prevLine;
        this.nextLine = nextLine == null ? "" : nextLine;
        this.translation = lineTranslation == null ? "" : lineTranslation;
        this.prevTranslation = prevTranslation == null ? "" : prevTranslation;
        this.nextTranslation = nextTranslation == null ? "" : nextTranslation;
        this.playing = playing;
        this.chorus = chorus;
        if (canvasStage != null) canvasStage.update(mode, line, nextLine, prevLine, lineTranslation, prevTranslation, nextTranslation, title, artist, accentHex, playing, chorus);
        try { if (accentHex != null && !accentHex.isEmpty()) { accent = Color.parseColor(accentHex); nativeSetAccent(accent); } } catch (Throwable ignored) {}
        renderText();
    }

    public void setThemeColors(String primary, String secondary, String background) {
        if (canvasStage != null) canvasStage.setThemeColors(primary, secondary, background);
        try {
            if (primary != null && !primary.isEmpty()) {
                accent = Color.parseColor(primary);
                nativeSetAccent(accent);
                renderText();
            }
        } catch (Throwable ignored) {}
    }
    public void setDaylight(boolean daylight) { this.daylight = daylight; nativeSetDaylight(daylight); if (canvasStage != null) canvasStage.setDaylight(daylight); renderText(); }
    public void updateAudio(float power, float bass, float mid, float treble) {
        nativeSetPower(power);
        if (canvasStage != null) canvasStage.updateAudio(power, bass, mid, treble);
    }
    public void updateWords(String json, float position) {
        if (canvasStage != null) canvasStage.updateWords(json, position);
    }
    public void setLineProgress(float progress) {
        if (canvasStage != null) canvasStage.setLineProgress(progress);
    }
    public long getFrameCount() { return frameCount; }
    public long getCanvasFrameMs() { return lastCanvasFrameMs; }
    public boolean isSurfaceReady() { return surfaceReady; }
    public boolean isPlaying() { return playing; }

    private void renderText() {
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) return;
        if (frameBitmap == null || frameBitmap.getWidth() != width || frameBitmap.getHeight() != height) {
            frameBitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            framePixels = new int[width * height];
            frameCanvas = new Canvas(frameBitmap);
        }
        long startedAt = android.os.SystemClock.uptimeMillis();
        Canvas canvas = frameCanvas;
        canvas.drawColor(Color.TRANSPARENT);
        if ("still".equals(mode)) {
            if (drawStillAtlas(width, height)) return;
            nativeUpdateQuads(new float[0], 0);
            drawStillText(canvas, width, height);
        } else if ("classic".equals(mode) && canvasStage != null) {
            canvasStage.drawClassicLayer(canvas, width, height);
        } else if ("lumiere".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("sonnet".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("nebbia".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("hanabi".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("machi".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("fume".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("monet".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("diorama".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("pendolo".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("tempera".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("tilt".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("cadenza".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("claddagh".equals(mode) && canvasStage != null) {
            canvasStage.drawLumiereLayer(canvas, width, height);
        } else if ("partita".equals(mode) && canvasStage != null) {
            canvasStage.drawPartitaLayer(canvas, width, height);
        } else if ("cappella".equals(mode) && canvasStage != null) {
            canvasStage.drawCappellaLayer(canvas, width, height);
        } else if (canvasStage != null) {
            canvasStage.measure(
                    android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY),
                    android.view.View.MeasureSpec.makeMeasureSpec(height, android.view.View.MeasureSpec.EXACTLY));
            canvasStage.layout(0, 0, width, height);
            canvasStage.draw(canvas);
        }
        frameBitmap.getPixels(framePixels, 0, width, 0, 0, width, height);
        nativeUpdateText(width, height, framePixels);
        lastCanvasFrameMs = android.os.SystemClock.uptimeMillis() - startedAt;
    }

    private void drawStillText(Canvas canvas, int width, int height) {
        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setFakeBoldText(true);
        float centerY = height * 0.5f;
        drawStillLine(canvas, paint, width, prevLine, prevTranslation, centerY - dp(118), dp(30), 0.3f);
        drawStillLine(canvas, paint, width, line, translation, centerY, dp(40), 1f);
        drawStillLine(canvas, paint, width, nextLine, nextTranslation, centerY + dp(118), dp(30), 0.3f);
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    private boolean drawStillAtlas(int width, int height) {
        String key = daylight + "\u0000" + prevLine + "\u0000" + line + "\u0000" + nextLine + "\u0000" + prevTranslation + "\u0000" + translation + "\u0000" + nextTranslation;
        if (key.equals(atlasKey)) return true;
        atlasKey = key;
        if (textAtlas == null) textAtlas = new VulkanTextAtlas();
        List<Float> vertices = new ArrayList<>();
        float centerY = height * 0.5f;
        textAtlas.setWeight(600);
        textAtlas.setTextSize(dp(30));
        emitStillLine(vertices, width, height, textAtlas, prevLine, prevTranslation, centerY - dp(118), 1f, 0.3f);
        textAtlas.setWeight(700);
        textAtlas.setTextSize(dp(40));
        emitStillLine(vertices, width, height, textAtlas, line, translation, centerY, 1f, 1f);
        textAtlas.setWeight(600);
        textAtlas.setTextSize(dp(30));
        emitStillLine(vertices, width, height, textAtlas, nextLine, nextTranslation, centerY + dp(118), 1f, 0.3f);
        nativeUpdateAtlas(VulkanTextAtlas.SIZE, VulkanTextAtlas.SIZE, textAtlas.pixels());
        float[] data = new float[vertices.size()];
        for (int i = 0; i < data.length; i++) data[i] = vertices.get(i);
        nativeUpdateQuads(data, data.length / 8);
        return !textAtlas.overflowed();
    }

    private void emitStillLine(List<Float> vertices, int width, int height, VulkanTextAtlas atlas, String text, String trans, float baselineY, float scale, float alpha) {
        emitTextRun(vertices, width, height, atlas, text, baselineY, scale, alpha);
        if (trans != null && !trans.isEmpty()) {
            atlas.setWeight(500);
            atlas.setTextSize(dp(24));
            emitTextRun(vertices, width, height, atlas, trans, baselineY + dp(34) * scale, 1f, alpha * 0.75f);
        }
    }

    private void emitTextRun(List<Float> vertices, int width, int height, VulkanTextAtlas atlas, String text, float baselineY, float scale, float alpha) {
        if (text == null || text.isEmpty()) return;
        List<String> lines = wrapText(text, scale, atlas);
        float lineHeight = dp(52) * scale;
        float startY = baselineY - (lines.size() - 1) * lineHeight * 0.5f;
        for (int lineIndex = 0; lineIndex < lines.size(); lineIndex++) {
            emitGlyphLine(vertices, width, height, atlas, lines.get(lineIndex), startY + lineIndex * lineHeight, scale, alpha);
        }
    }

    private List<String> wrapText(String text, float scale, VulkanTextAtlas atlas) {
        List<String> lines = new ArrayList<>();
        float maxWidth = dp(896);
        StringBuilder current = new StringBuilder();
        float currentWidth = 0f;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            VulkanTextAtlas.Glyph glyph = atlas.get(c);
            float advance = glyph == null ? 0f : glyph.advance * scale;
            if (currentWidth + advance > maxWidth && current.length() > 0) {
                lines.add(current.toString());
                current.setLength(0);
                currentWidth = 0f;
            }
            current.append(c);
            currentWidth += advance;
        }
        if (current.length() > 0) lines.add(current.toString());
        return lines;
    }

    private void emitGlyphLine(List<Float> vertices, int width, int height, VulkanTextAtlas atlas, String text, float baselineY, float scale, float alpha) {
        float total = 0f;
        for (int i = 0; i < text.length(); i++) {
            VulkanTextAtlas.Glyph glyph = atlas.get(text.charAt(i));
            if (glyph != null) total += glyph.advance;
        }
        float x = (width - total * scale) / 2f;
        float r = daylight ? 0.07f : 1f;
        float g = daylight ? 0.07f : 1f;
        float b = daylight ? 0.07f : 1f;
        for (int i = 0; i < text.length(); i++) {
            VulkanTextAtlas.Glyph glyph = atlas.get(text.charAt(i));
            if (glyph == null) continue;
            float w = glyph.width * scale;
            float h = glyph.height * scale;
            float top = baselineY - glyph.baseline * scale;
            float x0 = x / width;
            float x1 = (x + w) / width;
            float y0 = top / height;
            float y1 = (top + h) / height;
            addQuad(vertices, x0, y0, x1, y1, glyph.u0, glyph.v0, glyph.u1, glyph.v1, r, g, b, alpha);
            x += glyph.advance * scale;
        }
    }

    private void addQuad(List<Float> v, float x0, float y0, float x1, float y1, float u0, float v0, float u1, float v1, float r, float g, float b, float a) {
        addVertex(v, x0, y0, u0, v0, r, g, b, a);
        addVertex(v, x1, y0, u1, v0, r, g, b, a);
        addVertex(v, x1, y1, u1, v1, r, g, b, a);
        addVertex(v, x0, y0, u0, v0, r, g, b, a);
        addVertex(v, x1, y1, u1, v1, r, g, b, a);
        addVertex(v, x0, y1, u0, v1, r, g, b, a);
    }

    private void addVertex(List<Float> v, float x, float y, float u, float vv, float r, float g, float b, float a) {
        v.add(x); v.add(y); v.add(u); v.add(vv);
        v.add(r); v.add(g); v.add(b); v.add(a);
    }

    private void drawStillLine(Canvas canvas, TextPaint paint, int width, String text, String trans, float y, float size, float alpha) {
        if (text == null || text.isEmpty()) return;
        paint.setTextSize(size);
        paint.setColor((Math.round(255 * alpha) << 24) | (daylight ? 0x111111 : 0xFFFFFF));
        canvas.drawText(text, width / 2f, y, paint);
        if (trans != null && !trans.isEmpty()) {
            paint.setTextSize(size * 0.52f);
            paint.setColor((Math.round(180 * alpha) << 24) | (daylight ? 0x111111 : 0xFFFFFF));
            canvas.drawText(trans, width / 2f, y + size * 1.3f, paint);
        }
    }

    public void updateText(Bitmap bitmap) {
        if (bitmap == null) return;
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        nativeUpdateText(width, height, pixels);
    }

    private void createVulkan(SurfaceTexture texture) {
        if (nativeReady() || texture == null) return;
        Surface surface = new Surface(texture);
        nativeCreate(surface);
        surface.release();
    }

    @Override public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) {
        surfaceReady = true;
        createVulkan(texture);
        if (!running) {
            running = true;
            renderThread = new Thread(this, "FoliaVulkanStage");
            renderThread.start();
        }
        renderText();
        scheduleFrame();
    }

    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture texture, int width, int height) {
        createVulkan(texture);
        renderText();
    }

    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture texture) {
        surfaceReady = false;
        running = false;
        Choreographer.getInstance().removeFrameCallback(frameCallback);
        frameScheduled = false;
        try { if (renderThread != null) renderThread.join(800); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        renderThread = null;
        nativeDestroy();
        return true;
    }

    @Override public void onSurfaceTextureUpdated(SurfaceTexture texture) {}

    @Override public void run() {
        while (running) {
            try { if (nativeRender()) frameCount += 1; } catch (Throwable ignored) {}
            try { Thread.sleep(8L); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); return; }
        }
    }
}
