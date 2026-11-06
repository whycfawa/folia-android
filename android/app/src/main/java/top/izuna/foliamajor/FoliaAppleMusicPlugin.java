package top.izuna.foliamajor;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.graphics.Color;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.TextView;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
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

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Apple Music companion for Android: a hidden WebView owns Apple's MusicKit page, and the same
 * request expressions as the desktop companion run inside that page. Nothing leaves the WebView
 * except the normalized result the provider already expects.
 */
@CapacitorPlugin(name = "FoliaAppleMusic")
public class FoliaAppleMusicPlugin extends Plugin {
    private static final String HOME = "https://music.apple.com/";
    private static final String TAG = "FoliaAppleMusic";
    private static final int CONSOLE_LIMIT = 160;
    private FrameLayout container;
    private WebView webView;
    /** Shown over a page the listener opened by hand: the only way back without leaving the app. */
    private TextView closeButton;
    /** The last URL the page settled on, with the query and any deeper path dropped. UI thread only. */
    private volatile String lastPageUrl;
    private volatile boolean bridgeInjected;
    private volatile boolean loading;
    /** The storefront Apple reports for the signed-in account; the page has to play in this one. */
    private volatile String accountStorefront;
    /** Set while the page still has to move to that storefront but a request was in flight. */
    private volatile boolean storefrontMoveDue;
    /** Set once this document has had a track actually sound: a reload now would cut it off. */
    private volatile boolean playbackStarted;
    /** Set when a play has been asked of this document: a reload would drop it before it sounds. */
    private volatile boolean playRequested;
    private final Map<String, PluginCall> pending = new ConcurrentHashMap<>();
    private final Map<String, String> pendingOperations = new ConcurrentHashMap<>();
    private final Map<String, Runnable> timeouts = new ConcurrentHashMap<>();
    private final List<Runnable> queued = new CopyOnWriteArrayList<>();
    private final Deque<String> consoleLog = new ArrayDeque<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private static final long REQUEST_TIMEOUT_MS = 20_000L;

    private Activity activity() {
        return getActivity();
    }

    /** Locally identifying text never leaves this app: addresses, ids and long blobs are scrubbed. */
    private static String scrub(String line) {
        if (line == null) return "";
        String out = line.replaceAll("https?://\\S+", "url");
        out = out.replaceAll("[A-Za-z0-9_\\-]{40,}", "<blob>");
        out = out.replaceAll("\\b\\d{6,}\\b", "<num>");
        out = out.replaceAll("\\b(?:pl|l|ra)\\.[A-Za-z0-9._\\-]+", "<id>");
        return out.length() > 300 ? out.substring(0, 300) : out;
    }

    /** One line of the page's own story, for the app's diagnostics report and logcat. */
    private void note(String line) {
        String clean = scrub(line);
        Log.i(TAG, clean);
        appendConsole(System.currentTimeMillis() + " " + clean);
    }

    private void appendConsole(String line) {
        synchronized (consoleLog) {
            consoleLog.addLast(line);
            while (consoleLog.size() > CONSOLE_LIMIT) consoleLog.removeFirst();
        }
    }

    /** Once per process: lets this companion page be inspected over adb while a start is failing. */
    private static boolean debuggingEnabled;

