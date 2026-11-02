package top.izuna.foliamajor;

import android.content.Context;
import android.net.Uri;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 本地导入分析模型：支持单个 .bin，也支持一个包含两个 .bin 的 .zip。
 * 每个条目边复制边算 SHA-256，只有字节数和摘要都对上清单才落盘；坏条目跳过，不覆盖已有模型。
 */
final class AnalysisModelImporter {

    private AnalysisModelImporter() {
    }

    /** 返回导入的模型名（beat_this / htdemucs）；一个都没匹配上时抛 IOException。 */
    static List<String> importUri(Context context, Uri uri) throws IOException {
        if (uri == null) throw new IOException("No file was selected");
        try (InputStream raw = context.getContentResolver().openInputStream(uri)) {
            if (raw == null) throw new IOException("The selected file cannot be read");
            BufferedInputStream input = new BufferedInputStream(raw);
            input.mark(4);
            int first = input.read();
            int second = input.read();
            int third = input.read();
            int fourth = input.read();
            input.reset();
            boolean zip = first == 'P' && second == 'K' && third == 3 && fourth == 4;
            if (zip) return importZip(context, input);
            String model = importStream(context, input);
            if (model == null) throw new IOException("Not a Folia analysis model (size or SHA-256 does not match)");
            List<String> imported = new ArrayList<>();
            imported.add(model);
            return imported;
        }
    }

    private static List<String> importZip(Context context, InputStream input) throws IOException {
        List<String> imported = new ArrayList<>();
        try (ZipInputStream zip = new ZipInputStream(input, StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                String model = importStream(context, zip);
                if (model != null && !imported.contains(model)) imported.add(model);
                zip.closeEntry();
            }
        }
        if (imported.isEmpty()) {
            throw new IOException("The zip contains no Folia analysis model");
        }
        return imported;
    }

    /** 读完一个条目到临时文件并校验；匹配返回模型名，否则 null。不关闭 input（zip 还要读下一条）。 */
    private static String importStream(Context context, InputStream input) throws IOException {
        File temporary = new File(context.getCacheDir(), "analysis-model-import-" + System.nanoTime() + ".bin");
        long bytes = 0;
        String sha256;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (OutputStream output = new FileOutputStream(temporary)) {
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
            return null;
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
            try (InputStream from = new FileInputStream(temporary);
                 OutputStream to = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = from.read(buffer)) > 0) to.write(buffer, 0, read);
            }
            //noinspection ResultOfMethodCallIgnored
            temporary.delete();
        }
        return match.model;
    }
}
