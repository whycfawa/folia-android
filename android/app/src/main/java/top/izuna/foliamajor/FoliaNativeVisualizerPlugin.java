package top.izuna.foliamajor;

import android.app.Activity;
import android.graphics.Color;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

// 当前文件：原生可视化器插件（试验）。
//
// 把 NativeVisualizerView 插到 WebView 的父容器里、排在 WebView 下面，并让 WebView 背景透明，
// 于是页面自己的背景色透出原生绘制的那一层。页面侧由 src/services/nativeVisualizer.ts 控制开与关，
// 音频参数以 20Hz 推过来。任何一步失败都只是「这次不启用」，不影响 WebView 本身。

@CapacitorPlugin(name = "FoliaNativeVisualizer")
public class FoliaNativeVisualizerPlugin extends Plugin {

    private static final int WEBVIEW_BACKGROUND = 0xFF09090B;

    private NativeVisualizerView view;

    @PluginMethod
    public void start(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("no-activity");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                final WebView webView = getBridge().getWebView();
                final ViewGroup parent = webView == null ? null : (ViewGroup) webView.getParent();
                if (parent == null) {
                    call.reject("no-webview-parent");
                    return;
                }
                if (view == null) {
                    view = new NativeVisualizerView(activity.getApplicationContext());
                }
                if (view.getParent() == null) {
                    // 0 = 插到最底层，WebView 画在上面；页面把背景设为透明后就能看见这一层。
                    parent.addView(view, 0, new ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    ));
                }
                webView.setBackgroundColor(Color.TRANSPARENT);
                call.resolve();
            } catch (Throwable error) {
                call.reject("attach-failed: " + error.getClass().getSimpleName());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                final WebView webView = getBridge().getWebView();
                if (view != null && view.getParent() instanceof ViewGroup) {
                    ((ViewGroup) view.getParent()).removeView(view);
                }
                if (webView != null) webView.setBackgroundColor(WEBVIEW_BACKGROUND);
            } catch (Throwable ignored) {
                // 拆卸失败不该让页面留下半截状态：下次 start 会重新挂。
            }
            view = null;
            call.resolve();
        });
    }

    /** JS 每 50ms 推一帧：32 条频谱 + 总能量 + 主题色。 */
    @PluginMethod
    public void push(PluginCall call) {
        final NativeVisualizerView target = view;
        if (target == null) {
            call.resolve();
            return;
        }
        final JSArray bands = call.getArray("bands");
        final float power = readFloat(call, "power");
        final int primary = call.getInt("primary", 0xFF74EFD0);
        final int accent = call.getInt("accent", 0xFFFFFFFF);

        float[] parsed = null;
        if (bands != null) {
            try {
                final JSONArray array = bands.toJSONArray();
                parsed = new float[array.length()];
                for (int i = 0; i < array.length(); i++) {
                    parsed[i] = (float) array.optDouble(i, 0d);
                }
            } catch (Exception ignored) {
                parsed = null;
            }
        }
        target.pushFrame(parsed, power, primary, accent);
        call.resolve();
    }

    private static float readFloat(PluginCall call, String key) {
        final Double value = call.getDouble(key);
        return value == null ? 0f : value.floatValue();
    }
}
