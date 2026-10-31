package top.izuna.foliamajor;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 汽水加密音频的解密器 —— electron/qishui/qishui-audio-decryptor/ 的 Java 移植。
 *
 * 上游是三份纯 JS：decrypt-utils.js（spade_a 密钥还原 + AES-128-CTR + mp4 表解析）、
 * mp4-box.js（box 扫描）、track-decryptor.js（编排）。这里只移植 decrypt 实际用到的
 * 部分；逐样本偏移、enca→mp4a、flac 剥壳等逻辑与上游一致，方便日后对表同步。
 *
 * spade_a 的两种形态上游都认：纯 hex 直接当密钥；base64 走 decryptSpade 还原。
 */
final class QishuiAudioDecryptor {

    private QishuiAudioDecryptor() {
    }

    /** 与上游 TrackDecryptor.decrypt 同形的返回：解密后的整曲与格式信息。 */
    static final class Result {
        final byte[] buffer;
        final boolean flac;
        final int sampleCount;
        final String offsetSource;

        Result(byte[] buffer, boolean flac, int sampleCount, String offsetSource) {
            this.buffer = buffer;
            this.flac = flac;
            this.sampleCount = sampleCount;
            this.offsetSource = offsetSource;
        }
    }

    static byte[] resolveKey(String spadeA) throws Exception {
        if (spadeA == null || spadeA.isEmpty()) {
            throw new IllegalArgumentException("spade_a is required for decryption.");
        }
        String keyHex = spadeA.matches("^[0-9a-fA-F]+$") ? spadeA : decryptSpadeA(spadeA);
        if (keyHex == null || keyHex.isEmpty()) {
            throw new IllegalStateException("Failed to resolve decryption key from spade_a.");
        }
        return hexToBytes(keyHex);
    }

    // ─── spade_a → 密钥 ──────────────────────────────────────────────────

