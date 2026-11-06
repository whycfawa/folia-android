package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Bitmap;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.util.AttributeSet;

/** Vulkan-only 原生舞台的 Surface 宿主。当前只验证 swapchain clear，后续效果全部走 Vulkan。 */
public class FoliaVulkanStageView extends SurfaceView implements SurfaceHolder.Callback, Runnable {
    static { System.loadLibrary("folia_vulkan"); }

    private Thread renderThread;
    private volatile boolean running;

    public FoliaVulkanStageView(Context context) { super(context); init(); }
    public FoliaVulkanStageView(Context context, AttributeSet attrs) { super(context, attrs); init(); }

    private void init() {
        getHolder().addCallback(this);
        setBackgroundColor(0xFF07070B);
    }

    private native long nativeCreate(Surface surface);
    private native boolean nativeRender();
    private native void nativeDestroy();
    private native void nativeUpdateText(int width, int height, int[] pixels);

    public void updateText(Bitmap bitmap) {
        if (bitmap == null) return;
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        nativeUpdateText(width, height, pixels);
    }

    @Override public void surfaceCreated(SurfaceHolder holder) {
        nativeCreate(holder.getSurface());
        running = true;
        renderThread = new Thread(this, "FoliaVulkanStage");
        renderThread.start();
    }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}
    @Override public void surfaceDestroyed(SurfaceHolder holder) {
        running = false;
        try { if (renderThread != null) renderThread.join(800); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        renderThread = null;
        nativeDestroy();
    }

    @Override public void run() {
        while (running) {
            try { nativeRender(); } catch (Throwable ignored) {}
            try { Thread.sleep(8L); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); return; }
        }
    }
}
