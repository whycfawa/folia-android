package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.os.SystemClock;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.util.AttributeSet;
import android.view.Choreographer;
import android.view.View;

/**
 * 实验性的原生播放舞台：只画渐变背景 + 当前/下一句歌词。
 * 由 FoliaNativeStagePlugin 放在 WebView 后面；WebView 透明，现有控件仍由 WebView 绘制。
 * 绘制路径按帧缓存渐变和 StaticLayout，暂停/不可见时停止 Choreographer。
 */
public class FoliaNativeStageView extends View {
    private static final long FRAME_INTERVAL_MS = 8L;

    private final TextPaint lyricPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint nextPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint metaPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private String line = "";
    private String nextLine = "";
    private String title = "";
    private String artist = "";
    private int accent = 0xFF7C9BFF;
    private int secondary = 0xFF7C9BFF;
    private int background = 0xFF07070B;
    private boolean daylight = false;
    private float lineProgress = 0f;
    private long frameCount;
    private boolean playing = true;
    private boolean attached = false;
    private boolean windowVisible = true;
    private boolean frameScheduled = false;
    private long startedAt = 0L;
    private long lastFrameAt = 0L;

    private LinearGradient backgroundGradient;
    private RadialGradient glowGradient;
    private int gradientWidth = -1;
    private int gradientHeight = -1;

    private StaticLayout lyricLayout;
    private StaticLayout nextLayout;
    private String layoutLine = null;
    private String layoutNext = null;
    private int layoutWidth = -1;
    private float layoutLyricSize = -1f;

