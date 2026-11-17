package top.izuna.foliamajor;

import android.app.Activity;
import android.content.Context;
import android.hardware.display.DisplayManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Display;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.ArrayDeque;
import java.util.Iterator;

/**
 * 刷新率日志：每秒记一次系统当前的 Display.getRefreshRate()，只留最近 300 秒。
 *
 * 「选了 120、松手一会儿就掉到 60」这类问题要看的是回落发生在第几秒、之后有没有回升，
 * 而不是报告生成那一瞬间的值（用户来点「复制诊断数据」时屏幕刚被摸过，必然是最高的那一档）。
 * 这里只读系统的当前值，不申请、不改任何刷新率。
 */
public final class DisplayFrameRateJournal {
    private static final int CAPACITY = 300;
    private static final long INTERVAL_MS = 1000L;
    private static final ArrayDeque<long[]> SAMPLES = new ArrayDeque<>();
    private static final Handler HANDLER = new Handler(Looper.getMainLooper());
    private static Activity activity;
    private static boolean running;

    private static final Runnable TICK = new Runnable() {
        @Override
        public void run() {
            record();
            if (running) HANDLER.postDelayed(this, INTERVAL_MS);
        }
    };

    private DisplayFrameRateJournal() {
    }

    /** 前台时开始记录；重复调用无副作用。 */
    public static synchronized void start(Activity owner) {
        activity = owner;
        if (running) return;
        running = true;
        HANDLER.postDelayed(TICK, INTERVAL_MS);
    }

    /** 退到后台时停下，回到前台再开；记录本身保留。 */
    public static synchronized void stop() {
        running = false;
        HANDLER.removeCallbacks(TICK);
    }

    private static void record() {
        Activity owner;
        synchronized (DisplayFrameRateJournal.class) {
            owner = activity;
        }
        if (owner == null) return;
        try {
            // getDefaultDisplay() 在新系统上被弃用，DisplayManager 是它现在的替代。
            DisplayManager manager = (DisplayManager) owner.getSystemService(Context.DISPLAY_SERVICE);
            Display display = manager == null ? null : manager.getDisplay(Display.DEFAULT_DISPLAY);
            if (display == null) return;
            long now = SystemClock.elapsedRealtime();
            long rate = Math.round(display.getRefreshRate() * 100.0f);
            synchronized (DisplayFrameRateJournal.class) {
                SAMPLES.addLast(new long[]{now, rate});
                while (SAMPLES.size() > CAPACITY) SAMPLES.removeFirst();
            }
        } catch (Exception ignored) {
            // A display that briefly refuses to answer just contributes no point.
        }
    }

    /** [{ageMs, hz}]，从旧到新；ageMs 是采样距现在的毫秒数。 */
    public static synchronized JSONArray snapshot() throws JSONException {
        JSONArray out = new JSONArray();
        long now = SystemClock.elapsedRealtime();
        Iterator<long[]> iterator = SAMPLES.iterator();
        while (iterator.hasNext()) {
            long[] sample = iterator.next();
            JSONArray pair = new JSONArray();
            pair.put(now - sample[0]);
            pair.put(sample[1] / 100.0);
            out.put(pair);
        }
        return out;
    }
}
