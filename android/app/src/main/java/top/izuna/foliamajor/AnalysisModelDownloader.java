package top.izuna.foliamajor;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * Beat This! / HTDemucs 权重的按需下载。
 *
 * 权重不再随 APK 打包：第一次用智能动感、鼓点或分轨时，从公开镜像下载到 App 私有目录。
 * 镜像按国内可达性排序，GitHub 放最后；每个镜像下载完都校验字节数与 SHA-256，
 * 校验不过就换下一个，不会把半份或错文件留给运行时。
 */
final class AnalysisModelDownloader {
    private static final String TAG = "AnalysisModelDownloader";

    static final class Spec {
        final String model;
        final String file;
        final long bytes;
        final String sha256;
        final String[] mirrors;

        Spec(String model, String file, long bytes, String sha256, String... mirrors) {
            this.model = model;
            this.file = file;
            this.bytes = bytes;
            this.sha256 = sha256;
            this.mirrors = mirrors;
        }
    }

    interface Progress {
        void onProgress(long done, long total);
    }

    private static final Spec BEAT_THIS = new Spec(
            "beat_this",
            "beat_this-wgsl.bin",
            41_102_271L,
            "6365ae5ba2e42922772da01fbfd0bde8dd20b7362a679018e78a5f251fe8a967",
            "https://ghproxy.net/https://github.com/chthollyphile/folia-major/releases/download/models-v1/beat_this-wgsl.bin",
            "https://gh-proxy.com/https://github.com/chthollyphile/folia-major/releases/download/models-v1/beat_this-wgsl.bin",
            "https://github.com/chthollyphile/folia-major/releases/download/models-v1/beat_this-wgsl.bin"
    );

    private static final Spec HTDEMUCS = new Spec(
            "htdemucs",
            "htdemucs-wgsl.bin",
            91_838_176L,
            "27d5331a74a4e23b18172b3d59d0378e698fd79bc0d0fed3316da77e3a37d8d1",
            "https://ghproxy.net/https://github.com/chthollyphile/folia-major/releases/download/models-v1/htdemucs-wgsl.bin",
            "https://gh-proxy.com/https://github.com/chthollyphile/folia-major/releases/download/models-v1/htdemucs-wgsl.bin",
            "https://github.com/chthollyphile/folia-major/releases/download/models-v1/htdemucs-wgsl.bin"
    );

    private static final OkHttpClient CLIENT = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build();

    private AnalysisModelDownloader() {
    }

    static Spec spec(String model) {
        if ("beat_this".equals(model)) return BEAT_THIS;
        if ("htdemucs".equals(model) || "htdemucs_gpu".equals(model)) return HTDEMUCS;
        return null;
    }

    static File target(Context context, String file) {
        File dir = new File(context.getFilesDir(), "models");
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) return null;
        return new File(dir, file);
    }

    static boolean installed(Context context, String file) {
        File target = target(context, file);
        return target != null && target.isFile() && target.length() > 0;
    }

    /** 下载一个模型；成功返回落盘文件，失败抛 IOException（调用方把原因带回界面）。 */
    static File download(Context context, String model, Progress progress) throws IOException {
        return download(context, model, progress, false);
    }

    /** force：忽略已存在的文件重新下载（重试损坏的模型）。 */
    static File download(Context context, String model, Progress progress, boolean force) throws IOException {
        Spec spec = spec(model);
        if (spec == null) throw new IOException("Unknown analysis model: " + model);
        File target = target(context, spec.file);
        if (target == null) throw new IOException("The app's model directory is unavailable");
        if (force) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
        } else if (installed(context, spec.file)) {
            return target;
        }

        File partial = new File(target.getParentFile(), spec.file + ".part");
        IOException last = null;
        for (String mirror : spec.mirrors) {
            try {
                downloadOne(spec, mirror, partial, progress);
                if (partial.length() != spec.bytes) {
                    throw new IOException(String.format(Locale.US,
                            "wrong size: %d, wanted %d", partial.length(), spec.bytes));
                }
                if (!sha256(partial).equalsIgnoreCase(spec.sha256)) {
                    throw new IOException("SHA-256 mismatch");
                }
                if (!partial.renameTo(target)) {
                    //noinspection ResultOfMethodCallIgnored
                    target.delete();
                    if (!partial.renameTo(target)) throw new IOException("could not move the model into place");
                }
                Log.i(TAG, "downloaded " + spec.file + " from " + mirror);
                return target;
            } catch (Exception error) {
                last = error instanceof IOException ? (IOException) error : new IOException(error);
                Log.w(TAG, "mirror failed: " + mirror, error);
                //noinspection ResultOfMethodCallIgnored
                partial.delete();
            }
        }
        throw last != null ? last : new IOException("No mirror could provide " + spec.file);
    }

    private static void downloadOne(Spec spec, String url, File output, Progress progress) throws IOException {
        Request request = new Request.Builder().url(url).header("User-Agent", "Folia-Android").build();
        try (Response response = CLIENT.newCall(request).execute()) {
            if (!response.isSuccessful()) throw new IOException("HTTP " + response.code());
            ResponseBody body = response.body();
            if (body == null) throw new IOException("empty response");
            long total = body.contentLength() > 0 ? body.contentLength() : spec.bytes;
            try (InputStream input = body.byteStream();
                 FileOutputStream stream = new FileOutputStream(output)) {
                byte[] buffer = new byte[64 * 1024];
                long done = 0;
                int read;
                while ((read = input.read(buffer)) > 0) {
                    stream.write(buffer, 0, read);
                    done += read;
                    if (progress != null) progress.onProgress(done, total);
                }
            }
        }
    }

    /** 已下载文件是否与清单里的字节数和 SHA-256 一致；不存在或损坏都返回 false。 */
    static boolean verify(Context context, String model) throws IOException {
        Spec spec = spec(model);
        if (spec == null) return false;
        File target = target(context, spec.file);
        if (target == null || !target.isFile()) return false;
        return target.length() == spec.bytes && sha256(target).equalsIgnoreCase(spec.sha256);
    }

    static String sha256(File file) throws IOException {
        try (InputStream input = new java.io.FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) digest.update(buffer, 0, read);
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format(Locale.US, "%02x", value));
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException error) {
            throw new IOException("SHA-256 is unavailable", error);
        }
    }
}
