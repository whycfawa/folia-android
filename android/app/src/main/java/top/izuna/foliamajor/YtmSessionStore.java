package top.izuna.foliamajor;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Log;
import android.util.AtomicFile;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * YouTube Music 会话的落盘：cookie 与登录用的 UA，用 Android Keystore 里这一应用专属的 AES-GCM
 * 密钥加密后写进一个文件（NoBackupFilesDir，不进云端备份）。只在登录账号对过话之后由 JS 侧
 * 调 saveSession 写入；登出 clearSession 抹掉文件。
 *
 * 密钥长在系统 Keystore 里（setUserAuthenticationRequired 不设——会话在锁屏下也要能用），
 * 出不了这一应用。密文坏了（换了应用数据、Keystore 被重置、文件被改）解不开就整个丢掉记一行：
 * 情愿让用户再登一次，也不把半个会话交回去。
 *
 * 明文只在加密/解密的那一刻存在于内存；文件里除了密文没有别的。日志里没有 cookie 与 UA 的值。
 */
final class YtmSessionStore {
    private static final String TAG = "FoliaYtmStore";
    private static final String KEY_ALIAS = "folia_ytm_session";
    /** 密文文件的格式：1 字节版本号 + 12 字节 IV + AES/GCM 密文（tag 并在最后 16 字节）。 */
    private static final byte FORMAT_VERSION = 1;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;
    /** cookie 一份 8KB 顶天（JS 侧同一上限），超长的一律不存。 */
    private static final int COOKIE_LIMIT = 8192;
    private static final int UA_LIMIT = 256;

    /** 存着的会话：两个都有才算数。 */
    static final class YtmSession {
        final String cookie;
        final String userAgent;

        YtmSession(String cookie, String userAgent) {
            this.cookie = cookie;
            this.userAgent = userAgent;
        }
    }

    private YtmSessionStore() { }

    private static File file(Context context) {
        return new File(context.getNoBackupFilesDir(), "folia_ytm_session.bin");
    }

    /** Keystore 里那一把应用的密钥；还没有就现造一把（AES-256、GCM、只在这一应用内）。 */
    private static SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        KeyStore.Entry entry = store.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        if (!create) throw new IllegalStateException("Session key is missing");
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build();
        KeyGenerator generator = KeyGenerator.getInstance("AES", "AndroidKeyStore");
        generator.init(spec);
        return generator.generateKey();
    }

    /** 读回存着的会话；没有存、或密文解不开（密钥换了、文件坏了），都答 null。 */
    static synchronized YtmSession read(Context context) {
        File file = file(context);
        byte[] sealed;
        try {
            sealed = readFile(file);
        } catch (Exception error) {
            return null; // 还没有存过
        }
        if (sealed.length < 1 + IV_BYTES + TAG_BITS / 8 || sealed[0] != FORMAT_VERSION) {
            Log.w(TAG, "the stored YouTube Music session is truncated; it is discarded");
            clear(context);
            return null;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(TAG_BITS, sealed, 1, IV_BYTES));
            byte[] plain = cipher.doFinal(sealed, 1 + IV_BYTES, sealed.length - 1 - IV_BYTES);
            return decode(plain);
        } catch (Exception error) {
            // 密钥对不上（这台设备重置过 Keystore）或密文被改：整个丢掉，让用户再登一次。
            Log.w(TAG, "the stored YouTube Music session could not be opened; it is discarded");
            clear(context);
            return null;
        }
    }

    /** 会话存下去；cookie 与 UA 都得有、都不超长，写完整个文件才算。 */
    static synchronized boolean write(Context context, String cookie, String userAgent) {
        if (!validHeader(cookie, COOKIE_LIMIT) || !validHeader(userAgent, UA_LIMIT)) {
            return false;
        }
        try {
            byte[] plain = encode(cookie, userAgent);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            // Android Keystore requires provider-generated IVs when randomized encryption is required.
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
            byte[] iv = cipher.getIV();
            if (iv == null || iv.length != IV_BYTES) return false;
            byte[] sealed = cipher.doFinal(plain);
            AtomicFile target = new AtomicFile(file(context));
            FileOutputStream out = target.startWrite();
            try {
                out.write(FORMAT_VERSION);
                out.write(iv);
                out.write(sealed);
                target.finishWrite(out);
            } catch (Exception error) {
                target.failWrite(out);
                throw error;
            }
            return true;
        } catch (Exception error) {
            Log.w(TAG, "the YouTube Music session could not be stored; sign-in must not be committed", error);
            return false;
        }
    }

    /** 抹掉存着的会话文件；文件不在了也是「抹掉了」。 */
    static synchronized boolean clear(Context context) {
        File file = file(context);
        boolean keyGone = false;
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            store.deleteEntry(KEY_ALIAS);
            keyGone = !store.containsAlias(KEY_ALIAS);
        } catch (Exception error) {
            Log.w(TAG, "the YouTube Music session key could not be removed");
        }
        new AtomicFile(file).delete();
        boolean gone = !file.exists();
        if (!gone) Log.w(TAG, "the stored YouTube Music session file could not be removed");
        return gone && keyGone;
    }

    // ---- 明文的打包（JSON：cookie、userAgent、存入时间）。只在这两个方法之间来去。 ----

    private static byte[] encode(String cookie, String userAgent) throws Exception {
        JSONObject object = new JSONObject();
        object.put("driver", FORMAT_VERSION);
        object.put("cookie", cookie);
        object.put("userAgent", userAgent);
        object.put("storedAt", System.currentTimeMillis());
        return object.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static YtmSession decode(byte[] plain) throws Exception {
        JSONObject object = new JSONObject(new String(plain, StandardCharsets.UTF_8));
        String cookie = object.optString("cookie", "");
        if (object.optInt("driver", 0) != FORMAT_VERSION || !validHeader(cookie, COOKIE_LIMIT)) return null;
        String userAgent = object.optString("userAgent", "");
        if (!validHeader(userAgent, UA_LIMIT)) return null;
        return new YtmSession(cookie, userAgent);
    }

    private static boolean validHeader(String value, int limit) {
        if (value == null || value.isEmpty() || value.length() > limit) return false;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c < 32 || c > 126) return false;
        }
        return true;
    }

    private static byte[] readFile(File file) throws Exception {
        try (FileInputStream reader = new AtomicFile(file).openRead()) {
            long length = reader.getChannel().size();
            if (length < 1 || length > 65536) throw new java.io.IOException("Invalid session file size");
            byte[] data = new byte[(int) length];
            int offset = 0;
            while (offset < data.length) {
                int count = reader.read(data, offset, data.length - offset);
                if (count < 0) throw new java.io.IOException("Truncated session");
                offset += count;
            }
            return data;
        }
    }
}
