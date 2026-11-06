package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.SurfaceTexture;
import android.graphics.Shader;
import android.os.SystemClock;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.util.AttributeSet;

import org.json.JSONArray;
import org.json.JSONObject;
import android.view.Surface;
import android.view.TextureView;

/**
 * 原生舞台的 TextureView 版本：独立渲染线程，最高 120fps。
 * TextureView 是普通 View，和 WebView 在同一窗口合成，不依赖窗口透明或 Surface 层级。
 */
public class FoliaNativeStageSurfaceView extends TextureView implements TextureView.SurfaceTextureListener {
    private static final long FRAME_MS = 8L;

    private final TextPaint lyricPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint nextPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint metaPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Paint backgroundPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint particlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Object stateLock = new Object();
    private static final int PARTICLE_COUNT = 64;
    private final float[] particleX = new float[PARTICLE_COUNT];
    private final float[] particleY = new float[PARTICLE_COUNT];
    private final float[] particleVx = new float[PARTICLE_COUNT];
    private final float[] particleVy = new float[PARTICLE_COUNT];
    private final float[] particleLife = new float[PARTICLE_COUNT];
    private final float[] particleSize = new float[PARTICLE_COUNT];
    private int nextParticle;
    private long lastFrameAt;
    private long lastSpawnAt;
    private volatile long frameCount;
    private volatile boolean surfaceReady;
    private volatile Surface renderSurface;

    private String line = "";
    private String nextLine = "";
    private String title = "";
    private String artist = "";
    private int accent = 0xFF7C9BFF;
    private int primary = 0xFFFFFFFF;
    private int secondary = 0xFF7C9BFF;
    private int background = 0xFF07070B;
    private boolean daylight = false;
    private boolean playing = true;
    private float lineProgress = 0f;
    private float audioPower;
    private float audioBass;
    private float audioMid;
    private float audioTreble;
    private boolean dirty = true;
    private volatile boolean running;
    private Thread renderThread;
    private long startedAt = SystemClock.uptimeMillis();

    private LinearGradient backgroundGradient;
    private RadialGradient glowGradient;
    private int gradientWidth = -1;
    private int gradientHeight = -1;
    private StaticLayout lyricLayout;
    private StaticLayout nextLayout;
    private String layoutLine;
    private String layoutNext;
    private int layoutWidth = -1;
    private float layoutSize = -1f;
    private String[] wordTexts = new String[0];
    private float[] wordStarts = new float[0];
    private float[] wordEnds = new float[0];
    private float wordPosition = 0f;
    private final TextPaint wordPaint = new TextPaint(Paint.ANTI_ALIAS_FLAG);

    public FoliaNativeStageSurfaceView(Context context) {
        super(context);
        init();
    }

