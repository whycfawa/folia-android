package top.izuna.foliamajor;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;

import java.util.HashMap;
import java.util.Map;

/** Vulkan 文字字形图集的 Java 侧构建器。每个模式自己决定要打包哪些字符。 */
public final class VulkanTextAtlas {
    public static final int SIZE = 1024;
    public static final int PADDING = 2;

    public static final class Glyph {
        public final char character;
        public final int x;
        public final int y;
        public final int width;
        public final int height;
        public final float advance;
        public final float baseline;
        public final float u0;
        public final float v0;
        public final float u1;
        public final float v1;

        Glyph(char character, int x, int y, int width, int height, float advance, float baseline) {
            this.character = character;
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
            this.advance = advance;
            this.baseline = baseline;
            this.u0 = (float) x / SIZE;
            this.v0 = (float) y / SIZE;
            this.u1 = (float) (x + width) / SIZE;
            this.v1 = (float) (y + height) / SIZE;
        }
    }

    private final Bitmap bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888);
    private final Canvas canvas = new Canvas(bitmap);
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Map<String, Glyph> glyphs = new HashMap<>();
    private final Rect bounds = new Rect();
    private int penX = PADDING;
    private int penY = PADDING;
    private int rowHeight = 0;
    private float size = 0f;
    private int weight = 700;
    private boolean overflowed = false;

    public VulkanTextAtlas() {
        canvas.drawColor(Color.TRANSPARENT);
        paint.setColor(Color.WHITE);
        paint.setTextAlign(Paint.Align.LEFT);
        paint.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
    }

    public void setTextSize(float size) {
        this.size = size;
        paint.setTextSize(size);
        paint.getTextBounds("Ag", 0, 2, bounds);
        rowHeight = Math.max(bounds.height(), (int) size) + PADDING * 2;
    }

    public void setWeight(int weight) {
        this.weight = weight;
        android.graphics.Typeface typeface = weight >= 700
                ? android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD)
                : (weight >= 600
                    ? android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
                    : android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.NORMAL));
        paint.setTypeface(typeface);
    }

    public Glyph get(char character) {
        String key = weight + "#" + size + "#" + character;
        Glyph existing = glyphs.get(key);
        if (existing != null) return existing;
        paint.getTextBounds(String.valueOf(character), 0, 1, bounds);
        int width = Math.max(1, bounds.width() + PADDING * 2);
        int height = Math.max(1, bounds.height() + PADDING * 2);
        if (penX + width + PADDING > SIZE) {
            penX = PADDING;
            penY += rowHeight;
        }
        if (penY + height + PADDING > SIZE) { overflowed = true; return null; }
        float baseline = penY - bounds.top + PADDING;
        canvas.drawText(String.valueOf(character), penX - bounds.left + PADDING, baseline, paint);
        Glyph glyph = new Glyph(character, penX, penY, width, height, paint.measureText(String.valueOf(character)), baseline - penY);
        glyphs.put(key, glyph);
        penX += width + PADDING;
        return glyph;
    }

    public int[] pixels() {
        int[] out = new int[SIZE * SIZE];
        bitmap.getPixels(out, 0, SIZE, 0, 0, SIZE, SIZE);
        return out;
    }

    public boolean overflowed() { return overflowed; }

    public Bitmap bitmap() {
        return bitmap;
    }
}
