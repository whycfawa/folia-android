package top.izuna.foliamajor;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Apple Music companion for Android: a hidden WebView owns Apple's MusicKit page, and the same
 * request expressions as the desktop companion run inside that page. Nothing leaves the WebView
 * except the normalized result the provider already expects.
 */
@CapacitorPlugin(name = "FoliaAppleMusic")
public class FoliaAppleMusicPlugin extends Plugin {
    private static final String HOME = "https://music.apple.com/";
    private FrameLayout container;
    private WebView webView;
    private boolean bridgeInjected;
    private boolean loading;
    private final Map<String, PluginCall> pending = new HashMap<>();
    private final List<Runnable> queued = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<String, Runnable> timeouts = new HashMap<>();
    private static final long REQUEST_TIMEOUT_MS = 20_000L;

    private Activity activity() {
        return getActivity();
    }

    private void ensureWebView() {
        if (webView != null) return;
        Activity activity = activity();
        if (activity == null) return;
        container = new FrameLayout(activity);
        container.setBackgroundColor(Color.BLACK);
        container.setAlpha(0.01f);
        container.setVisibility(ViewGroup.VISIBLE);
        webView = new WebView(activity);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setUserAgentString("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
        webView.addJavascriptInterface(new Bridge(), "FoliaAppleMusicBridge");
        webView.setKeepScreenOn(true);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(resource)
                            && request.getOrigin() != null
                            && (request.getOrigin().getHost() != null)
                            && (request.getOrigin().getHost().equals("music.apple.com")
                                || request.getOrigin().getHost().endsWith(".music.apple.com"))) {
                        request.grant(new String[] { PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID });
                        return;
                    }
                }
                request.deny();
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                loading = false;
                view.onResume();
                view.resumeTimers();
                injectBridge();
            }
        });
        container.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (root != null) root.addView(container, new FrameLayout.LayoutParams(1, 1));
        loadHome();
    }

    private void loadHome() {
        if (webView == null || loading) return;
        loading = true;
        bridgeInjected = false;
        webView.loadUrl(HOME);
    }

    private void injectBridge() {
        if (webView == null) return;
        try {
            java.io.InputStream stream = getContext().getAssets().open("appleMusicBridge.js");
            byte[] bytes = new byte[stream.available()];
            // Assets are small and bounded; read fully.
            int offset = 0;
            while (offset < bytes.length) {
                int read = stream.read(bytes, offset, bytes.length - offset);
                if (read < 0) break;
                offset += read;
            }
            stream.close();
            String script = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            webView.evaluateJavascript(script, null);
            bridgeInjected = true;
            List<Runnable> work = new ArrayList<>(queued);
            queued.clear();
            for (Runnable runnable : work) runnable.run();
        } catch (Throwable error) {
            bridgeInjected = false;
        }
    }

    private void dispatch(PluginCall call, String operation, JSObject params) {
        String id = UUID.randomUUID().toString().replace("-", "");
        pending.put(id, call);
        Runnable timeout = () -> finishError(id, "timeout");
        timeouts.put(id, timeout);
        handler.postDelayed(timeout, REQUEST_TIMEOUT_MS);
        Runnable work = () -> {
            try {
                JSONObject message = new JSONObject();
                message.put("id", id);
                message.put("operation", operation);
                message.put("params", params == null ? new JSONObject() : new JSONObject(params.toString()));
                webView.evaluateJavascript("window.__foliaAppleMusicBuild(" + message + ")", value -> {
                    if (value == null || "null".equals(value)) {
                        finishError(id, "invalid-request");
                        return;
                    }
                    try {
                        String expression = new JSONArray("[" + value + "]").getString(0);
                        String js = "Promise.resolve(" + expression + ").then(function(r){"
                                + "FoliaAppleMusicBridge.resolve(\"" + id + "\", JSON.stringify(r));"
                                + "}).catch(function(){FoliaAppleMusicBridge.resolve(\"" + id + "\", JSON.stringify({ok:false,error:'request-failed'}));});";
                        webView.evaluateJavascript(js, null);
                    } catch (Throwable error) {
                        finishError(id, "invalid-response");
                    }
                });
            } catch (Throwable error) {
                finishError(id, "invalid-request");
            }
        };
        if (bridgeInjected) work.run(); else queued.add(work);
        if (!bridgeInjected && !loading) loadHome();
    }

    private void finishError(String id, String error) {
        Runnable timeout = timeouts.remove(id);
        if (timeout != null) handler.removeCallbacks(timeout);
        PluginCall call = pending.remove(id);
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("error", error);
        Activity activity = activity();
        if (activity == null) call.resolve(result); else activity.runOnUiThread(() -> call.resolve(result));
    }

    @PluginMethod
    public void request(PluginCall call) {
        Activity activity = activity();
        if (activity == null) {
            JSObject result = new JSObject();
            result.put("ok", false);
            result.put("error", "not-ready");
            call.resolve(result);
            return;
        }
        String operation = call.getString("operation", "");
        JSObject params = call.getObject("params");
        activity.runOnUiThread(() -> {
            ensureWebView();
            dispatch(call, operation, params);
        });
    }

    @PluginMethod
    public void showWindow(PluginCall call) {
        Activity activity = activity();
        if (activity == null) { call.reject("no activity"); return; }
        activity.runOnUiThread(() -> {
            ensureWebView();
            if (container != null) {
                container.setAlpha(1f);
                container.setLayoutParams(new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                container.setVisibility(ViewGroup.VISIBLE);
                container.bringToFront();
            }
            if (webView != null && !bridgeInjected) loadHome();
            call.resolve();
        });
    }

    @PluginMethod
    public void hideWindow(PluginCall call) {
        Activity activity = activity();
        if (activity == null) { call.resolve(); return; }
        activity.runOnUiThread(() -> {
            if (container != null) {
                container.setAlpha(0.01f);
                container.setLayoutParams(new FrameLayout.LayoutParams(1, 1));
                container.setVisibility(ViewGroup.VISIBLE);
            }
            call.resolve();
        });
    }

    private final class Bridge {
        @JavascriptInterface
        public void resolve(String id, String json) {
            PluginCall call = pending.remove(id);
            if (call == null) return;
            Runnable timeout = timeouts.remove(id);
            if (timeout != null) handler.removeCallbacks(timeout);
            JSObject result = new JSObject();
            try {
                JSONObject object = new JSONObject(json);
                result.put("ok", object.optBoolean("ok", false));
                if (object.has("data")) result.put("data", object.opt("data"));
                if (object.has("error")) result.put("error", object.optString("error", "request-failed"));
                if (object.has("httpStatus")) result.put("httpStatus", object.optInt("httpStatus", 0));
                if (object.has("playbackStage")) result.put("playbackStage", object.optString("playbackStage"));
            } catch (Throwable error) {
                result.put("ok", false);
                result.put("error", "invalid-response");
            }
            Activity activity = activity();
            if (activity == null) call.resolve(result); else activity.runOnUiThread(() -> call.resolve(result));
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        if (container != null) {
            ViewGroup parent = (ViewGroup) container.getParent();
            if (parent != null) parent.removeView(container);
            container = null;
        }
        super.handleOnDestroy();
    }
}