    public FoliaNativeStageSurfaceView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    private void init() {
        setOpaque(false);
        setBackgroundColor(Color.TRANSPARENT);
        setSurfaceTextureListener(this);
        lyricPaint.setColor(Color.WHITE);
        lyricPaint.setTextAlign(Paint.Align.CENTER);
        applyTextColors();
        lyricPaint.setFakeBoldText(true);
        nextPaint.setColor(0x88FFFFFF);
        nextPaint.setTextAlign(Paint.Align.CENTER);
        metaPaint.setColor(0x99FFFFFF);
        metaPaint.setTextAlign(Paint.Align.CENTER);
        metaPaint.setTextSize(dp(13));
        applyTextColors();
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    public void setThemeColors(String primaryHex, String secondaryHex, String backgroundHex) {
        synchronized (stateLock) {
            int nextPrimary = parseColor(primaryHex, primary);
            int nextSecondary = parseColor(secondaryHex, secondary);
            int nextBackground = parseColor(backgroundHex, background);
            if (nextPrimary != primary || nextSecondary != secondary || nextBackground != background) {
                primary = nextPrimary;
                secondary = nextSecondary;
                background = nextBackground;
                backgroundGradient = null;
                glowGradient = null;
                gradientWidth = -1;
                dirty = true;
            }
        }
    }

    private static int parseColor(String value, int fallback) {
        try {
            return value == null || value.isEmpty() ? fallback : Color.parseColor(value);
        } catch (IllegalArgumentException ignored) {
            return fallback;
        }
    }

    public void updateWords(String json, float position) {
        synchronized (stateLock) {
            try {
                JSONArray array = new JSONArray(json == null ? "[]" : json);
                int count = array.length();
                String[] texts = new String[count];
                float[] starts = new float[count];
                float[] ends = new float[count];
                for (int index = 0; index < count; index++) {
                    JSONObject item = array.optJSONObject(index);
                    texts[index] = item == null ? "" : item.optString("text", "");
                    starts[index] = item == null ? 0f : (float) item.optDouble("startTime", 0);
                    ends[index] = item == null ? 0f : (float) item.optDouble("endTime", 0);
                }
                wordTexts = texts;
                wordStarts = starts;
                wordEnds = ends;
                wordPosition = position;
                dirty = true;
            } catch (Throwable ignored) {
            }
        }
    }

    public void setLineProgress(float progress) {
        synchronized (stateLock) {
            this.lineProgress = clampUnit(progress);
            this.dirty = true;
        }
    }

    public void updateAudio(float power, float bass, float mid, float treble) {
        synchronized (stateLock) {
            this.audioPower = clampUnit(power);
            this.audioBass = clampUnit(bass);
            this.audioMid = clampUnit(mid);
            this.audioTreble = clampUnit(treble);
            this.dirty = true;
        }
    }

    private static float clampUnit(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    public void update(String line, String nextLine, String title, String artist, String accentHex, boolean playing) {
        synchronized (stateLock) {
            this.line = line == null ? "" : line;
            this.nextLine = nextLine == null ? "" : nextLine;
            this.title = title == null ? "" : title;
            this.artist = artist == null ? "" : artist;
            this.playing = playing;
            try {
                if (accentHex != null && !accentHex.isEmpty()) {
                    int parsed = Color.parseColor(accentHex);
                    if (parsed != accent) {
                        accent = parsed;
                        backgroundGradient = null;
                        glowGradient = null;
                    }
                }
            } catch (IllegalArgumentException ignored) {
            }
            dirty = true;
            if (playing) startedAt = SystemClock.uptimeMillis();
        }
    }

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture surface, int width, int height) {
        if (running) return;
        renderSurface = new Surface(surface);
        surfaceReady = true;
        running = true;
        renderThread = new Thread(this::renderLoop, "FoliaNativeStage");
        renderThread.start();
    }

    @Override
    public void onSurfaceTextureSizeChanged(SurfaceTexture surface, int width, int height) {
        synchronized (stateLock) {
            gradientWidth = -1;
            gradientHeight = -1;
            layoutWidth = -1;
            backgroundGradient = null;
            glowGradient = null;
            dirty = true;
        }
    }

    @Override
    public boolean onSurfaceTextureDestroyed(SurfaceTexture surface) {
        surfaceReady = false;
        running = false;
        Surface oldSurface = renderSurface;
        renderSurface = null;
        if (oldSurface != null) oldSurface.release();
        Thread thread = renderThread;
        renderThread = null;
        if (thread != null) {
            try {
                thread.join(800);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        return true;
    }

    @Override
    public void onSurfaceTextureUpdated(SurfaceTexture surface) {
    }

    private void renderLoop() {
        while (running) {
            boolean animate;
            synchronized (stateLock) {
                animate = playing && getVisibility() == VISIBLE && getWindowVisibility() == VISIBLE;
            }
            long frameStartedAt = SystemClock.uptimeMillis();
            if (animate || dirty) {
                Canvas canvas = null;
                try {
                    Surface target = renderSurface;
                    canvas = target == null ? null : target.lockCanvas(null);
                    if (canvas != null) {
                        synchronized (stateLock) {
                            drawStage(canvas);
                            frameCount += 1;
                            dirty = false;
                        }
                    }
                } catch (Throwable ignored) {
                } finally {
                    if (canvas != null) {
                        try {
                            Surface target = renderSurface;
                            if (target != null) target.unlockCanvasAndPost(canvas);
                        } catch (Throwable ignored) {
                        }
                    }
                }
            }
            try {
                long frameCost = SystemClock.uptimeMillis() - frameStartedAt;
                Thread.sleep(animate ? Math.max(1L, FRAME_MS - frameCost) : 80L);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private void ensureGradients(int width, int height) {
        if (backgroundGradient != null && gradientWidth == width && gradientHeight == height) return;
        int secondarySoft = (secondary & 0x00FFFFFF) | 0x55000000;
        int backgroundDeep = (background & 0x00FFFFFF) | 0xFF000000;
        backgroundGradient = new LinearGradient(0, 0, width, height,
                new int[]{backgroundDeep, secondarySoft, backgroundDeep},
                new float[]{0f, 0.52f, 1f}, Shader.TileMode.CLAMP);
        glowGradient = new RadialGradient(0, 0, width * 0.55f,
                new int[]{(accent & 0x00FFFFFF) | 0x33000000, 0x00000000},
                new float[]{0f, 1f}, Shader.TileMode.CLAMP);
        gradientWidth = width;
        gradientHeight = height;
    }

    private void ensureLayouts(int width) {
        float lyricSize = Math.min(dp(58), width * 0.07f);
        if (layoutWidth == width && layoutSize == lyricSize
                && layoutLine != null && layoutLine.equals(line)
                && layoutNext != null && layoutNext.equals(nextLine)) return;
        layoutWidth = width;
        layoutSize = lyricSize;
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

    private void updateParticles(long now, int width, int height) {
        float dt = lastFrameAt == 0 ? 0.016f : Math.min(0.05f, (now - lastFrameAt) / 1000f);
        lastFrameAt = now;
        for (int index = 0; index < PARTICLE_COUNT; index++) {
            if (particleLife[index] <= 0f) continue;
            particleLife[index] -= dt;
            particleX[index] += particleVx[index] * dt;
            particleY[index] += particleVy[index] * dt;
            particleVy[index] += 14f * dt;
        }
        if (audioPower > 0.06f && now - lastSpawnAt > 55L) {
            lastSpawnAt = now;
            int index = nextParticle;
            nextParticle = (nextParticle + 1) % PARTICLE_COUNT;
            particleX[index] = (float) Math.random() * width;
            particleY[index] = height * (0.42f + (float) Math.random() * 0.28f);
            particleVx[index] = ((float) Math.random() - 0.5f) * width * 0.025f;
            particleVy[index] = -height * (0.01f + (float) Math.random() * 0.02f);
            particleLife[index] = 1.2f + (float) Math.random() * 1.8f;
            particleSize[index] = dp(1.2f + (float) Math.random() * 2.4f);
        }
    }

    private void drawParticles(Canvas canvas) {
        for (int index = 0; index < PARTICLE_COUNT; index++) {
            if (particleLife[index] <= 0f) continue;
            int alpha = (int) Math.min(160f, particleLife[index] * 90f);
            particlePaint.setColor((accent & 0x00FFFFFF) | (alpha << 24));
            canvas.drawCircle(particleX[index], particleY[index], particleSize[index], particlePaint);
        }
    }

    public long getFrameCount() {
        return frameCount;
    }

    public boolean isSurfaceReady() {
        return surfaceReady;
    }

    public boolean isPlaying() {
        synchronized (stateLock) {
            return playing;
        }
    }

    public void setDaylight(boolean daylight) {
        synchronized (stateLock) {
            if (this.daylight == daylight) return;
            this.daylight = daylight;
            applyTextColors();
            dirty = true;
        }
    }

    private void applyTextColors() {
        int text = daylight ? 0xFF111111 : Color.WHITE;
        lyricPaint.setColor(text);
        nextPaint.setColor(daylight ? 0x99111111 : 0x88FFFFFF);
        metaPaint.setColor(daylight ? 0xAA111111 : 0x99FFFFFF);
    }

    private boolean drawWords(Canvas canvas, int width, float centerY) {
        if (wordTexts.length == 0 || layoutSize <= 0) return false;
        wordPaint.setTextSize(layoutSize);
        wordPaint.setTextAlign(Paint.Align.LEFT);
        float total = 0f;
        for (String word : wordTexts) total += wordPaint.measureText(word);
        if (total <= 0f || total > width * 0.9f) return false;
        float x = (width - total) / 2f;
        float baseline = centerY - (wordPaint.ascent() + wordPaint.descent()) / 2f;
        for (int index = 0; index < wordTexts.length; index++) {
            float span = Math.max(0.001f, wordEnds[index] - wordStarts[index]);
            float wordProgress = Math.max(0f, Math.min(1f, (wordPosition - wordStarts[index]) / span));
            int alpha = 0x55 + Math.round((0xFF - 0x55) * wordProgress);
            int rgb = daylight ? 0x111111 : 0xFFFFFF;
            wordPaint.setColor((alpha << 24) | rgb);
            canvas.drawText(wordTexts[index], x, baseline, wordPaint);
            x += wordPaint.measureText(wordTexts[index]);
        }
        return true;
    }

    private void drawStage(Canvas canvas) {
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
        canvas.drawCircle(0, 0, width * (0.55f + 0.12f * audioPower), glowPaint);
        canvas.restore();

        updateParticles(SystemClock.uptimeMillis(), width, height);
        drawParticles(canvas);

        // 原生频谱条：只消费 20Hz 的能量值，不在每帧做 FFT。
        if (audioPower > 0.01f) {
            int bars = 28;
            float barWidth = width / (bars * 1.8f);
            float gap = (width - bars * barWidth) / (bars + 1f);
            float baseY = height * 0.88f;
            barPaint.setColor(daylight ? 0x33111111 : 0x55FFFFFF);
            for (int index = 0; index < bars; index++) {
                float mix = index < bars / 3f ? audioBass : index < bars * 2f / 3f ? audioMid : audioTreble;
                float wave = 0.55f + 0.45f * (float) Math.sin(t * Math.PI * 8 + index * 0.7f);
                float barHeight = height * 0.08f * (0.15f + 0.85f * mix * wave);
                float left = gap + index * (barWidth + gap);
                canvas.drawRect(left, baseY - barHeight, left + barWidth, baseY, barPaint);
            }
        }

        float centerY = height * 0.5f;
        if (!drawWords(canvas, width, centerY) && lyricLayout != null) {
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
            canvas.translate((width - width * 0.8f) / 2f, centerY + layoutSize * 1.55f);
            nextLayout.draw(canvas);
            canvas.restore();
        }
        if (!title.isEmpty()) canvas.drawText(title, width / 2f, height * 0.1f, metaPaint);
        if (!artist.isEmpty()) canvas.drawText(artist, width / 2f, height * 0.1f + dp(20), metaPaint);
        if (!playing) canvas.drawText("PAUSED", width / 2f, height * 0.9f, metaPaint);
    }
}
