package top.izuna.foliamajor;

import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Window;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.CapConfig;

/**
 * Leanback entry point. It reuses MainActivity's WebView recovery, cache cleanup and native plugin
 * registration, but starts Capacitor at the lightweight /tv.html root and keeps the window landscape.
 */
public class TvActivity extends MainActivity {
    @Override
    protected void load() {
        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        config = new CapConfig.Builder(this)
            .setHTML5mode(true)
            .setHostname("localhost")
            .setAndroidScheme("https")
            .setAllowMixedContent(true)
            .setStartPath("/tv.html")
            .setBackgroundColor("#07070c")
            .setWebContentsDebuggingEnabled(debuggable)
            // Capacitor serializes every plugin result before logging it. On the projector that
            // stringification lands on the WebView main thread while the home feeds are loading,
            // turning routine bridge traffic into 50-200ms frame stalls. Native errors still go
            // through CrashDiagnostics, so TV keeps the quieter bridge in debug builds too.
            .setLoggingEnabled(false)
            .create();
        super.load();
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enterTvMode();
        focusWebView();
        postFocusWebView(250);
    }

    @Override
    public void onResume() {
        super.onResume();
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        enterTvMode();
        focusWebView();
        postFocusWebView(250);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterTvMode();
            focusWebView();
            postFocusWebView(150);
        }
    }

    /** Keeps the WebView as the native key-focus owner so the first remote press is not lost. */
    private void focusWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus();
    }

    private void postFocusWebView(long delayMs) {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().postDelayed(this::focusWebView, delayMs);
    }

    /** TV pages always own the whole panel; the phone adaptive-layout preference is ignored here. */
    private void enterTvMode() {
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
            window,
            window.getDecorView()
        );
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
    }
}

