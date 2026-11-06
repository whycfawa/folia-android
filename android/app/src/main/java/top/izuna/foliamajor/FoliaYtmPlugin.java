package top.izuna.foliamajor;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.activity.result.ActivityResultLauncher;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * YouTube Music 登录的原生桥（FoliaYtm）。
 *
 * 与汽水那条路**刻意不同**：这里原生只负责「让人登录一次，把 YouTube 的 cookie 交出来」，
 * 协议层（youtubei.js）跑在主 WebView 里 —— 它本来就是浏览器库，不该塞进一个隐藏 WebView。
 * 原生侧因此只有一座 Activity，没有任何取数代码。
 *
 * 为什么非得走原生：YouTube 没给 YouTube Music 的 OAuth，凭据只能是 cookie；而 cookie
 * 只能从「用户真的登录过的那个 WebView」里读。主界面那个 WebView 直接导航到
 * accounts.google.com 等于把整个应用换掉，Chrome Custom Tab 的 cookie 又落进 Chrome 自己的
 * 罐里 —— 所以 {@link YtmSignInActivity} 装一个 WebView，登录完用 Activity Result 把 cookie
 * 交回这里（返回值不经磁盘；要落盘的话由 JS 侧决定，存的走 {@link YtmSessionStore} 加密）。
 */
@CapacitorPlugin(name = "FoliaYtm")
public class FoliaYtmPlugin extends Plugin {
    private static final String TAG = "FoliaYtm";
    /** 与桌面端一致：一次登录最多等十分钟，超时就明说，别让界面一直转。 */
    private static final long ATTEMPT_MS = 10 * 60 * 1000L;
    /** 会话字段的长度上限，与 JS 侧（ytmAndroidSessionStore.ts）同一数值。 */
    private static final int COOKIE_LIMIT = 8192;

    /** 登录屏结果的几个字段：cookie、登录 WebView 的 UA，与顶栏的三句话（文案由 JS 侧按 i18n 传下来，原生侧自己没有文案表）。 */
    public static final String EXTRA_COOKIE = "cookie";
    public static final String EXTRA_USER_AGENT = "userAgent";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_CANCEL_LABEL = "cancelLabel";
    public static final String EXTRA_DONE_LABEL = "doneLabel";
    public static final String EXTRA_ATTEMPT = "attempt";

    private ActivityResultLauncher<Intent> signInLauncher;
    /** 一次登录的一个 call；结果由 Activity Result 交回（MainActivity 的 launcher）。 */
    private PluginCall pendingSignIn;
    private String activeAttempt;
    private boolean screenOpen;
    private final AtomicBoolean settled = new AtomicBoolean(false);
    private final Handler handler = new Handler(Looper.getMainLooper());

    private final Runnable timeout = () -> {
        if (!settled.compareAndSet(false, true)) return;
        Log.w(TAG, "the sign-in did not finish in time");
        PluginCall call = pendingSignIn;
        pendingSignIn = null;
        if (call != null) {
            call.setKeepAlive(false);
            call.resolve(failure("sign-in-failed", "The YouTube Music sign-in was not finished in time"));
            YtmSignInActivity.cancelActive();
        }
    };

    /** MainActivity 在它自己的 onCreate 里把 Activity Result 通道递进来。 */
    public void attachSignInLauncher(ActivityResultLauncher<Intent> launcher) {
        this.signInLauncher = launcher;
    }

    @Override
    protected void handleOnDestroy() {
        // 应用主屏销毁，等待中的登录也别让 JS 侧一直转（结果回来时也没有人听了）。
        if (!settled.compareAndSet(false, true)) return;
        handler.removeCallbacks(timeout);
        PluginCall call = pendingSignIn;
        pendingSignIn = null;
        if (call != null) {
            call.setKeepAlive(false);
            call.resolve(failure("unavailable", "The YouTube Music sign-in has no activity to finish in"));
        }
    }

    /**
     * 起登录那一屏，并把 cookie 带回来。
     *
     * 答 `{ ok: true, session: { cookie, userAgent } }`；取消 / 没登 / 超时 / 上一场还在，
     * 是 `{ ok: false, error: { code, message } }` —— **不是** reject：reject 到 JS 侧会被统一
     * 折成 `unavailable`，「用户取消了」和「这台设备上根本没有这条路」就分不开了。
     */
    @PluginMethod
    public void signIn(PluginCall call) {
        if (signInLauncher == null) {
            Log.w(TAG, "the sign-in screen has no activity result launcher yet");
            call.resolve(failure("unavailable", "The YouTube Music sign-in screen is not ready"));
            return;
        }
        // 上一场登录还在等结果：新来的这场直接拒「正忙」，不顶掉旧的。顶掉的话，旧那一屏的
        // Activity Result 回来就被当成了新这一场的答案，两场登录搅在一起，会话也说不清是谁的。
        synchronized (this) {
            if (screenOpen || (!settled.get() && pendingSignIn != null)) {
                call.resolve(failure("sign-in-busy", "Another YouTube Music sign-in is still running"));
                return;
            }
            settled.set(false);
            pendingSignIn = call;
            activeAttempt = java.util.UUID.randomUUID().toString();
            screenOpen = true;
        }
        handler.removeCallbacks(timeout);
        call.setKeepAlive(true);

        Intent intent = new Intent(getContext(), YtmSignInActivity.class);
        intent.putExtra(EXTRA_ATTEMPT, activeAttempt);
        intent.putExtra(EXTRA_TITLE, call.getString(EXTRA_TITLE, ""));
        intent.putExtra(EXTRA_CANCEL_LABEL, call.getString(EXTRA_CANCEL_LABEL, ""));
        intent.putExtra(EXTRA_DONE_LABEL, call.getString(EXTRA_DONE_LABEL, ""));
        handler.postDelayed(timeout, ATTEMPT_MS);
        // ActivityResult 的 launch 只许在 UI 线程上跑；插件方法在桥自己的线程，起屏交给主线程。
        handler.post(() -> {
            if (settled.get() || signInLauncher == null) return;
            try {
                signInLauncher.launch(intent);
            } catch (Exception error) {
                Log.w(TAG, "the sign-in screen could not be opened", error);
                onSignInActivityResult(android.app.Activity.RESULT_CANCELED, null);
            }
        });
    }