    private final Choreographer.FrameCallback frameCallback = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long frameTimeNanos) {
            frameScheduled = false;
            if (!shouldAnimate()) return;
            long now = frameTimeNanos / 1_000_000L;
            if (now - lastFrameAt >= FRAME_INTERVAL_MS) {
                lastFrameAt = now;
                invalidate();
            }
            scheduleFrame();
        }
    };

    public FoliaNativeStageView(Context context) {
        super(context);
        init();
    }

    public FoliaNativeStageView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    private void init() {
        setClickable(false);
        setFocusable(false);
        startedAt = SystemClock.uptimeMillis();
        lyricPaint.setColor(Color.WHITE);
        lyricPaint.setTextAlign(Paint.Align.CENTER);
        lyricPaint.setFakeBoldText(true);
        nextPaint.setColor(0x88FFFFFF);
        nextPaint.setTextAlign(Paint.Align.CENTER);
        metaPaint.setColor(0x99FFFFFF);
        metaPaint.setTextAlign(Paint.Align.CENTER);
        metaPaint.setTextSize(dp(13));
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    public void setThemeColors(String primaryHex, String secondaryHex, String backgroundHex) {
        try {
            int nextSecondary = Color.parseColor(secondaryHex);
            int nextBackground = Color.parseColor(backgroundHex);
            if (nextSecondary != secondary || nextBackground != background) {
                secondary = nextSecondary;
                background = nextBackground;
                backgroundGradient = null;
                glowGradient = null;
            }
        } catch (Throwable ignored) {
        }
    }

    public void setDaylight(boolean daylight) {
        this.daylight = daylight;
        lyricPaint.setColor(daylight ? 0xFF111111 : Color.WHITE);
        nextPaint.setColor(daylight ? 0x99111111 : 0x88FFFFFF);
        metaPaint.setColor(daylight ? 0xAA111111 : 0x99FFFFFF);
        invalidate();
    }

    public void updateAudio(float power, float bass, float mid, float treble) {
        // Canvas View 版本暂不绘制频谱，保留接口。
    }

    public void updateWords(String json, float position) {
        // Canvas View 版本暂不绘制逐字，保留接口。
    }

    public void setLineProgress(float progress) {
        this.lineProgress = Math.max(0f, Math.min(1f, progress));
        invalidate();
    }

    public long getFrameCount() {
        return frameCount;
    }

    public boolean isSurfaceReady() {
        return true;
    }

    public boolean isPlaying() {
        return playing;
    }

    public void update(String line, String nextLine, String title, String artist, String accentHex, boolean playing) {
        String nextAccent = accentHex;
        try {
            if (nextAccent != null && !nextAccent.isEmpty()) {
                int parsed = Color.parseColor(nextAccent);
                if (parsed != accent) {
                    accent = parsed;
                    backgroundGradient = null;
                    glowGradient = null;
                }
            }
        } catch (IllegalArgumentException ignored) {
        }
        this.line = line == null ? "" : line;
        this.nextLine = nextLine == null ? "" : nextLine;
        this.title = title == null ? "" : title;
        this.artist = artist == null ? "" : artist;
        boolean wasPlaying = this.playing;
        this.playing = playing;
        if (playing && !wasPlaying) {
            startedAt = SystemClock.uptimeMillis();
            lastFrameAt = 0L;
            scheduleFrame();
        } else if (!playing) {
            stopFrames();
        }
        invalidate();
    }

    private boolean shouldAnimate() {
        return playing && attached && windowVisible;
    }

    private void scheduleFrame() {
        if (frameScheduled || !shouldAnimate()) return;
        frameScheduled = true;
        Choreographer.getInstance().postFrameCallback(frameCallback);
    }

    private void stopFrames() {
        frameScheduled = false;
        Choreographer.getInstance().removeFrameCallback(frameCallback);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        attached = true;
        windowVisible = getWindowVisibility() == VISIBLE;
        if (shouldAnimate()) scheduleFrame();
    }

    @Override
    protected void onDetachedFromWindow() {
        attached = false;
        stopFrames();
        super.onDetachedFromWindow();
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(visibility);
        windowVisible = visibility == VISIBLE;
        if (windowVisible && shouldAnimate()) scheduleFrame();
        else if (!windowVisible) stopFrames();
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        gradientWidth = -1;
        gradientHeight = -1;
        layoutWidth = -1;
        backgroundGradient = null;
        glowGradient = null;
    }

    private void ensureGradients(int width, int height) {
        if (backgroundGradient != null && gradientWidth == width && gradientHeight == height) return;
        int accentSoft = (secondary & 0x00FFFFFF) | 0x55000000;
        backgroundGradient = new LinearGradient(
                0, 0, width, height,
                new int[]{0xFF07070B, accentSoft, 0xFF050508},
                new float[]{0f, 0.52f, 1f},
                Shader.TileMode.CLAMP);
        glowGradient = new RadialGradient(0, 0, width * 0.55f,
                new int[]{(accent & 0x00FFFFFF) | 0x33000000, 0x00000000},
                new float[]{0f, 1f}, Shader.TileMode.CLAMP);
        gradientWidth = width;
        gradientHeight = height;
    }

    private void ensureLayouts(int width) {
        float lyricSize = Math.min(dp(58), width * 0.07f);
        if (layoutWidth == width && layoutLyricSize == lyricSize
                && layoutLine != null && layoutLine.equals(line)
                && layoutNext != null && layoutNext.equals(nextLine)) return;
        layoutWidth = width;
        layoutLyricSize = lyricSize;
        layoutLine = line;
        layoutNext = nextLine;
        lyricPaint.setTextSize(lyricSize);
        nextPaint.setTextSize(lyricSize * 0.62f);
        lyricLayout = line.isEmpty() ? null : StaticLayout.Builder
                .obtain(line, 0, line.length(), lyricPaint, (int) (width * 0.86f))
                .setAlignment(Layout.Alignment.ALIGN_CENTER)
                .setMaxLines(2)
                .setLineSpacing(0f, 1.05f)
                .build();
        nextLayout = nextLine.isEmpty() ? null : StaticLayout.Builder
                .obtain(nextLine, 0, nextLine.length(), nextPaint, (int) (width * 0.8f))
                .setAlignment(Layout.Alignment.ALIGN_CENTER)
                .setMaxLines(1)
                .build();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        frameCount += 1;
        try {
            drawStage(canvas);
        } catch (Throwable ignored) {
            stopFrames();
        }
        if (shouldAnimate()) scheduleFrame();
    }

    private void drawStage(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) return;
        ensureGradients(width, height);
        ensureLayouts(width);

        backgroundPaint.setShader(backgroundGradient);
        canvas.drawRect(0, 0, width, height, backgroundPaint);

        float t = ((SystemClock.uptimeMillis() - startedAt) % 24000L) / 24000f;
        float glowX = width * (0.5f + 0.16f * (float) Math.sin(t * Math.PI * 2 + 1.2f));
        float glowY = height * 0.42f;
        glowPaint.setShader(glowGradient);
        canvas.save();
        canvas.translate(glowX, glowY);
        canvas.drawCircle(0, 0, width * 0.55f, glowPaint);
        canvas.restore();

        float centerY = height * 0.5f;
        if (lyricLayout != null) {
            canvas.save();
            float left = (width - width * 0.86f) / 2f;
            float top = centerY - lyricLayout.getHeight() / 2f;
            lyricPaint.setColor(daylight ? 0x55111111 : 0x55FFFFFF);
            canvas.save();
            canvas.translate(left, top);
            lyricLayout.draw(canvas);
            canvas.restore();
            lyricPaint.setColor(daylight ? 0xFF111111 : Color.WHITE);
            canvas.save();
            canvas.clipRect(left, 0f, left + width * 0.86f * lineProgress, height);
            canvas.translate(left, top);
            lyricLayout.draw(canvas);
            canvas.restore();
        }
        if (nextLayout != null) {
            canvas.save();
            canvas.translate((width - width * 0.8f) / 2f, centerY + layoutLyricSize * 1.55f);
            nextLayout.draw(canvas);
            canvas.restore();
        }
        if (!title.isEmpty()) {
            canvas.drawText(title, width / 2f, height * 0.1f, metaPaint);
        }
        if (!artist.isEmpty()) {
            canvas.drawText(artist, width / 2f, height * 0.1f + dp(20), metaPaint);
        }
        if (!playing) {
            canvas.drawText("PAUSED", width / 2f, height * 0.9f, metaPaint);
        }
    }
}
