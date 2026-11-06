package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.text.TextPaint;
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
    private String mode = "classic";
    private String line = "";
    private String translation = "";
    private int accent = 0xFF7C9BFF;
    private boolean playing = true;
    private boolean daylight = false;
    private boolean surfaceReady;

    public FoliaVulkanStageView(Context context) { super(context); init(); }
    public FoliaVulkanStageView(Context context, AttributeSet attrs) { super(context, attrs); init(); }

    private void init() {
        getHolder().addCallback(this);
        setBackgroundColor(0xFF07070B);
        setZOrderMediaOverlay(false);
    }

    private native long nativeCreate(Surface surface);
    private native boolean nativeRender();
    private native boolean nativeReady();
    private native void nativeSetAccent(int color);
    private native void nativeSetPower(float power);

    public boolean isVulkanReady() { return nativeReady(); }
    private native void nativeDestroy();
    private native void nativeUpdateText(int width, int height, int[] pixels);

    public void update(String mode, String line, String nextLine, String prevLine,
                       String lineTranslation, String prevTranslation, String nextTranslation,
                       String title, String artist, String accentHex, boolean playing, boolean chorus) {
        this.mode = mode == null ? "classic" : mode;
        this.line = line == null ? "" : line;
        this.translation = lineTranslation == null ? "" : lineTranslation;
        this.playing = playing;
        try { if (accentHex != null && !accentHex.isEmpty()) { accent = Color.parseColor(accentHex); nativeSetAccent(accent); } } catch (Throwable ignored) {}
        renderText();
    }

    public void setThemeColors(String primary, String secondary, String background) {
        try {
            if (primary != null && !primary.isEmpty()) {
                accent = Color.parseColor(primary);
                nativeSetAccent(accent);
                renderText();
            }
        } catch (Throwable ignored) {}
    }
    public void setDaylight(boolean daylight) { this.daylight = daylight; renderText(); }
    public void updateAudio(float power, float bass, float mid, float treble) {
        nativeSetPower(power);
    }
    public void updateWords(String json, float position) {}
    public void setLineProgress(float progress) {}
    public long getFrameCount() { return frameCount; }
    public boolean isSurfaceReady() { return surfaceReady; }
    public boolean isPlaying() { return playing; }

    private void renderText() {
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) return;
        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.TRANSPARENT);
        TextPaint paint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        paint.setTextAlign(Paint.Align.CENTER);
        paint.setColor(daylight ? 0xFF111111 : 0xFFFFFFFF);
        paint.setTextSize(Math.max(28f, Math.min(64f, width * 0.055f)));
        paint.setFakeBoldText(true);
        if (!line.isEmpty()) canvas.drawText(line, width / 2f, height * 0.52f, paint);
        if (!translation.isEmpty()) {
            paint.setTextSize(Math.max(14f, paint.getTextSize() * 0.44f));
            paint.setColor(daylight ? 0x99111111 : 0x99FFFFFF);
            canvas.drawText(translation, width / 2f, height * 0.6f, paint);
        }
        updateText(bitmap);
        bitmap.recycle();
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
    }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) { renderText(); }
    @Override public void surfaceDestroyed(SurfaceHolder holder) {
        surfaceReady = false;
        running = false;
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
