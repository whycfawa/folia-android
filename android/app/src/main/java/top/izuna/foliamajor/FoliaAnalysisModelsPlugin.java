package top.izuna.foliamajor;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;

/**
 * 分析模型（Beat This! / HTDemucs）在 Android 上的读取桥。
 *
 * 桌面版由 Electron 主进程读安装包里的 models/ 并把权重交给渲染层；安卓没有 Electron，
 * 这里把同一份 assets/models 权重经 {@link AnalysisModelServer} 以本地 HTTP 交给 WebGPU 运行时。
 */
@CapacitorPlugin(name = "FoliaAnalysisModels")
public class FoliaAnalysisModelsPlugin extends Plugin {

    private AnalysisModelServer server;

    private AnalysisModelServer server() {
        if (server == null) server = new AnalysisModelServer(getContext());
        return server;
    }

    @PluginMethod
    public void present(PluginCall call) {
        JSObject result = new JSObject();
        result.put("beat_this", hasAsset("beat_this-wgsl.bin"));
        boolean demucs = hasAsset("htdemucs-wgsl.bin");
        result.put("htdemucs", demucs);
        result.put("htdemucs_gpu", demucs);
        call.resolve(result);
    }

    @PluginMethod
    public void url(PluginCall call) {
        String model = call.getString("model", "");
        String file = fileOf(model);
        if (file == null) {
            call.reject("Unknown analysis model: " + model);
            return;
        }
        if (!hasAsset(file)) {
            call.reject("Analysis model is missing from this install: " + file);
            return;
        }
        String url = server().url(file);
        if (url == null || url.isEmpty()) {
            call.reject("Analysis model server could not start");
            return;
        }
        JSObject result = new JSObject();
        result.put("url", url);
        call.resolve(result);
    }

    @PluginMethod
    public void dispose(PluginCall call) {
        if (server != null) server.stop();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        if (server != null) server.stop();
        super.handleOnDestroy();
    }

    private static String fileOf(String model) {
        if ("beat_this".equals(model)) return "beat_this-wgsl.bin";
        if ("htdemucs".equals(model) || "htdemucs_gpu".equals(model)) return "htdemucs-wgsl.bin";
        return null;
    }

    private boolean hasAsset(String file) {
        try (InputStream input = getContext().getAssets().open("models/" + file)) {
            return input.read() >= 0;
        } catch (Exception error) {
            return false;
        }
    }
}
