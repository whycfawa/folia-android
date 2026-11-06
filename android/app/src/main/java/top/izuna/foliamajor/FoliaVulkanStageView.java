package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.text.TextPaint;
import android.view.Choreographer;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.util.AttributeSet;

/** Vulkan-only 原生舞台的 Surface 宿主。当前只验证 swapchain clear，后续效果全部走 Vulkan。 */
public class FoliaVulkanStageView extends SurfaceView implements SurfaceHolder.Callback, Runnable {
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
        getHolder().addCallback(this);
        setBackgroundColor(0xFF07070B);
        setZOrderMediaOverlay(false);
        canvasStage = new FoliaNativeStageView(getContext());
    }

    private native long nativeCreate(Surface surface);
    private native boolean nativeRender();
    private native boolean nativeReady();
    private native void nativeSetAccent(int color);
    private native void nativeSetPower(float power);
    private native void nativeSetMode(int mode);

    public boolean isVulkanReady() { return nativeReady(); }
    private native void nativeDestroy();
    private native void nativeUpdateText(int width, int height, int[] pixels);

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
    public void setDaylight(boolean daylight) { this.daylight = daylight; if (canvasStage != null) canvasStage.setDaylight(daylight); renderText(); }
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
        drawStillLine(canvas, paint, width, prevLine, prevTranslation, centerY - height * 0.12f, Math.max(24f, width * 0.034f), 0.3f);
        drawStillLine(canvas, paint, width, line, translation, centerY, Math.max(30f, width * 0.045f), 1f);
        drawStillLine(canvas, paint, width, nextLine, nextTranslation, centerY + height * 0.12f, Math.max(24f, width * 0.034f), 0.3f);
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

    @Override public void surfaceCreated(SurfaceHolder holder) {
        surfaceReady = true;
        nativeCreate(holder.getSurface());
        running = true;
        renderThread = new Thread(this, "FoliaVulkanStage");
        renderThread.start();
        scheduleFrame();
    }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { renderText(); }
    @Override public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceReady = false;
        running = false;
        Choreographer.getInstance().removeFrameCallback(frameCallback);
        frameScheduled = false;
        try { if (renderThread != null) renderThread.join(800); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        renderThread = null;
        nativeDestroy();
    }

    @Override public void run() {
        while (running) {
            try { if (nativeRender()) frameCount += 1; } catch (Throwable ignored) {}
            try { Thread.sleep(8L); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); return; }
        }
    }
}
