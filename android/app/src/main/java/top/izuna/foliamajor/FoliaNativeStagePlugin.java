package top.izuna.foliamajor;

import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 方案二的实验入口：把原生舞台 View 放到 WebView 后面，WebView 变透明。
 * 关闭时移除 View 并恢复 WebView 背景，原有 WebView 舞台完全不动。
 */
@CapacitorPlugin(name = "FoliaNativeStage")
public class FoliaNativeStagePlugin extends Plugin {
    private static final String PREFS = "folia_native_stage";
    private static final String ACTIVE = "active";
    private FoliaVulkanStageView stageView;
    private FoliaNativeStageControlsView controlsView;
    private boolean guardChecked;
    private boolean unsafe;

    /** 上一次进程没来得及 disable 就死了：清掉残留标记，但不再拒绝本次启用。 */
    private boolean consumeCrashGuard() {
        if (guardChecked) return false;
        guardChecked = true;
        SharedPreferences preferences = getContext().getSharedPreferences(PREFS, 0);
        unsafe = preferences.getBoolean(ACTIVE, false);
        preferences.edit().putBoolean(ACTIVE, false).apply();
        return false;
    }

    @PluginMethod
    public void enable(PluginCall call) {
        if (consumeCrashGuard()) {
            call.reject("native-stage-previous-crash");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        activity.runOnUiThread(() -> {
            ViewGroup root = activity.findViewById(android.R.id.content);
            if (root == null) {
                call.reject("no content view");
                return;
            }
            try {
                if (stageView == null) {
                    stageView = new FoliaVulkanStageView(activity);
                    root.addView(stageView, 0, new ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT));
                }
                stageView.setVisibility(FoliaVulkanStageView.VISIBLE);
                // 原生控制条暂不启用：保留 WebView 原有控制条，避免样式和交互被替换。
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView != null) webView.setBackgroundColor(Color.TRANSPARENT);
                getContext().getSharedPreferences(PREFS, 0).edit().putBoolean(ACTIVE, true).apply();
                JSObject result = new JSObject();
                result.put("enabled", true);
                call.resolve(result);
            } catch (Throwable error) {
                removeStage();
                call.reject("native-stage-enable-failed: " + error);
            }
        });
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (stageView == null) {
            call.resolve();
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                boolean daylight = Boolean.TRUE.equals(call.getBoolean("daylight", false));
                if (controlsView != null) {
                    controlsView.setPlaying(Boolean.TRUE.equals(call.getBoolean("playing", true)));
                    controlsView.setDaylight(daylight);
                }
                stageView.setDaylight(daylight);
                try {
                    String accent = call.getString("accent", "");
                    if (controlsView != null && accent != null && !accent.isEmpty()) controlsView.setAccent(Color.parseColor(accent));
                } catch (IllegalArgumentException ignored) {
                }
                stageView.setThemeColors(
                        call.getString("primary", "#FFFFFF"),
                        call.getString("secondary", "#7C9BFF"),
                        call.getString("background", "#07070B"));
                stageView.update(
                        call.getString("mode", "classic"),
                        call.getString("line", ""),
                        call.getString("nextLine", ""),
                        call.getString("prevLine", ""),
                        call.getString("lineTranslation", ""),
                        call.getString("prevTranslation", ""),
                        call.getString("nextTranslation", ""),
                        call.getString("title", ""),
                        call.getString("artist", ""),
                        call.getString("accent", ""),
                        Boolean.TRUE.equals(call.getBoolean("playing", true)),
                        Boolean.TRUE.equals(call.getBoolean("chorus", false)));
                call.resolve();
            } catch (Throwable error) {
                call.reject("native-stage-update-failed: " + error);
            }
        });
    }

    @PluginMethod
    public void updateAudio(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || stageView == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                stageView.updateAudio(
                        floatValue(call, "power"),
                        floatValue(call, "bass"),
                        floatValue(call, "mid"),
                        floatValue(call, "treble"));
                call.resolve();
            } catch (Throwable error) {
                call.reject("native-stage-audio-failed: " + error);
            }
        });
    }

    @PluginMethod
    public void stats(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", stageView != null);
        result.put("renderer", "vulkan");
        result.put("vulkan", stageView != null && stageView.isVulkanReady());
        result.put("canvasMs", stageView == null ? 0 : stageView.getCanvasFrameMs());
        result.put("frames", stageView == null ? 0 : stageView.getFrameCount());
        result.put("surface", stageView != null && stageView.isSurfaceReady());
        result.put("vulkanError", stageView == null ? "" : stageView.getVulkanError());
        result.put("pipeline", stageView != null && stageView.hasVulkanPipeline());
        result.put("playing", stageView != null && stageView.isPlaying());
        call.resolve(result);
    }

    @PluginMethod
    public void updateWords(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || stageView == null) {
            call.resolve();
            return;
        }
        String words = call.getString("words", "[]");
        double position = call.getDouble("position", 0.0);
        activity.runOnUiThread(() -> {
            if (stageView != null) stageView.updateWords(words, (float) position);
            call.resolve();
        });
    }

    @PluginMethod
    public void updateProgress(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null || controlsView == null) {
            call.resolve();
            return;
        }
        double position = call.getDouble("position", 0.0);
        double duration = call.getDouble("duration", 0.0);
        double lineProgress = call.getDouble("lineProgress", 0.0);
        float progress = duration > 0 ? (float) (position / duration) : 0f;
        activity.runOnUiThread(() -> {
            if (controlsView != null) controlsView.setProgress(progress);
            if (stageView != null) stageView.setLineProgress((float) lineProgress);
            call.resolve();
        });
    }

    @PluginMethod
    public void disable(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            removeStage();
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            removeStage();
            call.resolve();
        });
    }

    private void emitControl(String action, double value) {
        JSObject payload = new JSObject();
        payload.put("action", action);
        payload.put("value", value);
        notifyListeners("control", payload);
    }

    private float dp(float value) {
        return value * getContext().getResources().getDisplayMetrics().density;
    }

    private static float floatValue(PluginCall call, String key) {
        Double value = call.getDouble(key, 0.0);
        return value == null ? 0f : value.floatValue();
    }

    private void removeStage() {
        if (stageView == null) return;
        ViewGroup parent = (ViewGroup) stageView.getParent();
        if (parent != null) parent.removeView(stageView);
        stageView = null;
        if (controlsView != null) {
            ViewGroup controlsParent = (ViewGroup) controlsView.getParent();
            if (controlsParent != null) controlsParent.removeView(controlsView);
            controlsView = null;
        }
        getContext().getSharedPreferences(PREFS, 0).edit().putBoolean(ACTIVE, false).apply();
        try {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView != null) webView.setBackgroundColor(Color.BLACK);
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void handleOnDestroy() {
        removeStage();
        super.handleOnDestroy();
    }
}
