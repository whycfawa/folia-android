package top.izuna.foliamajor;

import android.content.Context;
import android.net.Uri;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.Locale;

/**
 * 本地导入分析模型：用户在系统文件选择器里选 .bin，这里边复制边算 SHA-256，
 * 只有字节数和摘要都对上某个模型的清单才落盘；否则拒绝，不覆盖已有模型。
 */
final class AnalysisModelImporter {

    private AnalysisModelImporter() {
    }

    /** 返回导入的模型名（beat_this / htdemucs），不是 Folia 的模型时抛 IOException。 */
    static String importUri(Context context, Uri uri) throws IOException {
        if (uri == null) throw new IOException("No file was selected");
        File temporary = new File(context.getCacheDir(), "analysis-model-import-" + System.nanoTime() + ".bin");
        long bytes = 0;
        String sha256;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = context.getContentResolver().openInputStream(uri);
                 OutputStream output = new FileOutputStream(temporary)) {
                if (input == null) throw new IOException("The selected file cannot be read");
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) > 0) {
                    output.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                    bytes += read;
                }
            }
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format(Locale.US, "%02x", value));
            sha256 = hex.toString();
        } catch (java.security.NoSuchAlgorithmException error) {
            //noinspection ResultOfMethodCallIgnored
            temporary.delete();
            throw new IOException("SHA-256 is unavailable", error);
        } catch (IOException error) {
            //noinspection ResultOfMethodCallIgnored
            temporary.delete();
            throw error;
        }

        AnalysisModelDownloader.Spec match = null;
        for (String model : new String[]{"beat_this", "htdemucs"}) {
            AnalysisModelDownloader.Spec spec = AnalysisModelDownloader.spec(model);
            if (spec != null && spec.bytes == bytes && spec.sha256.equalsIgnoreCase(sha256)) {
                match = spec;
                break;
            }
        }
        if (match == null) {
            //noinspection ResultOfMethodCallIgnored
            temporary.delete();
            throw new IOException("Not a Folia analysis model (size or SHA-256 does not match)");
        }

        File target = AnalysisModelDownloader.target(context, match.file);
        if (target == null) {
            //noinspection ResultOfMethodCallIgnored
            temporary.delete();
            throw new IOException("The app's model directory is unavailable");
        }
        //noinspection ResultOfMethodCallIgnored
        target.delete();
        if (!temporary.renameTo(target)) {
            // renameTo can fail across filesystems; fall back to a copy.
            try (InputStream input = new FileInputStream(temporary);
                 OutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) > 0) output.write(buffer, 0, read);
            }
            //noinspection ResultOfMethodCallIgnored
            temporary.delete();
        }
        return match.model;
    }
}
