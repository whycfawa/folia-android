package top.izuna.foliamajor;

import android.app.Activity;
import android.graphics.Color;
import android.view.ViewGroup;
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
    private FoliaNativeStageView stageView;

    @PluginMethod
    public void enable(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("no activity");
            return;
        }
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (root == null) {
            call.reject("no content view");
            return;
        }
        if (stageView == null) {
            stageView = new FoliaNativeStageView(activity);
            root.addView(stageView, 0, new ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));
        }
        stageView.setVisibility(FoliaNativeStageView.VISIBLE);
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) webView.setBackgroundColor(Color.TRANSPARENT);
        JSObject result = new JSObject();
        result.put("enabled", true);
        call.resolve(result);
    }

    @PluginMethod
    public void update(PluginCall call) {
        if (stageView == null) {
            call.resolve();
            return;
        }
        stageView.update(
                call.getString("line", ""),
                call.getString("nextLine", ""),
                call.getString("title", ""),
                call.getString("artist", ""),
                call.getString("accent", ""),
                Boolean.TRUE.equals(call.getBoolean("playing", true)));
        call.resolve();
    }

    @PluginMethod
    public void disable(PluginCall call) {
        removeStage();
        call.resolve();
    }

    private void removeStage() {
        if (stageView == null) return;
        ViewGroup parent = (ViewGroup) stageView.getParent();
        if (parent != null) parent.removeView(stageView);
        stageView = null;
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) webView.setBackgroundColor(Color.BLACK);
    }

    @Override
    protected void handleOnDestroy() {
        removeStage();
        super.handleOnDestroy();
    }
}