    private static int bitCount(int value) {
        int current = value;
        current = current - ((current >> 1) & 0x55555555);
        current = (current & 0x33333333) + ((current >> 2) & 0x33333333);
        return (((current + (current >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
    }

    private static int decodeBase36(int charCode) {
        if (charCode >= 48 && charCode <= 57) return charCode - 48;
        if (charCode >= 97 && charCode <= 122) return charCode - 97 + 10;
        return 0xff;
    }

    private static byte[] decryptSpadeInner(byte[] spadeKey) {
        byte[] result = new byte[spadeKey.length];
        byte[] working = new byte[spadeKey.length + 2];
        working[0] = (byte) 0xfa;
        working[1] = (byte) 0x55;
        System.arraycopy(spadeKey, 0, working, 2, spadeKey.length);

        for (int index = 0; index < result.length; index++) {
            // 与上游一致的 Java 语义：JS 的 ^ 与 - 都在 32 位有符号数上跑，
            // 但字节值 <= 0xff、working[index] <= 0xff，这里按无符号解读即可。
            int value = ((spadeKey[index] & 0xff) ^ (working[index] & 0xff)) - bitCount(index) - 21;
            while (value < 0) {
                value += 0xff;
            }
            result[index] = (byte) (value & 0xff);
        }
        return result;
    }

    private static String decryptSpade(byte[] spadeKeyBytes) {
        if (spadeKeyBytes == null || spadeKeyBytes.length < 3) return "";
        int paddingLength = (spadeKeyBytes[0] ^ spadeKeyBytes[1] ^ spadeKeyBytes[2]) - 48;
        // JS 里三个字节异或可能为负（有符号 byte）；paddingLength 用前先归一。
        int padding = paddingLength < 0 ? paddingLength + 256 : paddingLength;
        if (spadeKeyBytes.length < padding + 2) return "";

        byte[] innerInput = Arrays.copyOfRange(spadeKeyBytes, 1, spadeKeyBytes.length - padding);
        byte[] tempBuffer = decryptSpadeInner(innerInput);
        if (tempBuffer.length == 0) return "";

        int skipBytes = decodeBase36(tempBuffer[0] & 0xff);
        int decodedMessageLength = spadeKeyBytes.length - padding - 2;
        int endIndex = 1 + decodedMessageLength - skipBytes;
        if (endIndex > tempBuffer.length || endIndex < 1) return "";
        return new String(tempBuffer, 1, endIndex - 1, StandardCharsets.UTF_8);
    }

    private static String decryptSpadeA(String spadeA) {
        try {
            return decryptSpade(Base64.getDecoder().decode(spadeA));
        } catch (IllegalArgumentException error) {
            return "";
        }
    }

    private static byte[] hexToBytes(String hex) {
        if (hex == null || hex.length() % 2 != 0) {
            throw new IllegalArgumentException("Hex string length must be even.");
        }
        byte[] out = new byte[hex.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static byte[] aesCtrDecrypt(byte[] key, byte[] iv, byte[] encrypted) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/CTR/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        return cipher.doFinal(encrypted);
    }

    // ─── mp4 box ──────────────────────────────────────────────────────────

    private static final class Box {
        final long size;
        final String type;
        final int offset;
        final int end;

        Box(long size, String type, int offset, int end) {
            this.size = size;
            this.type = type;
            this.offset = offset;
            this.end = end;
        }

        boolean isEmpty() {
            return size == 0;
        }

        int contentStart() {
            return offset + 8;
        }
    }

    private static Box emptyBox() {
        return new Box(0, "", 0, 0);
    }

    private static int uint32be(byte[] data, int offset) {
        return ((data[offset] & 0xff) << 24) | ((data[offset + 1] & 0xff) << 16)
                | ((data[offset + 2] & 0xff) << 8) | (data[offset + 3] & 0xff);
    }

    private static String boxType(byte[] data, int offset) {
        return new String(data, offset + 4, 4, StandardCharsets.US_ASCII);
    }

    private static Box findBox(byte[] buffer, String type, int start, int end) {
        int position = start;
        while (position < end) {
            if (position + 8 > end) break;
            long size = uint32be(buffer, position) & 0xffffffffL;
            if (size < 8 || position + size > end) break;
            if (boxType(buffer, position).equals(type)) {
                int boxEnd = position + (int) size;
                return new Box(size, type, position, boxEnd);
            }
            position += (int) size;
        }
        return emptyBox();
    }

    // ─── stbl 表解析 ──────────────────────────────────────────────────────

    private static long[] parseStsz(byte[] data) {
        long sampleSize = uint32be(data, 4) & 0xffffffffL;
        long count = uint32be(data, 8) & 0xffffffffL;
        long[] sizes = new long[(int) count];
        if (sampleSize != 0) {
            Arrays.fill(sizes, sampleSize);
            return sizes;
        }
        for (int index = 0; index < count; index++) {
            sizes[index] = uint32be(data, 12 + index * 4) & 0xffffffffL;
        }
        return sizes;
    }

    private static final class StscEntry {
        final long firstChunk;
        final long samplesPerChunk;

        StscEntry(long firstChunk, long samplesPerChunk) {
            this.firstChunk = firstChunk;
            this.samplesPerChunk = samplesPerChunk;
        }
    }

    private static List<StscEntry> parseStsc(byte[] data) {
        int entryCount = uint32be(data, 4);
        List<StscEntry> entries = new ArrayList<>(entryCount);
        for (int index = 0; index < entryCount; index++) {
            int base = 8 + index * 12;
            entries.add(new StscEntry(uint32be(data, base) & 0xffffffffL, uint32be(data, base + 4) & 0xffffffffL));
        }
        return entries;
    }

    private static long[] parseStco(byte[] data) {
        int entryCount = uint32be(data, 4);
        long[] offsets = new long[entryCount];
        for (int index = 0; index < entryCount; index++) {
            offsets[index] = uint32be(data, 8 + index * 4) & 0xffffffffL;
        }
        return offsets;
    }

    private static long[] parseCo64(byte[] data) {
        int entryCount = uint32be(data, 4);
        long[] offsets = new long[entryCount];
        ByteBuffer wrap = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN);
        for (int index = 0; index < entryCount; index++) {
            offsets[index] = wrap.getLong(8 + index * 8);
        }
        return offsets;
    }

    /** 按 ISO/IEC 14496-12 的 stsc + stco + stsz 展开每个样本的真实文件偏移。 */
    private static long[] computeSampleOffsets(long[] sampleSizes, List<StscEntry> stscEntries, long[] chunkOffsets) {
        if (sampleSizes == null || sampleSizes.length == 0) return new long[0];
        if (chunkOffsets == null || chunkOffsets.length == 0) return new long[0];

        int total = sampleSizes.length;
        List<StscEntry> entries = stscEntries != null && !stscEntries.isEmpty()
                ? new ArrayList<>(stscEntries) : new ArrayList<>();
        entries.sort((left, right) -> Long.compare(left.firstChunk, right.firstChunk));

        long[] offsets = new long[total];
        int sampleIndex = 0;

        for (int chunkIndex = 0; chunkIndex < chunkOffsets.length && sampleIndex < total; chunkIndex++) {
            long samplesPerChunk = !entries.isEmpty() ? entries.get(0).samplesPerChunk : 0;
            for (StscEntry entry : entries) {
                if (entry.firstChunk <= chunkIndex + 1) samplesPerChunk = entry.samplesPerChunk;
            }
            if (samplesPerChunk <= 0) return new long[0];

            long offset = chunkOffsets[chunkIndex];
            for (int index = 0; index < samplesPerChunk && sampleIndex < total; index++) {
                offsets[sampleIndex] = offset;
                offset += sampleSizes[sampleIndex];
                sampleIndex++;
            }
        }
        return offsets.length == total ? offsets : new long[0];
    }

    /** senc：version/flags 后 count 个 8 字节 IV（高 8 字节，低 8 字节补零）。 */
    private static byte[][] parseSenc(byte[] data) {
        int count = uint32be(data, 4);
        byte[][] ivs = new byte[count][];
        int position = 8;
        for (int index = 0; index < count; index++) {
            byte[] iv = new byte[16];
            System.arraycopy(data, position, iv, 0, 8);
            ivs[index] = iv;
            position += 8;
        }
        return ivs;
    }

    private static final byte[] FLAC_MARKER = {0x64, 0x66, 0x4c, 0x61}; // 'dfLa'

    private static byte[] scanForFlacMetadata(byte[] stsdData) {
        int index = indexOf(stsdData, FLAC_MARKER, 0);
        if (index < 4) return new byte[0];
        int boxSize = uint32be(stsdData, index - 4);
        int contentStart = index + 4;
        int contentEnd = (int) Math.min((long) index - 4 + boxSize, stsdData.length);
        if (contentEnd <= contentStart) return new byte[0];
        return Arrays.copyOfRange(stsdData, contentStart, contentEnd);
    }

    private static int indexOf(byte[] haystack, byte[] needle, int from) {
        outer:
        for (int i = Math.max(from, 0); i + needle.length <= haystack.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) continue outer;
            }
            return i;
        }
        return -1;
    }

    private static void replaceEncaWithMp4a(byte[] buffer, int searchStart, int searchEnd) {
        byte[] target = "enca".getBytes(StandardCharsets.US_ASCII);
        for (int index = searchStart; index + 4 <= searchEnd; index++) {
            if (buffer[index] == target[0] && buffer[index + 1] == target[1]
                    && buffer[index + 2] == target[2] && buffer[index + 3] == target[3]) {
                buffer[index] = 'm';
                buffer[index + 1] = 'p';
                buffer[index + 2] = '4';
                buffer[index + 3] = 'a';
                return;
            }
        }
    }

    // ─── 主入口 ───────────────────────────────────────────────────────────

    static Result decrypt(byte[] encryptedBuffer, String spadeA) throws Exception {
        if (encryptedBuffer == null || encryptedBuffer.length == 0) {
            throw new IllegalArgumentException("encryptedBuffer must be non-empty.");
        }
        byte[] key = resolveKey(spadeA);

        Box moov = findBox(encryptedBuffer, "moov", 0, encryptedBuffer.length);
        if (moov.isEmpty()) throw new IllegalStateException("Decrypt failed: 'moov' atom not found.");

        Box trak = findBox(encryptedBuffer, "trak", moov.offset + 8, moov.end);
        Box mdia = findBox(encryptedBuffer, "mdia", trak.offset + 8, trak.end);
        Box minf = findBox(encryptedBuffer, "minf", mdia.offset + 8, mdia.end);
        Box stbl = findBox(encryptedBuffer, "stbl", minf.offset + 8, minf.end);
        Box stsd = findBox(encryptedBuffer, "stsd", stbl.offset + 8, stbl.end);
        Box stsz = findBox(encryptedBuffer, "stsz", stbl.offset + 8, stbl.end);
        Box stsc = findBox(encryptedBuffer, "stsc", stbl.offset + 8, stbl.end);
        Box stco = findBox(encryptedBuffer, "stco", stbl.offset + 8, stbl.end);
        Box co64 = findBox(encryptedBuffer, "co64", stbl.offset + 8, stbl.end);

        Box senc = findBox(encryptedBuffer, "senc", moov.offset + 8, moov.end);
        if (senc.isEmpty()) {
            senc = findBox(encryptedBuffer, "senc", stbl.offset + 8, stbl.end);
        }
        if (senc.isEmpty()) throw new IllegalStateException("Decrypt failed: 'senc' atom not found.");

        Box mdat = findBox(encryptedBuffer, "mdat", 0, encryptedBuffer.length);
        if (mdat.isEmpty()) throw new IllegalStateException("Decrypt failed: 'mdat' atom not found.");

        byte[] flacMetadata = scanForFlacMetadata(
                Arrays.copyOfRange(encryptedBuffer, stsd.contentStart(), stsd.end));
        boolean flac = flacMetadata.length > 0;

        long[] sampleSizes = parseStsz(Arrays.copyOfRange(encryptedBuffer, stsz.contentStart(), stsz.end));
        List<StscEntry> stscEntries = parseStsc(Arrays.copyOfRange(encryptedBuffer, stsc.contentStart(), stsc.end));
        byte[][] ivs = parseSenc(Arrays.copyOfRange(encryptedBuffer, senc.contentStart(), senc.end));

        long[] chunkOffsets = new long[0];
        String offsetSource = "sequential";
        if (!stco.isEmpty()) {
            chunkOffsets = parseStco(Arrays.copyOfRange(encryptedBuffer, stco.contentStart(), stco.end));
            offsetSource = "stco";
        } else if (!co64.isEmpty()) {
            chunkOffsets = parseCo64(Arrays.copyOfRange(encryptedBuffer, co64.contentStart(), co64.end));
            offsetSource = "co64";
        }
        final long chunkCount = chunkOffsets.length;

        // mdat 里可能还夹着别的轨的样本（例如 text 字幕），顺序读会整体错位；
        // 能算出真实偏移且自洽（落在 mdat 内、有序、互不重叠）才用。
        long[] computed = computeSampleOffsets(sampleSizes, stscEntries, chunkOffsets);
        boolean useRealOffsets = computed.length == sampleSizes.length && areOffsetsUsable(computed, sampleSizes, mdat);
        if (!useRealOffsets) offsetSource = "sequential";

        if (sampleSizes.length != ivs.length) {
            throw new IllegalStateException("Decrypt failed: sample count " + sampleSizes.length
                    + " does not match iv count " + ivs.length + ".");
        }

        byte[][] decryptedSamples = new byte[sampleSizes.length][];
        long sequentialOffset = mdat.contentStart();
        for (int index = 0; index < sampleSizes.length; index++) {
            long size = sampleSizes[index];
            byte[] iv = ivs[index];
            if (iv == null) throw new IllegalStateException("Missing IV for sample " + index + ".");
            long sampleOffset = useRealOffsets ? computed[index] : sequentialOffset;
            int start = (int) sampleOffset;
            int length = (int) size;
            if (start < 0 || start + length > encryptedBuffer.length) {
                throw new IllegalStateException("Sample " + index + " out of bounds.");
            }
            decryptedSamples[index] = aesCtrDecrypt(key, iv,
                    Arrays.copyOfRange(encryptedBuffer, start, start + length));
            sequentialOffset += size;
        }

        byte[] output;
        if (flac) {
            output = buildFlacFile(flacMetadata, decryptedSamples);
        } else {
            output = buildM4aFile(encryptedBuffer, decryptedSamples, mdat, stsd, useRealOffsets ? computed : null);
        }
        return new Result(output, flac, (int) Math.min(sampleSizes.length, Integer.MAX_VALUE), String.valueOf(chunkCount) + "/" + offsetSource);
    }

    private static boolean areOffsetsUsable(long[] sampleOffsets, long[] sampleSizes, Box mdat) {
        if (sampleOffsets == null || sampleOffsets.length != sampleSizes.length) return false;
        long start = mdat.contentStart();
        long end = mdat.end;
        for (int index = 0; index < sampleOffsets.length; index++) {
            long offset = sampleOffsets[index];
            long size = sampleSizes[index];
            if (offset < start || offset + size > end) return false;
            if (index > 0 && offset < sampleOffsets[index - 1] + sampleSizes[index - 1]) return false;
        }
        return true;
    }

    private static byte[] buildFlacFile(byte[] flacMetadata, byte[][] decryptedSamples) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write('f');
        out.write('L');
        out.write('a');
        out.write('C');
        byte[] metadataBody = flacMetadata.length > 4
                ? Arrays.copyOfRange(flacMetadata, 4, flacMetadata.length)
                : flacMetadata;
        out.write(metadataBody);
        for (byte[] sample : decryptedSamples) out.write(sample);
        return out.toByteArray();
    }

    private static byte[] buildM4aFile(byte[] fileBuffer, byte[][] decryptedSamples, Box mdat, Box stsd, long[] sampleOffsets) {
        byte[] output = fileBuffer.clone();
        boolean useRealOffsets = sampleOffsets != null && sampleOffsets.length == decryptedSamples.length;
        long sequentialOffset = mdat.contentStart();
        for (int index = 0; index < decryptedSamples.length; index++) {
            byte[] sample = decryptedSamples[index];
            long writeOffset = useRealOffsets ? sampleOffsets[index] : sequentialOffset;
            System.arraycopy(sample, 0, output, (int) writeOffset, sample.length);
            sequentialOffset += sample.length;
        }
        replaceEncaWithMp4a(output, stsd.offset, stsd.end);
        return output;
    }

    /** 与 electron 桥一致的缓存键：sha1(cleanUrl + '\n' + auth)。 */
    static String cacheKey(String cleanUrl, String auth) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        byte[] hash = digest.digest((cleanUrl + "\n" + auth).getBytes(StandardCharsets.UTF_8));
        StringBuilder builder = new StringBuilder();
        for (byte value : hash) builder.append(String.format("%02x", value));
        return builder.toString();
    }
}
