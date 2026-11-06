package top.izuna.foliamajor;

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 让用户登录 YouTube 的那一屏（一座独立 Activity 里的 WebView）。
 *
 * 为什么必须有它：YouTube 没有给 YouTube Music 的 OAuth，登录凭据只能是 cookie；而
 * cookie 只能从「用户真的登录过的那个 WebView」里读 —— Chrome Custom Tab 的 cookie 落在
 * Chrome 自己的罐里，我们读不到；把主界面那个 WebView 直接导航到 accounts.google.com
 * 等于把整个应用页面换掉。所以单独开一座 Activity 装一个 WebView，登录完用 Activity
 * Result（setResult，通道在 MainActivity 注册）把 cookie 交回去。
 *
 * ⚠️ 已知风险：**Google 会拒绝「被嵌入的浏览器」登录**（提示“此浏览器或应用可能不安全”）。
 * 这里不做任何 UA 手脚（那是谎报这台设备），被拒就是真的被拒：用户在页面上会直接看到
 * Google 自己的提示，不会假装成功。
 *
 * 取数层不在这里：cookie 交回去之后，youtubei.js 在主 WebView 里用它请求（见
 * services/onlineMusic/ytm/android/ytmAndroidBridge.ts）。
 *
 * 安全底线：页面只许去 Google / YouTube 的 https 地址；不暴露任何 Java 对象给页面
 * （没有 addJavascriptInterface），文件与内容地址（file:// / content://）全关。文案
 * （顶栏三句话）由 JS 侧按 i18n 传入，原生侧自己没有文案表，没了就用英文兜底。
 */
public class YtmSignInActivity extends AppCompatActivity {
    private static final String TAG = "FoliaYtmSignIn";

    /** 起点用 YouTube Music 自己，而不是直接进 accounts.google.com：
     *  由页面自己发起登录，来源与跳转都是 Google 认得的那一条，比凭空拼一个登录 URL 稳。 */
    private static final String START_URL = "https://music.youtube.com/";
    /** 读 cookie 用的两个域：登录态在 youtube.com 上，music.youtube.com 也可能各有一份。 */
    private static final String[] COOKIE_URLS = { "https://www.youtube.com/", "https://music.youtube.com/" };
    /** 登出后要清cookie 的几个 Google / YouTube 的地址；别家（汽水等平台）的一个不碰。 */
    private static final String[] ERASE_COOKIE_URLS = {
        "https://www.youtube.com/", "https://m.youtube.com/", "https://music.youtube.com/",
        "https://youtube.com/", "https://google.com/", "https://accounts.google.com/", "https://www.google.com/",
        "https://myaccount.google.com/",
    };
    /** 桌面端判定「登录了」看的就是这一个 cookie（见 electron/ytm/browserSignIn.cjs）。 */
    private static final String SIGNED_IN_COOKIE = "SAPISID";
    /** 页面只许去的域（后缀界限匹配，比如 app.google.com 算，fakegoogle.com 不算）。 */
    private static final String[] ALLOWED_DOMAINS = { "google.com", "youtube.com", "youtube-nocookie.com" };

    private static java.lang.ref.WeakReference<YtmSignInActivity> active = new java.lang.ref.WeakReference<>(null);
    private WebView webView;