    /** MainActivity 的 Activity Result 通道交回的登录结果；cookie 只在内存里走这一程。 */
    public synchronized void onSignInActivityResult(int resultCode, Intent data) {
        String attempt = data == null ? null : data.getStringExtra(EXTRA_ATTEMPT);
        if (attempt != null && !attempt.equals(activeAttempt)) return;
        screenOpen = false;
        activeAttempt = null;
        handler.removeCallbacks(timeout);
        PluginCall call = pendingSignIn;
        pendingSignIn = null;
        if (!settled.compareAndSet(false, true) || call == null) return;
        call.setKeepAlive(false);
        String cookie = data == null || data.getStringExtra(EXTRA_COOKIE) == null ? "" : data.getStringExtra(EXTRA_COOKIE);
        String userAgent = data == null || data.getStringExtra(EXTRA_USER_AGENT) == null ? "" : data.getStringExtra(EXTRA_USER_AGENT);
        if (resultCode != android.app.Activity.RESULT_OK || cookie.isEmpty() || cookie.length() > COOKIE_LIMIT) {
            Log.w(TAG, "the sign-in screen was closed without YouTube cookies");
            call.resolve(failure("cancelled", "The YouTube Music sign-in was cancelled"));
            return;
        }
        JSObject session = new JSObject();
        session.put("cookie", cookie);
        if (!userAgent.isEmpty()) session.put("userAgent", userAgent);
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("session", session);
        call.resolve(result);
    }

    /** 存着上次验证过的会话吗？答 `{ ok: true, session: … }`，没有就是 `{ ok: true, session: null }`。 */
    @PluginMethod
    public void restoreSession(PluginCall call) {
        YtmSessionStore.YtmSession stored = YtmSessionStore.read(getContext());
        JSObject result = new JSObject();
        result.put("ok", true);
        if (stored != null) {
            JSObject session = new JSObject();
            session.put("cookie", stored.cookie);
            session.put("userAgent", stored.userAgent);
            result.put("session", session);
        } else {
            result.put("session", JSObject.NULL);
        }
        call.resolve(result);
    }

    /**
     * 会话存下去：cookie 与登录的 UA 都有才写（JS 侧只把验证过真账号的会话递进来）。存好了答
     * ok，写不上答 not-ok；JS 侧据此拒绝宣称持久登录成功，而不是悄悄降级为访客。
     */
    @PluginMethod
    public void saveSession(PluginCall call) {
        String cookie = call.getString("cookie", "");
        String userAgent = call.getString("userAgent", "");
        JSObject result = new JSObject();
        result.put("ok", YtmSessionStore.write(getContext(), cookie, userAgent));
        call.resolve(result);
    }

    /** 登出把存着的会话抹掉；Google / YouTube 的 cookie 顺手清掉，别家的（汽水）一个不碰。 */
    @PluginMethod
    public void clearSession(PluginCall call) {
        boolean ok = YtmSessionStore.clear(getContext());
        if (!Boolean.TRUE.equals(call.getBoolean("eraseCookies", true))) {
            JSObject result = new JSObject();
            result.put("ok", ok);
            call.resolve(result);
            return;
        }
        handler.post(() -> {
            synchronized (this) {
                handler.removeCallbacks(timeout);
                settled.set(true);
                PluginCall pending = pendingSignIn;
                pendingSignIn = null;
                if (pending != null) {
                    pending.setKeepAlive(false);
                    pending.resolve(failure("cancelled", "The YouTube Music sign-in was cancelled by sign-out"));
                }
            }
            YtmSignInActivity.cancelActive();
            YtmSignInActivity.eraseYouTubeCookies(() -> {
                JSObject result = new JSObject();
                result.put("ok", ok);
                call.resolve(result);
            });
        });
    }

    private static JSObject failure(String code, String message) {
        JSObject error = new JSObject();
        error.put("code", code);
        error.put("message", message);
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("error", error);
        return result;
    }
}
