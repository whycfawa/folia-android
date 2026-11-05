package top.izuna.foliamajor;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.view.MotionEvent;
import android.view.View;

/** 原生底部控制条：上一首、播放/暂停、下一首。只覆盖底部一条，其他区域仍由 WebView 接管。 */
public class FoliaNativeStageControlsView extends View {
    public interface Listener {
        void onPrevious();
        void onToggle();
        void onNext();
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final RectF rect = new RectF();
    private Listener listener;
    private boolean playing = true;

    public FoliaNativeStageControlsView(Context context) {
        super(context);
        setClickable(true);
        setFocusable(false);
        paint.setColor(Color.WHITE);
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    public void setPlaying(boolean playing) {
        this.playing = playing;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        int width = getWidth();
        int height = getHeight();
        if (width <= 0 || height <= 0) return;
        float margin = dp(24);
        float barHeight = Math.min(dp(64), height - dp(8));
        rect.set(margin, (height - barHeight) / 2f, width - margin, (height + barHeight) / 2f);
        paint.setColor(0xCC101014);
        canvas.drawRoundRect(rect, barHeight / 2f, barHeight / 2f, paint);
        paint.setColor(0x55FFFFFF);
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(dp(1));
        canvas.drawRoundRect(rect, barHeight / 2f, barHeight / 2f, paint);
        paint.setStyle(Paint.Style.FILL);

        float cy = height / 2f;
        float left = width * 0.27f;
        float middle = width * 0.5f;
        float right = width * 0.73f;
        paint.setColor(Color.WHITE);
        // prev
        path.reset();
        path.moveTo(left - dp(7), cy); path.lineTo(left + dp(5), cy - dp(9)); path.lineTo(left + dp(5), cy + dp(9)); path.close();
        canvas.drawPath(path, paint);
        paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(dp(2));
        canvas.drawLine(left - dp(10), cy - dp(9), left - dp(10), cy + dp(9), paint);
        paint.setStyle(Paint.Style.FILL);
        // next
        path.reset();
        path.moveTo(right + dp(7), cy); path.lineTo(right - dp(5), cy - dp(9)); path.lineTo(right - dp(5), cy + dp(9)); path.close();
        canvas.drawPath(path, paint);
        paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(dp(2));
        canvas.drawLine(right + dp(10), cy - dp(9), right + dp(10), cy + dp(9), paint);
        paint.setStyle(Paint.Style.FILL);
        // play / pause
        if (playing) {
            canvas.drawRect(middle - dp(7), cy - dp(9), middle - dp(2), cy + dp(9), paint);
            canvas.drawRect(middle + dp(2), cy - dp(9), middle + dp(7), cy + dp(9), paint);
        } else {
            path.reset();
            path.moveTo(middle - dp(5), cy - dp(10)); path.lineTo(middle + dp(10), cy); path.lineTo(middle - dp(5), cy + dp(10)); path.close();
            canvas.drawPath(path, paint);
        }
    }

    private float dp(float value) {
        return value * getResources().getDisplayMetrics().density;
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        if (event.getAction() != MotionEvent.ACTION_UP) return true;
        int width = getWidth();
        float x = event.getX();
        if (x < width / 3f) { if (listener != null) listener.onPrevious(); }
        else if (x > width * 2f / 3f) { if (listener != null) listener.onNext(); }
        else { if (listener != null) listener.onToggle(); }
        performClick();
        return true;
    }

    @Override
    public boolean performClick() {
        super.performClick();
        return true;
    }
}