    static void cancelActive() {
        YtmSignInActivity activity = active.get();
        if (activity != null) activity.runOnUiThread(() -> activity.handOver(null));
    }
    /** 结果只交一次：自动判定、手动「完成」、返回键、销毁可能都走到这里。 */
    private boolean handedOver = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        active = new java.lang.ref.WeakReference<>(this);
        // 主题在清单里给（@style/AppTheme.NoActionBar），与 CrashActivity 一致。

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);

        root.addView(buildBar());

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // 登录靠 localStorage / 第三方 cookie 串联 accounts.google.com 与 youtube.com。
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        // 这一座 WebView 只为登录，什么都不给页面开扩权：file://、content://、跨文件读写全关。
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        // UA 保持系统 WebView 原样，不动任何手脚；Google 若拒绝嵌入浏览器就明拒。
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost() == null ? "" : uri.getHost();
                // https 且是 Google / YouTube 的域才放行；地址还得干净：URL 里没有用户信息
                //（userinfo，比如 https://evil@example.com/），端口就是默认的 443。别的
                //（http、自定义端口、intent:// 等自有协议）都不去。
                boolean https = "https".equals(uri.getScheme());
                boolean plainAddress = uri.getUserInfo() == null && (uri.getPort() == -1 || uri.getPort() == 443);
                boolean allowed = https && plainAddress && !host.isEmpty() && isAllowedDomain(host);
                if (!allowed) {
                    Log.w(TAG, "the sign-in blocked a navigation to " + host);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                // A previous Google cookie may still be present. Never close merely because it exists;
                // the listener explicitly confirms the visible account with Done.
            }
        });
        webView.setLayoutParams(new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(webView);

        setContentView(root);
        webView.loadUrl(START_URL);
    }

    /** 顶上一条：左边取消、右边「完成」（自动判定没赶上时用它手动收）。文案从 JS 侧传进来。 */
    private View buildBar() {
        LinearLayout bar = new LinearLayout(this);
        int height = (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 52, getResources().getDisplayMetrics());
        bar.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height));
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#111111"));

        bar.addView(barButton(labelOr("cancelLabel", "Cancel"), view -> handOver(null)));
        TextView title = new TextView(this);
        title.setText(labelOr("title", "Sign in to YouTube Music"));
        title.setTextColor(Color.WHITE);
        title.setTextSize(15);
        title.setGravity(Gravity.CENTER);
        title.setLayoutParams(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(title);
        bar.addView(barButton(labelOr("doneLabel", "Done"), view -> {
            // 没检测到登录态也照用户说的收：cookie 判定有可能漏，而用户看得见自己登没登。
            finishWithCookies();
        }));
        return bar;
    }

    private String labelOr(String extra, String fallback) {
        String value = getIntent() == null ? null : getIntent().getStringExtra(extra);
        return value == null || value.trim().isEmpty() ? fallback : value;
    }

    private Button barButton(String text, View.OnClickListener onClick) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setTextColor(Color.WHITE);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setOnClickListener(onClick);
        return button;
    }

    /** 域的后缀界限匹配：host 等于这个域，或者以「.这个域」结尾。 */
    private static boolean isAllowedDomain(String host) {
        for (String domain : ALLOWED_DOMAINS) {
            if (host.equals(domain) || host.endsWith("." + domain)) return true;
        }
        return false;
    }

    private boolean isSignedIn() {
        String cookie = readCookies();
        return cookie != null && cookie.contains(SIGNED_IN_COOKIE + "=");
    }

    private void finishWithCookies() {
        Log.i(TAG, "the Done button was pressed");
        CookieManager.getInstance().flush();
        handOver(readCookies());
    }

    /** 起屏时这台 WebView 的 UA：之后的会话请求跟着它发（桌面版也是「登录用的 UA + cookie」一对），不另编一个。 */
    private String readUserAgent() {
        return webView != null && webView.getSettings() != null
            ? String.valueOf(webView.getSettings().getUserAgentString()) : "";
    }

    /**
     * 拼出一条 Cookie 头。
     *
     * 同名 cookie 只留一个（www.youtube.com 与 music.youtube.com 上可能都有）：
     * 库那边是「取它找到的第一个」，留两个就等于把顺序交给运气 —— 而带错的那一个
     * 表现为「看着登录了，取自己的歌单却说未登录」。
     */
    private String readCookies() {
        CookieManager manager = CookieManager.getInstance();
        Map<String, String> chosen = new LinkedHashMap<>();
        for (String url : COOKIE_URLS) {
            String cookies = manager.getCookie(url);
            if (cookies == null || cookies.isEmpty()) continue;
            for (String pair : cookies.split("; ")) {
                int split = pair.indexOf('=');
                if (split <= 0) continue;
                String name = pair.substring(0, split).trim();
                String value = pair.substring(split + 1).trim();
                if (name.isEmpty() || value.isEmpty()) continue;
                // 账户自己的那个域优先：后来的不覆盖已有的，第一个来源（www.youtube.com）为准。
                if (!chosen.containsKey(name)) chosen.put(name, value);
            }
        }
        if (chosen.isEmpty()) return null;
        StringBuilder header = new StringBuilder();
        for (Map.Entry<String, String> entry : chosen.entrySet()) {
            if (header.length() > 0) header.append("; ");
            header.append(entry.getKey()).append('=').append(entry.getValue());
        }
        return header.toString();
    }

    /** 把结果交回去（并且只交一次：页面回调与「完成」按钮可能都走到这里）。 */
    private void handOver(String cookie) {
        if (handedOver) return;
        Log.i(TAG, "handing the sign-in result over (cookie " + (cookie != null && !cookie.isEmpty() ? cookie.length() + " chars" : "none") + ")");
        handedOver = true;
        Intent result = new Intent();
        result.putExtra(FoliaYtmPlugin.EXTRA_ATTEMPT, getIntent().getStringExtra(FoliaYtmPlugin.EXTRA_ATTEMPT));
        if (cookie != null && !cookie.isEmpty()) {
            result.putExtra(FoliaYtmPlugin.EXTRA_COOKIE, cookie);
            result.putExtra(FoliaYtmPlugin.EXTRA_USER_AGENT, readUserAgent());
            setResult(RESULT_OK, result);
        } else {
            Log.w(TAG, "no YouTube cookie was found; the sign-in did not happen");
            setResult(RESULT_CANCELED, result);
        }
        finish();
    }

    /**
     * 登出后把 Google / YouTube 的 cookie 清掉（FoliaYtm.clearSession 调）：只清这两个家的，
     * **绝不调 removeAllCookies** —— CookieManager 是全应用一罐的，汽水那几家的会话也在里面，
     * 一清就都抹了。做法是在这几个域上把查得到的每个 cookie 用自己的名再设一遍、积压过期；
     * 标了父域（.youtube.com 之类）的再按父域清一遍。有没有清干净要看浏览器自己记的账，
     * 这一步是尽力清，不是拿保证。
     */
    static void eraseYouTubeCookies(Runnable finished) {
        CookieManager manager = CookieManager.getInstance();
        java.util.List<String[]> expired = new java.util.ArrayList<>();
        for (String source : ERASE_COOKIE_URLS) {
            String host;
            try {
                host = Uri.parse(source).getHost();
            } catch (Exception ignored) {
                host = null;
            }
            String cookies = manager.getCookie(source);
            if (cookies == null || cookies.isEmpty()) continue;
            String dotDomain = host == null || host.isEmpty() ? "" : host.startsWith(".")
                ? host : "." + host;
            for (String pair : cookies.split(";")) {
                int split = pair.indexOf('=');
                String name = (split <= 0 ? pair : pair.substring(0, split)).trim();
                if (name.isEmpty()) continue;
                expired.add(new String[]{source, name + "=; Max-Age=0; Path=/; Secure"});
                if (!dotDomain.isEmpty()) {
                    expired.add(new String[]{source, name + "=; Max-Age=0; Path=/; Secure; Domain=" + dotDomain});
                }
            }
        }
        if (expired.isEmpty()) { manager.flush(); finished.run(); return; }
        java.util.concurrent.atomic.AtomicInteger remaining = new java.util.concurrent.atomic.AtomicInteger(expired.size());
        for (String[] entry : expired) {
            manager.setCookie(entry[0], entry[1], ignored -> {
                if (remaining.decrementAndGet() == 0) { manager.flush(); finished.run(); }
            });
        }
    }

    // 返回键就是默认的收尾（finish）；真正的销毁（用户离开）时兜底把取消交回去，
    // 但**旋转等配置重建的销毁不算**：那时候 isFinishing() 是 false，不许 finish/setResult，
    // 会话交给重建出来的那一屏接着守住。
    @Override
    protected void onDestroy() {
        Log.i(TAG, "sign-in screen destroyed (handedOver=" + handedOver + " finishing=" + isFinishing() + ")");
        if (!handedOver && isFinishing()) handOver(null);
        if (webView != null) {
            webView.setWebViewClient(new WebViewClient());
            webView.destroy();
            webView = null;
        }
        if (active.get() == this) active.clear();
        super.onDestroy();
    }
}
