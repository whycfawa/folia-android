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

import org.json.JSONArray;
import org.json.JSONObject;

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
    private final Paint barPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint particlePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private static final int PARTICLE_COUNT = 64;
    private final float[] particleX = new float[PARTICLE_COUNT];
    private final float[] particleY = new float[PARTICLE_COUNT];
    private final float[] particleVx = new float[PARTICLE_COUNT];
    private final float[] particleVy = new float[PARTICLE_COUNT];
    private final float[] particleLife = new float[PARTICLE_COUNT];
    private final float[] particleSize = new float[PARTICLE_COUNT];
    private int nextParticle;
    private long lastSpawnAt;
    private long particleLastAt;

    private String mode = "classic";
    private String line = "";
    private String nextLine = "";
    private String prevLine = "";
    private String lineTranslation = "";
    private String prevTranslation = "";
    private String nextTranslation = "";
    private String title = "";
    private String artist = "";
    private int accent = 0xFF7C9BFF;
    private int primary = 0xFFFFFFFF;
    private int secondary = 0xFF7C9BFF;
    private int background = 0xFF07070B;
    private boolean daylight = false;
    private boolean chorus = false;
    private boolean stageLight = false;
    private float lineProgress = 0f;
    private float audioPower;
    private float audioBass;
    private float audioMid;
    private float audioTreble;
    private String[] wordTexts = new String[0];
    private float[] wordStarts = new float[0];
    private float[] wordEnds = new float[0];
    private String[][] charTexts = new String[0][];
    private float[][] charStarts = new float[0][];
    private float[][] charEnds = new float[0][];
    private float wordPosition = 0f;
    private long frameCount;
    private boolean playing = true;
    private boolean attached = false;
    private boolean windowVisible = true;
    private boolean frameScheduled = false;
    private long startedAt = 0L;
    private long lastFrameAt = 0L;

    private LinearGradient backgroundGradient;
    private RadialGradient glowGradient;
    private RadialGradient stillVignette;
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
            int nextPrimary = Color.parseColor(primaryHex);
            int nextSecondary = Color.parseColor(secondaryHex);
            int nextBackground = Color.parseColor(backgroundHex);
            if (nextPrimary != primary || nextSecondary != secondary || nextBackground != background) {
                primary = nextPrimary;
                secondary = nextSecondary;
                background = nextBackground;
                backgroundGradient = null;
                glowGradient = null;
                applyStageTextColor();
            }
        } catch (Throwable ignored) {
        }
    }

    private int stageBackground() {
        float luminance = (Color.red(background) * 0.299f + Color.green(background) * 0.587f + Color.blue(background) * 0.114f) / 255f;
        return luminance > 0.35f ? 0xFF07070B : background;
    }

    private void applyStageTextColor() {
        int base = stageBackground();
        float luminance = (Color.red(base) * 0.299f + Color.green(base) * 0.587f + Color.blue(base) * 0.114f) / 255f;
        stageLight = luminance > 0.45f;
        lyricPaint.setColor(stageLight ? 0xFF111111 : Color.WHITE);
        nextPaint.setColor(stageLight ? 0x99111111 : 0x88FFFFFF);
        metaPaint.setColor(stageLight ? 0xAA111111 : 0x99FFFFFF);
    }

    public void setDaylight(boolean daylight) {
        this.daylight = daylight;
        applyStageTextColor();
        invalidate();
    }

    public void updateAudio(float power, float bass, float mid, float treble) {
        audioPower = clamp(power);
        audioBass = clamp(bass);
        audioMid = clamp(mid);
        audioTreble = clamp(treble);
    }

    private static float clamp(float value) {
        return Math.max(0f, Math.min(1f, value));
    }

    public void updateWords(String json, float position) {
        try {
            JSONArray array = new JSONArray(json == null ? "[]" : json);
            int count = array.length();
            String[] texts = new String[count];
            float[] starts = new float[count];
            float[] ends = new float[count];
            String[][] chars = new String[count][];
            float[][] charStartsLocal = new float[count][];
            float[][] charEndsLocal = new float[count][];
            for (int index = 0; index < count; index++) {
                JSONObject item = array.optJSONObject(index);
                texts[index] = item == null ? "" : item.optString("text", "");
                starts[index] = item == null ? 0f : (float) item.optDouble("startTime", 0);
                ends[index] = item == null ? 0f : (float) item.optDouble("endTime", 0);
                JSONArray charArray = item == null ? null : item.optJSONArray("chars");
                int charCount = charArray == null ? 0 : charArray.length();
                String[] charText = new String[charCount];
                float[] charStart = new float[charCount];
                float[] charEnd = new float[charCount];
                for (int c = 0; c < charCount; c++) {
                    JSONObject charItem = charArray.optJSONObject(c);
                    charText[c] = charItem == null ? "" : charItem.optString("char", "");
                    charStart[c] = charItem == null ? 0f : (float) charItem.optDouble("startTime", 0);
                    charEnd[c] = charItem == null ? 0f : (float) charItem.optDouble("endTime", 0);
                }
                chars[index] = charText;
                charStartsLocal[index] = charStart;
                charEndsLocal[index] = charEnd;
            }
            wordTexts = texts;
            wordStarts = starts;
            wordEnds = ends;
            charTexts = chars;
            charStarts = charStartsLocal;
            charEnds = charEndsLocal;
            wordPosition = position;
        } catch (Throwable ignored) {
        }
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

    public void update(String mode, String line, String nextLine, String prevLine, String lineTranslation, String prevTranslation, String nextTranslation, String title, String artist, String accentHex, boolean playing, boolean chorus) {
        this.chorus = chorus;
        this.mode = mode == null ? "classic" : mode;
        this.prevLine = prevLine == null ? "" : prevLine;
        this.lineTranslation = lineTranslation == null ? "" : lineTranslation;
        this.prevTranslation = prevTranslation == null ? "" : prevTranslation;
        this.nextTranslation = nextTranslation == null ? "" : nextTranslation;
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
        int base = stageBackground();
        backgroundGradient = new LinearGradient(
                0, 0, width, height,
                new int[]{base, accentSoft, base},
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

    private void drawNebbia(Canvas canvas, int width, int height) {
        backgroundPaint.setShader(null);
        backgroundPaint.setColor(0xFF05070A);
        canvas.drawRect(0, 0, width, height, backgroundPaint);
        float t = (SystemClock.uptimeMillis() - startedAt) / 1000f;
        for (int i = 0; i < 6; i++) {
            float cx = width * (0.5f + 0.28f * (float) Math.sin(t * 0.11f + i * 1.7f));
            float cy = height * (0.5f + 0.22f * (float) Math.cos(t * 0.09f + i * 1.1f));
            glowPaint.setShader(new RadialGradient(cx, cy, width * (0.28f + 0.04f * i),
                    new int[]{(secondary & 0x00FFFFFF) | 0x22000000, 0x00000000},
                    new float[]{0f, 1f}, Shader.TileMode.CLAMP));
            canvas.drawCircle(cx, cy, width * (0.28f + 0.04f * i), glowPaint);
        }
        if (!line.isEmpty()) {
            lyricPaint.setTextAlign(Paint.Align.CENTER);
            lyricPaint.setTextSize(Math.max(dp(28), Math.min(dp(62), width * 0.06f)));
            lyricPaint.setColor(stageLight ? 0xFF111111 : 0xFFFFFFFF);
            lyricPaint.setShadowLayer(dp(18), 0, 0, accent);
            canvas.drawText(line, width / 2f, height * 0.52f, lyricPaint);
            lyricPaint.clearShadowLayer();
        }
        if (!lineTranslation.isEmpty()) {
            nextPaint.setTextAlign(Paint.Align.CENTER);
            nextPaint.setTextSize(dp(22));
            nextPaint.setColor(stageLight ? 0x99111111 : 0x99FFFFFF);
            canvas.drawText(lineTranslation, width / 2f, height * 0.62f, nextPaint);
        }
    }

    public void drawLumiereLayer(Canvas canvas, int width, int height) {
        if (line.isEmpty()) return;
        lyricPaint.setTextAlign(Paint.Align.CENTER);
        lyricPaint.setTextSize(Math.max(dp(28), Math.min(dp(60), width * 0.06f)));
        lyricPaint.setColor(stageLight ? 0xFF111111 : 0xFFFFFFFF);
        lyricPaint.setShadowLayer(dp(18), 0, 0, accent);
        canvas.drawText(line, width / 2f, height * 0.52f, lyricPaint);
        lyricPaint.clearShadowLayer();
        if (!lineTranslation.isEmpty()) {
            nextPaint.setTextAlign(Paint.Align.CENTER);
            nextPaint.setTextSize(dp(22));
            nextPaint.setColor(stageLight ? 0x99111111 : 0x99FFFFFF);
            canvas.drawText(lineTranslation, width / 2f, height * 0.62f, nextPaint);
        }
    }

    public void drawPartitaLayer(Canvas canvas, int width, int height) { drawPartita(canvas, width, height); }

    public void drawCappellaLayer(Canvas canvas, int width, int height) { drawCappella(canvas, width, height); }

    private void drawCappella(Canvas canvas, int width, int height) {
        float size = Math.max(dp(16), Math.min(dp(26), width * 0.022f));
        float panelWidth = Math.min(width - dp(32), dp(820));
        float left = (width - panelWidth) / 2f;
        float y = height * 0.16f;
        lyricPaint.setTextSize(size);
        nextPaint.setTextAlign(Paint.Align.LEFT);
        drawCappellaRow(canvas, left, y, panelWidth, prevLine, prevTranslation, size, false, 0.55f);
        y += size * 5.4f;
        drawCappellaRow(canvas, left, y, panelWidth, line, lineTranslation, size, true, 1f);
        y += size * 5.4f;
        drawCappellaRow(canvas, left, y, panelWidth, nextLine, nextTranslation, size, false, 0.55f);
    }

    private void drawCappellaRow(Canvas canvas, float left, float top, float width, String text, String translation, float size, boolean active, float alpha) {
        if (text == null || text.isEmpty()) return;
        float bubbleWidth = Math.min(width * 0.72f, lyricPaint.measureText(text) + size * 2.4f);
        float bubbleHeight = size * (translation != null && !translation.isEmpty() ? 3.1f : 2.2f);
        float x = active ? left + width - bubbleWidth - size * 3.2f : left + size * 3.2f;
        float avatarRadius = size * 1.35f;
        float avatarX = active ? left + width - avatarRadius : left + avatarRadius;
        float avatarY = top + avatarRadius + size * 0.35f;
        particlePaint.setColor((Math.round(220 * alpha) << 24) | (secondary & 0x00FFFFFF));
        canvas.drawCircle(avatarX, avatarY, avatarRadius, particlePaint);
        lyricPaint.setTextAlign(Paint.Align.CENTER);
        lyricPaint.setTextSize(size * 0.85f);
        lyricPaint.setColor((Math.round(255 * alpha) << 24) | 0xFFFFFF);
        String initial = title == null || title.isEmpty() ? "♪" : title.substring(0, 1);
        canvas.drawText(initial, avatarX, avatarY + size * 0.3f, lyricPaint);
        float radius = size * 1.05f;
        Paint bubble = particlePaint;
        bubble.setColor(active ? ((Math.round(255 * alpha) << 24) | (accent & 0x00FFFFFF)) : ((Math.round(150 * alpha) << 24) | (stageLight ? 0xFFFFFF : 0x222222)));
        canvas.drawRoundRect(x, top, x + bubbleWidth, top + bubbleHeight, radius, radius, bubble);
        int textColor = active ? (stageLight ? 0xFF111111 : 0xFFFFFFFF) : (stageLight ? 0xFF111111 : 0xFFDDDDDD);
        lyricPaint.setColor((Math.round(255 * alpha) << 24) | (textColor & 0x00FFFFFF));
        lyricPaint.setTextAlign(Paint.Align.LEFT);
        canvas.drawText(text, x + size * 1.2f, top + size * 1.5f, lyricPaint);
        if (translation != null && !translation.isEmpty()) {
            nextPaint.setTextSize(size * 0.72f);
            nextPaint.setColor((Math.round(180 * alpha) << 24) | (stageLight ? 0x55111111 : 0xCCFFFFFF));
            canvas.drawText(translation, x + size * 1.2f, top + size * 2.6f, nextPaint);
        }
    }

    private void drawPartita(Canvas canvas, int width, int height) {
        if (wordTexts.length == 0) return;
        float size = Math.max(dp(26), Math.min(dp(52), width * 0.045f));
        lyricPaint.setTextSize(size);
        lyricPaint.setTextAlign(Paint.Align.LEFT);
        int rows = Math.min(5, Math.max(1, (wordTexts.length + 1) / 2));
        float rowGap = size * 1.55f;
        float startY = height * 0.5f - (rows - 1) * rowGap / 2f;
        int wordIndex = 0;
        for (int row = 0; row < rows; row++) {
            int remainingRows = rows - row;
            int remainingWords = wordTexts.length - wordIndex;
            int count = Math.max(1, Math.min(remainingWords, (int) Math.ceil((float) remainingWords / remainingRows)));
            float total = 0f;
            for (int i = 0; i < count; i++) total += lyricPaint.measureText(wordTexts[wordIndex + i]) + size * 0.12f;
            float x = (width - total) / 2f + (row % 2 == 0 ? -dp(10) : dp(10));
            float y = startY + row * rowGap + (float) Math.sin(row * 1.7f) * dp(2);
            for (int i = 0; i < count; i++) {
                int index = wordIndex + i;
                float wordWidth = lyricPaint.measureText(wordTexts[index]);
                float progress = Math.max(0f, Math.min(1f, (wordPosition - wordStarts[index]) / Math.max(0.001f, wordEnds[index] - wordStarts[index])));
                boolean passed = wordPosition > wordEnds[index];
                int alpha = passed ? 0x99 : (wordPosition < wordStarts[index] ? 0x55 : 0xFF);
                int rgb = stageLight ? 0x111111 : 0xFFFFFF;
                lyricPaint.setColor((alpha << 24) | rgb);
                lyricPaint.setShadowLayer(wordPosition >= wordStarts[index] && !passed ? dp(12) : 0f, 0f, 0f, accent);
                float scale = 1f + 0.10f * (float) Math.sin(progress * Math.PI);
                canvas.save();
                canvas.translate(x + wordWidth / 2f, y);
                canvas.rotate((row % 2 == 0 ? -1f : 1f) * (passed ? 3f : 1f));
                canvas.scale(scale, scale);
                canvas.drawText(wordTexts[index], -wordWidth / 2f, 0f, lyricPaint);
                canvas.restore();
                x += wordWidth + size * 0.12f;
            }
            wordIndex += count;
        }
        barPaint.setStyle(Paint.Style.STROKE);
        barPaint.setStrokeWidth(dp(1));
        barPaint.setColor(stageLight ? 0x18111111 : 0x22FFFFFF);
        for (int row = 0; row < rows; row++) {
            float guideY = startY + row * rowGap + size * 0.95f;
            canvas.drawLine(width * 0.18f, guideY, width * 0.82f, guideY, barPaint);
        }
        barPaint.setStyle(Paint.Style.FILL);
        lyricPaint.clearShadowLayer();
        if (lineTranslation != null && !lineTranslation.isEmpty()) {
            nextPaint.setTextAlign(Paint.Align.CENTER);
            nextPaint.setTextSize(size * 0.48f);
            nextPaint.setColor((0xCC << 24) | (stageLight ? 0x111111 : 0xFFFFFF));
            canvas.drawText(lineTranslation, width / 2f, height * 0.72f, nextPaint);
        }
    }

    public void drawClassicLayer(Canvas canvas, int width, int height) {
        drawClassic(canvas, width, height);
    }

    private void drawClassic(Canvas canvas, int width, int height) {
        if (wordTexts.length == 0) return;
        float size = Math.max(dp(28), Math.min(dp(58), width * 0.055f));
        lyricPaint.setTextSize(size);
        lyricPaint.setTextAlign(Paint.Align.LEFT);
        float gap = size * 0.12f;
        float total = gap * Math.max(0, wordTexts.length - 1);
        for (String word : wordTexts) total += lyricPaint.measureText(word);
        float baseX = (width - total) / 2f;
        float baseY = height * 0.5f + (float) Math.sin((SystemClock.uptimeMillis() - startedAt) / 7000.0) * dp(8);
        long seed = (long) (wordStarts.length > 0 ? wordStarts[0] * 1000 : 0);
        for (int index = 0; index < wordTexts.length; index++) {
            float wordWidth = lyricPaint.measureText(wordTexts[index]);
            float start = wordStarts[index];
            float end = wordEnds[index];
            float progress = Math.max(0f, Math.min(1f, (wordPosition - start) / Math.max(0.001f, end - start)));
            boolean passed = wordPosition > end;
            float scale = 1f + 0.12f * (float) Math.sin(progress * Math.PI) + (passed ? 0.02f : 0f);
            float offsetX = (float) Math.sin(seed + index * 1.7f) * dp(4);
            float offsetY = (float) Math.cos(seed + index * 2.3f) * dp(3);
            float rotation = (float) Math.sin(seed + index * 0.9f) * (passed ? 4f : 1.5f);
            String[] chars = index < charTexts.length ? charTexts[index] : null;
            if (chars != null && chars.length > 1) {
                float charX = baseX;
                for (int c = 0; c < chars.length; c++) {
                    float charWidth = lyricPaint.measureText(chars[c]);
                    float charStart = charStarts[index][c];
                    float charEnd = charEnds[index][c];
                    float charProgress = Math.max(0f, Math.min(1f, (wordPosition - charStart) / Math.max(0.001f, charEnd - charStart)));
                    boolean charPassed = wordPosition > charEnd;
                    float charScale = 1f + 0.12f * (float) Math.sin(charProgress * Math.PI);
                    int charAlpha = charPassed ? 0x99 : (wordPosition < charStart ? 0x55 : 0xFF);
                    int charRgb = stageLight ? 0x111111 : 0xFFFFFF;
                    lyricPaint.setColor((charAlpha << 24) | charRgb);
                    lyricPaint.setShadowLayer(wordPosition >= charStart && !charPassed ? dp(14) : 0f, 0f, 0f, accent);
                    canvas.save();
                    canvas.translate(charX + charWidth / 2f + offsetX, baseY + offsetY);
                    canvas.rotate(rotation);
                    canvas.scale(charScale, charScale);
                    canvas.drawText(chars[c], -charWidth / 2f, 0f, lyricPaint);
                    canvas.restore();
                    charX += charWidth;
                }
                baseX += wordWidth + gap;
                continue;
            }
            int alpha = passed ? 0x99 : (wordPosition < start ? 0x55 : 0xFF);
            int rgb = stageLight ? 0x111111 : 0xFFFFFF;
            lyricPaint.setColor((alpha << 24) | rgb);
            lyricPaint.setShadowLayer(wordPosition >= start && !passed ? dp(14) : 0f, 0f, 0f, accent);
            if (chorus && wordPosition >= start && !passed) {
                float rippleProgress = Math.max(0f, Math.min(1f, progress));
                float rippleRadius = wordWidth * (0.45f + rippleProgress * 1.4f);
                particlePaint.setStyle(Paint.Style.STROKE);
                particlePaint.setStrokeWidth(dp(1));
                particlePaint.setColor(((int) (0x99 * (1f - rippleProgress)) << 24) | (accent & 0x00FFFFFF));
                canvas.drawCircle(baseX + wordWidth / 2f + offsetX, baseY + offsetY, rippleRadius, particlePaint);
                particlePaint.setStyle(Paint.Style.FILL);
            }
            canvas.save();
            canvas.translate(baseX + wordWidth / 2f + offsetX, baseY + offsetY);
            canvas.rotate(rotation);
            canvas.scale(scale, scale);
            canvas.drawText(wordTexts[index], -wordWidth / 2f, 0f, lyricPaint);
            canvas.restore();
            baseX += wordWidth + gap;
        }
        lyricPaint.clearShadowLayer();
        if (lineTranslation != null && !lineTranslation.isEmpty()) {
            nextPaint.setTextAlign(Paint.Align.CENTER);
            nextPaint.setTextSize(size * 0.46f);
            nextPaint.setColor((0xCC << 24) | (stageLight ? 0x111111 : 0xFFFFFF));
            canvas.drawText(lineTranslation, width / 2f, height * 0.66f, nextPaint);
        }
    }

    private void drawStill(Canvas canvas, int width, int height) {
        if (stillVignette == null) {
            stillVignette = new RadialGradient(width / 2f, height / 2f, Math.max(width, height) * 0.72f,
                    new int[]{0x00000000, 0xAA000000}, new float[]{0.2f, 1f}, Shader.TileMode.CLAMP);
        }
        backgroundPaint.setShader(stillVignette);
        canvas.drawRect(0, 0, width, height, backgroundPaint);
        if (!title.isEmpty()) canvas.drawText(title, width / 2f, height * 0.08f, metaPaint);
        float centerY = height * 0.5f;
        drawStillLine(canvas, width, prevLine, prevTranslation, centerY - dp(120), dp(30), 0.30f);
        drawStillLine(canvas, width, line, lineTranslation, centerY, dp(40), 1f);
        drawStillLine(canvas, width, nextLine, nextTranslation, centerY + dp(120), dp(30), 0.30f);
    }

    private void drawStillLine(Canvas canvas, int width, String text, String translation, float centerY, float size, float alpha) {
        if (text == null || text.isEmpty()) return;
        lyricPaint.setTextAlign(Paint.Align.CENTER);
        lyricPaint.setTextSize(size);
        lyricPaint.setColor((Math.round(255 * alpha) << 24) | (stageLight ? 0x111111 : 0xFFFFFF));
        canvas.drawText(text, width / 2f, centerY, lyricPaint);
        if (translation != null && !translation.isEmpty()) {
            nextPaint.setTextAlign(Paint.Align.CENTER);
            nextPaint.setTextSize(size * 0.52f);
            nextPaint.setColor((Math.round(255 * alpha * 0.8f) << 24) | (secondary & 0x00FFFFFF));
            canvas.drawText(translation, width / 2f, centerY + size * 1.35f, nextPaint);
        }
    }

    private void updateParticles(long now, int width, int height) {
        float dt = particleLastAt == 0 ? 0.016f : Math.min(0.05f, (now - particleLastAt) / 1000f);
        particleLastAt = now;
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
            particlePaint.setColor((secondary & 0x00FFFFFF) | (alpha << 24));
            canvas.drawCircle(particleX[index], particleY[index], particleSize[index], particlePaint);
        }
    }

    private boolean drawWords(Canvas canvas, int width, float centerY) {
        if (wordTexts.length == 0 || layoutLyricSize <= 0) return false;
        TextPaint paint = lyricPaint;
        paint.setTextSize(layoutLyricSize);
        paint.setTextAlign(Paint.Align.LEFT);
        float total = 0f;
        for (String word : wordTexts) total += paint.measureText(word);
        if (total <= 0f || total > width * 0.9f) return false;
        float x = (width - total) / 2f;
        float baseline = centerY - (paint.ascent() + paint.descent()) / 2f;
        for (int index = 0; index < wordTexts.length; index++) {
            float span = Math.max(0.001f, wordEnds[index] - wordStarts[index]);
            float progress = Math.max(0f, Math.min(1f, (wordPosition - wordStarts[index]) / span));
            int alpha = 0x55 + Math.round((0xFF - 0x55) * progress);
            int rgb = stageLight ? 0x111111 : 0xFFFFFF;
            paint.setColor((alpha << 24) | rgb);
            canvas.drawText(wordTexts[index], x, baseline, paint);
            x += paint.measureText(wordTexts[index]);
        }
        return true;
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
        if ("still".equals(mode)) {
            drawStill(canvas, width, height);
            return;
        }
        if ("classic".equals(mode)) {
            drawClassic(canvas, width, height);
            return;
        }
        if ("partita".equals(mode)) {
            drawPartita(canvas, width, height);
            return;
        }
        if ("cappella".equals(mode)) {
            drawCappella(canvas, width, height);
            return;
        }
        if ("nebbia".equals(mode)) {
            drawNebbia(canvas, width, height);
            return;
        }

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

        if (audioPower > 0.01f) {
            int bars = 28;
            float barWidth = width / (bars * 1.8f);
            float gap = (width - bars * barWidth) / (bars + 1f);
            float baseY = height * 0.88f;
            barPaint.setColor(stageLight ? 0x33111111 : 0x55FFFFFF);
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
            lyricPaint.setTextAlign(Paint.Align.CENTER);
            canvas.save();
            float left = (width - width * 0.86f) / 2f;
            float top = centerY - lyricLayout.getHeight() / 2f;
            lyricPaint.setColor(stageLight ? 0x55111111 : 0x55FFFFFF);
            canvas.save();
            canvas.translate(left, top);
            lyricLayout.draw(canvas);
            canvas.restore();
            lyricPaint.setColor(stageLight ? 0xFF111111 : Color.WHITE);
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
