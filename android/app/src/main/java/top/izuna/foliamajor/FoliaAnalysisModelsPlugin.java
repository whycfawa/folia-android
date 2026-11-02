package top.izuna.foliamajor;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
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

    private static final class DownloadState {
        volatile long bytes;
        volatile long total;
        volatile int percent;
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Set<String> downloading = ConcurrentHashMap.newKeySet();
    private final Map<String, DownloadState> states = new ConcurrentHashMap<>();
    private boolean importOpen;
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

    /** 打开系统文件选择器，导入一个或两个模型 .bin；由 handleImportedModels 收结果。 */
    @PluginMethod
    public void importModels(PluginCall call) {
        if (importOpen) {
            call.reject("A model import is already open");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("*/*")
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        importOpen = true;
        startActivityForResult(call, intent, "handleImportedModels");
    }

    @ActivityCallback
    private void handleImportedModels(PluginCall call, ActivityResult result) {
        importOpen = false;
        if (call == null) return;
        int resultCode = result == null ? Activity.RESULT_CANCELED : result.getResultCode();
        List<Uri> uris = new ArrayList<>();
        Intent data = result == null ? null : result.getData();
        if (data != null) {
            ClipData clipData = data.getClipData();
            if (clipData != null) {
                for (int index = 0; index < clipData.getItemCount(); index += 1) {
                    Uri uri = clipData.getItemAt(index).getUri();
                    if (uri != null) uris.add(uri);
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        if (resultCode != Activity.RESULT_OK || uris.isEmpty()) {
            JSObject canceled = new JSObject();
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }
        executor.execute(() -> {
            JSArray imported = new JSArray();
            JSArray failed = new JSArray();
            for (Uri uri : uris) {
                try {
                    for (String model : AnalysisModelImporter.importUri(getContext(), uri)) {
                        imported.put(model);
                    }
                } catch (Exception error) {
                    Log.w(TAG, "model import failed: " + uri, error);
                    failed.put(error.getMessage() == null ? "import failed" : error.getMessage());
                }
            }
            JSObject answer = new JSObject();
            answer.put("imported", imported);
            answer.put("failed", failed);
            call.resolve(answer);
        });
    }

    /** 检测已下载文件的字节数与 SHA-256，不改动文件。 */
    @PluginMethod
    public void verify(PluginCall call) {
        String model = call.getString("model", "");
        if (AnalysisModelDownloader.spec(model) == null) {
            call.reject("Unknown analysis model: " + model);
            return;
        }
        executor.execute(() -> {
            try {
                String file = fileOf(model);
                File target = AnalysisModelDownloader.target(getContext(), file);
                boolean installed = target != null && target.isFile();
                boolean valid = AnalysisModelDownloader.verify(getContext(), model);
                JSObject result = new JSObject();
                result.put("installed", installed);
                result.put("valid", valid);
                result.put("bytes", target != null && target.isFile() ? target.length() : 0);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "model check failed" : error.getMessage(), error);
            }
        });
    }

    /** 当前下载状态；页面切走再回来时用它恢复进度，而不是误显示“重新下载”。 */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        for (String model : new String[]{"beat_this", "htdemucs"}) {
            DownloadState state = states.get(model);
            JSObject item = new JSObject();
            item.put("downloading", state != null);
            item.put("bytes", state == null ? 0 : state.bytes);
            item.put("total", state == null ? 0 : state.total);
            item.put("percent", state == null ? 0 : state.percent);
            result.put(model, item);
        }
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
        if (!downloading.add(model)) {
            call.reject("download-in-progress", "This model is already downloading");
            return;
        }
        final boolean force = Boolean.TRUE.equals(call.getBoolean("force", false));
        final DownloadState state = new DownloadState();
        states.put(model, state);
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
                    state.bytes = done;
                    state.total = total;
                    state.percent = percent;
                    JSObject progress = new JSObject();
                    progress.put("model", model);
                    progress.put("bytes", done);
                    progress.put("total", total);
                    progress.put("percent", percent);
                    notifyListeners("downloadProgress", progress);
                }, force);
                JSObject result = new JSObject();
                result.put("downloaded", true);
                result.put("model", model);
                result.put("bytes", file.length());
                call.resolve(result);
            } catch (Exception error) {
                Log.w(TAG, "download failed: " + model, error);
                call.reject(error.getMessage() == null ? "model download failed" : error.getMessage(), error);
            } finally {
                downloading.remove(model);
                states.remove(model);
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
