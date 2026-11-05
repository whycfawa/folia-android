package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
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
 * 任何异常或关闭开关都直接移除这个 View，原有 WebView 舞台恢复。
 */
public class FoliaNativeStageView extends View {
    private final TextPaint lyricPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint nextPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint metaPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private String line = "";
    private String nextLine = "";
    private String title = "";
    private String artist = "";
    private int accent = 0xFF7C9BFF;
    private boolean playing = true;
    private boolean running = false;
    private long startedAt = 0L;

    private final Choreographer.FrameCallback frameCallback = new Choreographer.FrameCallback() {
        @Override
        public void doFrame(long frameTimeNanos) {
            if (!running) return;
            invalidate();
            Choreographer.getInstance().postFrameCallback(this);
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
        setLayerType(LAYER_TYPE_HARDWARE, null);
        setClickable(false);
        setFocusable(false);
        startedAt = SystemClock.uptimeMillis();
        lyricPaint.setColor(Color.WHITE);
        lyricPaint.setTextAlign(Paint.Align.CENTER);
        lyricPaint.setFakeBoldText(true);
        nextPaint.setColor(0x88FFFFFF);
        nextPaint.setTextAlign(Paint.Align.CENTER);
        metaPaint.setColor(0x99FFFFFF);
        metaPaint.setTextSize(dp(13));
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    public void update(String line, String nextLine, String title, String artist, String accentHex, boolean playing) {
        this.line = line == null ? "" : line;
        this.nextLine = nextLine == null ? "" : nextLine;
        this.title = title == null ? "" : title;
        this.artist = artist == null ? "" : artist;
        this.playing = playing;
        try {
            if (accentHex != null && !accentHex.isEmpty()) accent = Color.parseColor(accentHex);
        } catch (IllegalArgumentException ignored) {
        }
        invalidate();
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        if (!running) {
            running = true;
            startedAt = SystemClock.uptimeMillis();
            Choreographer.getInstance().postFrameCallback(frameCallback);
        }
    }

    @Override
    protected void onDetachedFromWindow() {
        running = false;
        Choreographer.getInstance().removeFrameCallback(frameCallback);
        super.onDetachedFromWindow();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) return;
        float t = ((SystemClock.uptimeMillis() - startedAt) % 24000L) / 24000f;
        float shift = (float) Math.sin(t * Math.PI * 2) * height * 0.18f;
        int accentSoft = (accent & 0x00FFFFFF) | 0x55000000;
        backgroundPaint.setShader(new LinearGradient(
                0, shift, width, height + shift,
                new int[]{0xFF07070B, accentSoft, 0xFF050508},
                new float[]{0f, 0.52f, 1f},
                Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, width, height, backgroundPaint);

        float glowX = width * (0.5f + 0.16f * (float) Math.sin(t * Math.PI * 2 + 1.2f));
        float glowY = height * 0.42f;
        Paint glow = new Paint(Paint.ANTI_ALIAS_FLAG);
        glow.setShader(new android.graphics.RadialGradient(glowX, glowY, width * 0.55f,
                new int[]{(accent & 0x00FFFFFF) | 0x33000000, 0x00000000},
                new float[]{0f, 1f}, Shader.TileMode.CLAMP));
        canvas.drawRect(0, 0, width, height, glow);

        float lyricSize = Math.min(dp(58), width * 0.07f);
        lyricPaint.setTextSize(lyricSize);
        nextPaint.setTextSize(lyricSize * 0.62f);
        float centerY = height * 0.5f;
        if (!line.isEmpty()) {
            StaticLayout layout = StaticLayout.Builder.obtain(line, 0, line.length(), lyricPaint, (int) (width * 0.86f))
                    .setAlignment(Layout.Alignment.ALIGN_CENTER)
                    .setMaxLines(2)
                    .setLineSpacing(0f, 1.05f)
                    .build();
            canvas.save();
            canvas.translate((width - width * 0.86f) / 2f, centerY - layout.getHeight() / 2f);
            layout.draw(canvas);
            canvas.restore();
        }
        if (!nextLine.isEmpty()) {
            StaticLayout next = StaticLayout.Builder.obtain(nextLine, 0, nextLine.length(), nextPaint, (int) (width * 0.8f))
                    .setAlignment(Layout.Alignment.ALIGN_CENTER)
                    .setMaxLines(1)
                    .build();
            canvas.save();
            canvas.translate((width - width * 0.8f) / 2f, centerY + lyricSize * 1.55f);
            next.draw(canvas);
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
