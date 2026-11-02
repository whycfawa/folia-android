package top.izuna.foliamajor;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 分析模型（Beat This! / HTDemucs）在 Android 上的读取与下载桥。
 *
 * 权重不再随 APK 打包：present 说明本地有没有；download 从镜像下载并校验；
 * url 把本地文件经 {@link AnalysisModelServer} 以 127.0.0.1 交给 WebGPU 运行时。
 */
@CapacitorPlugin(name = "FoliaAnalysisModels")
public class FoliaAnalysisModelsPlugin extends Plugin {
    private static final String TAG = "FoliaAnalysisModels";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private AnalysisModelServer server;

    private AnalysisModelServer server() {
        if (server == null) server = new AnalysisModelServer(getContext());
        return server;
    }

    @PluginMethod
    public void present(PluginCall call) {
        JSObject result = new JSObject();
        result.put("beat_this", hasModel("beat_this-wgsl.bin"));
        boolean demucs = hasModel("htdemucs-wgsl.bin");
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
        if (!hasModel(file)) {
            call.reject("model-missing", "Analysis model is not downloaded: " + file);
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

    /** 下载一个模型；进度经 downloadProgress 事件回传（节流到约 1% 一次）。 */
    @PluginMethod
    public void download(PluginCall call) {
        String model = call.getString("model", "");
        if (AnalysisModelDownloader.spec(model) == null) {
            call.reject("Unknown analysis model: " + model);
            return;
        }
        executor.execute(() -> {
            try {
                final long[] lastAt = {0L};
                final int[] lastPercent = {-1};
                File file = AnalysisModelDownloader.download(getContext(), model, (done, total) -> {
                    int percent = total > 0 ? (int) Math.min(100, done * 100 / total) : -1;
                    long now = System.currentTimeMillis();
                    if (percent == lastPercent[0] && now - lastAt[0] < 500) return;
                    if (now - lastAt[0] < 250 && percent < 100) return;
                    lastAt[0] = now;
                    lastPercent[0] = percent;
                    JSObject progress = new JSObject();
                    progress.put("model", model);
                    progress.put("bytes", done);
                    progress.put("total", total);
                    progress.put("percent", percent);
                    notifyListeners("downloadProgress", progress);
                });
                JSObject result = new JSObject();
                result.put("downloaded", true);
                result.put("model", model);
                result.put("bytes", file.length());
                call.resolve(result);
            } catch (Exception error) {
                Log.w(TAG, "download failed: " + model, error);
                call.reject(error.getMessage() == null ? "model download failed" : error.getMessage(), error);
            }
        });
    }

    /** 删除已下载的模型；下次用之前会重新提示下载。 */
    @PluginMethod
    public void delete(PluginCall call) {
        String model = call.getString("model", "");
        String file = fileOf(model);
        if (file == null) {
            call.reject("Unknown analysis model: " + model);
            return;
        }
        File target = AnalysisModelDownloader.target(getContext(), file);
        boolean deleted = target != null && target.isFile() && target.delete();
        JSObject result = new JSObject();
        result.put("deleted", deleted);
        result.put("model", model);
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
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private static String fileOf(String model) {
        if ("beat_this".equals(model)) return "beat_this-wgsl.bin";
        if ("htdemucs".equals(model) || "htdemucs_gpu".equals(model)) return "htdemucs-wgsl.bin";
        return null;
    }

    private boolean hasModel(String file) {
        return AnalysisModelDownloader.installed(getContext(), file) || hasAsset(file);
    }

    private boolean hasAsset(String file) {
        try (InputStream input = getContext().getAssets().open("models/" + file)) {
            return input.read() >= 0;
        } catch (Exception error) {
            return false;
        }
    }
}