    private void ensureWebView() {
        if (!debuggingEnabled) {
            debuggingEnabled = true;
            try { WebView.setWebContentsDebuggingEnabled(true); } catch (Throwable ignored) { /* Release builds may refuse. */ }
        }
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
        // Apple's sign-in and its player read cookies from more than the top-level origin.
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new Bridge(), "FoliaAppleMusicBridge");
        webView.setKeepScreenOn(true);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                String host = request.getOrigin() == null || request.getOrigin().getHost() == null
                        ? "" : request.getOrigin().getHost();
                for (String resource : request.getResources()) {
                    if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(resource)
                            && (host.equals("music.apple.com") || host.endsWith(".music.apple.com"))) {
                        note("protected media granted for " + host);
                        request.grant(new String[] { PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID });
                        return;
                    }
                }
                StringBuilder asked = new StringBuilder();
                for (String resource : request.getResources()) {
                    asked.append(asked.length() > 0 ? "," : "").append(resource);
                }
                note("permission denied " + asked + " for " + host);
                request.deny();
            }

            // Apple's player says why a start failed only in its console.
            @Override public boolean onConsoleMessage(ConsoleMessage message) {
                String line = message.message() == null ? "" : message.message();
                String entry = "page " + message.messageLevel() + " " + line + " @" + message.lineNumber();
                boolean ours = line.startsWith("[AppleMusic");
                // logcat gets everything a developer would want; the report keeps our own lines, the
                // page's errors and nothing else of Apple's chatter.
                if (ours || message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    note(entry);
                } else {
                    Log.d(TAG, scrub(entry));
                }
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                loading = false;
                playbackStarted = false;
                playRequested = false;
                lastPageUrl = shortUrl(url);
                view.onResume();
                view.resumeTimers();
                note("page loaded " + lastPageUrl);
                injectBridge();
                tryMoveToStorefront();
            }
        });
        container.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (root != null) root.addView(container, new FrameLayout.LayoutParams(1, 1));
        loadHome();
    }

    /** Origin and the storefront segment only: a deeper path names an album or a playlist. */
    private static String shortUrl(String url) {
        if (url == null) return "";
        int cut = url.length();
        int query = url.indexOf('?');
        if (query >= 0 && query < cut) cut = query;
        int hash = url.indexOf('#');
        if (hash >= 0 && hash < cut) cut = hash;
        String base = url.substring(0, cut);
        if (!base.startsWith(HOME)) return base.startsWith("https://music.apple.com") ? HOME : base.length() > 80 ? base.substring(0, 80) : base;
        String rest = base.substring(HOME.length());
        int slash = rest.indexOf('/');
        return HOME + (slash >= 0 ? rest.substring(0, slash) : rest);
    }

    private void loadHome() {
        if (webView == null || loading) return;
        loading = true;
        bridgeInjected = false;
        // The account's storefront in the URL, as the desktop companion opens it: MusicKit plays a
        // catalog id only against the page's own region.
        webView.loadUrl(accountStorefront == null ? HOME : HOME + accountStorefront + "/");
    }

    /** Tells the page which host is driving it, and which storefront it must play in. */
    private void applyPageFacts() {
        if (webView == null || !bridgeInjected) return;
        String script = "window.__foliaCompanionHost='android';"
                + "window.__foliaAccountStorefront='" + (accountStorefront == null ? "" : accountStorefront) + "';";
        webView.evaluateJavascript(script, null);
    }

    private void moveToStorefront(String storefront) {
        if (storefront == null || !storefront.matches("[a-z]{2}")) return;
        if (!storefront.equals(accountStorefront)) {
            accountStorefront = storefront;
            note("account storefront " + storefront);
        }
        storefrontMoveDue = true;
        applyPageFacts();
        tryMoveToStorefront();
    }

    /** Moves the page once nothing is waiting on it: a reload under a request would lose that request. */
    private void tryMoveToStorefront() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            handler.post(this::tryMoveToStorefront);
            return;
        }
        if (!storefrontMoveDue || accountStorefront == null) return;
        // The page moves itself in place before a start, so a document that already sounded keeps its
        // storefront: reloading it here would stop the song for a correction it no longer needs.
        if (playbackStarted || playRequested) return;
        if (webView == null || loading || !pending.isEmpty() || !queued.isEmpty()) return;
        String url = shortUrl(webView.getUrl());
        if (!url.startsWith(HOME)) return;
        String current = url.substring(HOME.length());
        if (accountStorefront.equals(current)) {
            storefrontMoveDue = false;
            return;
        }
        storefrontMoveDue = false;
        note("page moves to storefront " + accountStorefront);
        loading = true;
        bridgeInjected = false;
        webView.loadUrl(HOME + accountStorefront + "/");
    }

    /**
     * Asks the page for the account's storefront as soon as it can answer, so the next load already
     * opens the right region instead of waiting for the app to check a login status first. Best
     * effort: a page whose MusicKit is not configured yet simply answers nothing.
     */
    private void probeStorefront() {
        if (webView == null || !bridgeInjected) return;
        try {
            JSONObject message = new JSONObject();
            message.put("id", "storefrontprobe");
            message.put("operation", "accountStatus");
            message.put("params", new JSONObject());
            webView.evaluateJavascript("window.__foliaAppleMusicBuild(" + message + ")", value -> {
                if (value == null || "null".equals(value)) return;
                try {
                    String expression = new JSONArray("[" + value + "]").getString(0);
                    String js = "Promise.resolve(" + expression + ").then(function(r){"
                            + "if(r&&r.ok&&r.data&&r.data.storefront){FoliaAppleMusicBridge.storefront(r.data.storefront);}"
                            + "}).catch(function(){});";
                    webView.evaluateJavascript(js, null);
                } catch (Throwable ignored) {
                    // A page that cannot build the request is not ready for one.
                }
            });
        } catch (Throwable ignored) {
            // Nothing to ask yet.
        }
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
            applyPageFacts();
            probeStorefront();
            handler.postDelayed(this::probeStorefront, 4000);
            List<Runnable> work = new ArrayList<>(queued);
            queued.clear();
            for (Runnable runnable : work) runnable.run();
        } catch (Throwable error) {
            bridgeInjected = false;
            note("bridge injection failed " + error.getClass().getSimpleName());
        }
    }

    private void dispatch(PluginCall call, String operation, JSObject params) {
        String id = UUID.randomUUID().toString().replace("-", "");
        pending.put(id, call);
        pendingOperations.put(id, operation);
        if ("playSong".equals(operation) || "playStation".equals(operation)) playRequested = true;
        Runnable timeout = () -> finishError(id, "timeout");
        timeouts.put(id, timeout);
        handler.postDelayed(timeout, REQUEST_TIMEOUT_MS);
        Runnable work = () -> {
            // The caller may have given up while this waited for the page.
            if (!pending.containsKey(id)) return;
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
        String operation = pendingOperations.remove(id);
        if (call == null) return;
        note("request failed " + (operation == null ? "?" : operation) + " " + error);
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("error", error);
        Activity activity = activity();
        if (activity == null) {
            call.resolve(result);
            tryMoveToStorefront();
        } else {
            activity.runOnUiThread(() -> {
                call.resolve(result);
                tryMoveToStorefront();
            });
        }
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
            // A page still due for its account's region moves first; the request then waits in the
            // queue and reaches the reloaded page, so even the first play starts in the right one.
            tryMoveToStorefront();
            dispatch(call, operation, params);
        });
    }

    /**
     * The page's own account of a playback problem: the companion's console tail, the storefront it
     * is playing in, and whatever else the page reports about its player and its CDM. Read-only, and
     * it never starts a page just to answer: with no page there is nothing to report.
     */
    @PluginMethod
    public void diagnostics(PluginCall call) {
        Activity activity = activity();
        if (activity == null) {
            JSObject result = new JSObject();
            result.put("ok", false);
            result.put("error", "not-ready");
            call.resolve(result);
            return;
        }
        activity.runOnUiThread(() -> {
            if (webView == null) {
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("error", "no-page");
                result.put("companion", companionSnapshot());
                call.resolve(result);
                return;
            }
            if (!bridgeInjected) {
                JSObject result = new JSObject();
                result.put("ok", false);
                result.put("error", "page-loading");
                result.put("companion", companionSnapshot());
                call.resolve(result);
                return;
            }
            dispatch(call, "diagnostics", new JSObject());
        });
    }

    /** Java-side facts only: read from the UI thread's cached state, never from the WebView itself. */
    private JSObject companionSnapshot() {
        JSObject out = new JSObject();
        JSONArray lines = new JSONArray();
        synchronized (consoleLog) {
            for (String line : consoleLog) {
                try {
                    lines.put(line);
                } catch (Throwable ignored) {
                    // A line the array refuses is not worth failing the report for.
                }
            }
        }
        out.put("console", lines);
        out.put("accountStorefront", accountStorefront == null ? "" : accountStorefront);
        out.put("bridgeInjected", bridgeInjected);
        out.put("loading", loading);
        out.put("storefrontMoveDue", storefrontMoveDue);
        out.put("playbackStarted", playbackStarted);
        out.put("playRequested", playRequested);
        out.put("queued", queued.size());
        out.put("pending", pending.size());
        out.put("pageUrl", lastPageUrl == null ? "" : lastPageUrl);
        return out;
    }

    private int dp(int value) {
        Activity activity = activity();
        float density = activity == null ? 1f : activity.getResources().getDisplayMetrics().density;
        return Math.round(value * density);
    }

    /** A page opened by hand is the listener's to leave: one tap goes back to the app. */
    private void showCloseButton(Activity activity) {
        if (container == null || closeButton != null) return;
        TextView button = new TextView(activity);
        button.setText("×");
        button.setTextSize(22f);
        button.setTextColor(Color.WHITE);
        button.setGravity(Gravity.CENTER);
        button.setBackgroundColor(0x99000000);
        button.setContentDescription("close");
        button.setOnClickListener(view -> hideWindowNow());
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP | Gravity.END);
        params.topMargin = dp(28);
        params.rightMargin = dp(16);
        container.addView(button, params);
        closeButton = button;
    }

    private void hideWindowNow() {
        if (container == null) return;
        container.setAlpha(0.01f);
        container.setLayoutParams(new FrameLayout.LayoutParams(1, 1));
        if (closeButton != null) {
            container.removeView(closeButton);
            closeButton = null;
        }
    }

    @PluginMethod
    public void showWindow(PluginCall call) {
        Activity activity = activity();
        if (activity == null) { call.reject("no activity"); return; }
        boolean manual = Boolean.TRUE.equals(call.getBoolean("manual", false));
        activity.runOnUiThread(() -> {
            ensureWebView();
            if (container != null) {
                container.setAlpha(1f);
                container.setLayoutParams(new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                container.setVisibility(ViewGroup.VISIBLE);
                container.bringToFront();
                if (manual) showCloseButton(activity);
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
            hideWindowNow();
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
            String operation = pendingOperations.remove(id);
            JSObject result = new JSObject();
            JSONObject object = null;
            try {
                object = new JSONObject(json);
                result.put("ok", object.optBoolean("ok", false));
                if (object.has("data")) result.put("data", object.opt("data"));
                if (object.has("error")) result.put("error", object.optString("error", "request-failed"));
                if (object.has("httpStatus")) result.put("httpStatus", object.optInt("httpStatus", 0));
                if (object.has("playbackStage")) result.put("playbackStage", object.optString("playbackStage"));
            } catch (Throwable error) {
                result.put("ok", false);
                result.put("error", "invalid-response");
            }
            if ("diagnostics".equals(operation)) result.put("companion", companionSnapshot());
            if (object != null) notePlaybackFacts(operation, object);
            Activity activity = activity();
            if (activity == null) {
                call.resolve(result);
                tryMoveToStorefront();
            } else {
                activity.runOnUiThread(() -> {
                    call.resolve(result);
                    tryMoveToStorefront();
                });
            }
        }

        /** The page moves itself in place, so the host only needs the region for the next load. */
        @JavascriptInterface
        public void storefront(String storefront) {
            if (storefront == null || !storefront.matches("[a-z]{2}")) return;
            handler.post(() -> moveToStorefront(storefront));
        }
    }

    /** Only a track that actually sounded blocks the page from moving to its account's region. */
    private void notePlaybackFacts(String operation, JSONObject object) {
        boolean playbackAnswer = "playSong".equals(operation) || "playStation".equals(operation);
        if (!playbackAnswer && !"playbackStatus".equals(operation)) return;
        try {
            JSONObject data = object.optJSONObject("data");
            if (data == null) return;
            // The start answer usually precedes the sound; the poll is what confirms it.
            if (data.optBoolean("isPlaying", false)) playbackStarted = true;
            String storefront = playbackAnswer ? data.optString("storefront", "") : "";
            if (storefront != null && storefront.matches("[a-z]{2}")) {
                handler.post(() -> moveToStorefront(storefront));
            }
        } catch (Throwable ignored) {
            // Facts the answer did not carry are not a failure.
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
