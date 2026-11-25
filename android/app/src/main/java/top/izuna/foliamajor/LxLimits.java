package top.izuna.foliamajor;

import android.util.Log;

import java.net.Socket;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Callable;

/**
 * 洛雪脚本出口的三道限制，数值和语义照桌面 {@code sources/lxmusic/main/rateLimit.ts} 的 LIMITS 一行对一行搬过来：
 *   - {@link RateGate}：每秒请求数的令牌桶，按目标主机一个桶、整个模组一个桶。出口的每一跳都过一次；桶空了就等，
 *     等的时间算在这次请求自己的时限里，要等超过 {@link Limits#MAX_WAIT_MS} 的直接拒绝。
 *   - {@link ConcurrencyGate}：同时在途的 lx.request，按目标主机和整个模组各有上限，超了排队，队满了拒绝。
 *   - {@link StreamRegistry} + 30 秒读超时 + 单流字节上限：音频转发那三件（最久没人读的流被新的顶掉、
 *     一条流最多 4 GiB、上游 30 秒不来数据就断）。
 *
 * 为什么在 Java 里另写一份而不是直接用 rateLimit.ts：安卓的出口在原生（{@link LxSandboxServer} 收 POST、
 * OkHttp 发请求、{@link LocalAudioServer} 转发音频），页面里没有出口可管。数值必须和上游一致，改一处要改两处。
 */
final class LxLimits {
    private static final String TAG = "LxLimits";

    private LxLimits() {}

    /** 桌面 rateLimit.ts 的 LIMITS：改这里之前先看上游那份有没有变。 */
    static final class Limits {
        private Limits() {}

        /** 脚本 lx.request：一个主机一口气 20 个、之后每秒 2 个；整个模组 40、之后 4。 */
        static final double RATE_PER_HOST_PER_SECOND = 2;
        static final double RATE_PER_HOST_BURST = 20;
        static final double RATE_TOTAL_PER_SECOND = 4;
        static final double RATE_TOTAL_BURST = 40;
        /** 音频转发的那套桶（播放器发起的，宽得多）：一个主机 60/10，整个模组 120/20。 */
        static final double AUDIO_RATE_PER_HOST_PER_SECOND = 10;
        static final double AUDIO_RATE_PER_HOST_BURST = 60;
        static final double AUDIO_RATE_TOTAL_PER_SECOND = 20;
        static final double AUDIO_RATE_TOTAL_BURST = 120;
        /** 要等超过这个数就直接拒绝，不占着位置。 */
        static final double MAX_WAIT_MS = 10_000;
        /** 同时在途的 lx.request：一个主机 4 个、整个模组 8 个，队里最多 16 个。 */
        static final int CONCURRENCY_PER_HOST = 4;
        static final int CONCURRENCY_TOTAL = 8;
        static final int CONCURRENCY_MAX_QUEUE = 16;
        /** 同时转发的音频流：8 条，满了顶掉最久没人读的那条。 */
        static final int MAX_STREAMS = 8;
        /** 一条音频流最多 4 GiB：一小时的 24 bit / 192 kHz FLAC 大约 2.5 GiB。 */
        static final long MAX_STREAM_BYTES = 4L * 1024 * 1024 * 1024;
        /** 我们在等、上游 30 秒不来数据就断。 */
        static final long STREAM_IDLE_MS = 30_000;
    }

    /** 被限制拒绝（不是被拦：去处没问题，只是太多、太快）。文案和桌面 RateLimitedError 一致。 */
    static final class RateLimitedException extends Exception {
        RateLimitedException(String what) {
            super("rate limited (" + what + ")");
        }
    }

    /** 记账用的主机名：不分大小写，结尾的点不算（`example.com.` 和 `example.com` 是同一个去处）。 */
    static String hostKey(String hostname) {
        String lower = hostname == null ? "" : hostname.trim().toLowerCase(Locale.ROOT);
        while (lower.endsWith(".")) lower = lower.substring(0, lower.length() - 1);
        return lower;
    }

    // ---------------------------------------------------------------- 每秒请求数

    /** 每秒请求数的闸。{@link #take} 在轮到这次请求时返回；要等得太久就抛 {@link RateLimitedException}。 */
    static final class RateGate {
        private static final class Bucket {
            double tokens;
            long atNanos;
        }

        private final double perHostPerSecond;
        private final double perHostBurst;
        private final double totalPerSecond;
        private final double totalBurst;
        private final double maxWaitMs;
        private final int maxHosts;
        private final LinkedHashMap<String, Bucket> hosts = new LinkedHashMap<>(16, 0.75f, true);
        private final Bucket all = new Bucket();

        RateGate(double perHostPerSecond, double perHostBurst, double totalPerSecond, double totalBurst,
                 double maxWaitMs, int maxHosts) {
            this.perHostPerSecond = perHostPerSecond;
            this.perHostBurst = perHostBurst;
            this.totalPerSecond = totalPerSecond;
            this.totalBurst = totalBurst;
            this.maxWaitMs = maxWaitMs;
            this.maxHosts = maxHosts;
            all.tokens = totalBurst;
            all.atNanos = System.nanoTime();
        }

        private void refill(Bucket bucket, double perSecond, double burst, long now) {
            // 钟不该往回走（用的是单调的 System.nanoTime）；真往回走了就当没过时间，不把桶扣成一大笔欠账。
            double elapsedSeconds = Math.max(0L, now - bucket.atNanos) / 1_000_000_000.0;
            bucket.tokens = Math.min(burst, bucket.tokens + elapsedSeconds * perSecond);
            bucket.atNanos = now;
        }

        /** 再拿一个令牌要等多久（令牌可以欠着：欠的就是排在前面的请求）。 */
        private static double waitFor(Bucket bucket, double perSecond) {
            return bucket.tokens >= 1 ? 0 : ((1 - bucket.tokens) / perSecond) * 1000;
        }

        void take(String hostname) throws RateLimitedException, InterruptedException {
            long now = System.nanoTime();
            Bucket host;
            double waitMs;
            synchronized (this) {
                String key = hostKey(hostname);
                host = hosts.get(key);
                if (host == null) {
                    host = new Bucket();
                    host.tokens = perHostBurst;
                    host.atNanos = now;
                    hosts.put(key, host);
                    // 记满了丢掉最久没用过的：丢掉的主机下次从满桶开始，所以整个模组那个桶才是兜底。
                    while (hosts.size() > maxHosts) {
                        Iterator<String> oldest = hosts.keySet().iterator();
                        if (!oldest.hasNext()) break;
                        oldest.next();
                        oldest.remove();
                    }
                }
                refill(host, perHostPerSecond, perHostBurst, now);
                refill(all, totalPerSecond, totalBurst, now);
                waitMs = Math.max(waitFor(host, perHostPerSecond), waitFor(all, totalPerSecond));
                if (waitMs > maxWaitMs) throw new RateLimitedException("too many requests");
                host.tokens -= 1;
                all.tokens -= 1;
            }
            if (waitMs <= 0) return;
            try {
                Thread.sleep(Math.max(1L, (long) Math.ceil(waitMs)));
            } catch (InterruptedException error) {
                // 没等到就走了的把令牌还回来：不然脚本发一串一秒就超时的请求，一个都没真发出去，却能让桶一直欠着。
                synchronized (this) {
                    all.tokens = Math.min(totalBurst, all.tokens + 1);
                    host.tokens = Math.min(perHostBurst, host.tokens + 1);
                }
                throw error;
            }
        }
    }

    // ---------------------------------------------------------------- 同时在途数

    /** 同时在途数的闸：轮到了才做 {@code work}，做完（成功或失败）让出位置；队满了直接拒绝。 */
    static final class ConcurrencyGate {
        private final int perHost;
        private final int total;
        private final int maxQueue;
        private final Map<String, Integer> running = new HashMap<>();
        private final ArrayDeque<String> queue = new ArrayDeque<>();
        private int runningTotal;

        ConcurrencyGate(int perHost, int total, int maxQueue) {
            this.perHost = perHost;
            this.total = total;
            this.maxQueue = maxQueue;
        }

        private boolean free(String host) {
            return runningTotal < total && (running.getOrDefault(host, 0)) < perHost;
        }

        private void enter(String host) {
            runningTotal += 1;
            running.put(host, running.getOrDefault(host, 0) + 1);
        }

        private void leave(String host) {
            runningTotal -= 1;
            int left = running.getOrDefault(host, 1) - 1;
            if (left > 0) running.put(host, left);
            else running.remove(host);
        }

        private void acquire(String host) throws RateLimitedException, InterruptedException {
            synchronized (this) {
                while (!free(host)) {
                    if (queue.size() >= maxQueue) throw new RateLimitedException("too many requests at once");
                    queue.addLast(host);
                    try {
                        wait();
                    } catch (InterruptedException error) {
                        queue.remove(host);
                        notifyAll();
                        throw error;
                    }
                    queue.remove(host);
                }
                enter(host);
            }
        }

        <T> T run(String hostname, Callable<T> work) throws RateLimitedException, Exception {
            String host = hostKey(hostname);
            acquire(host);
            try {
                return work.call();
            } finally {
                synchronized (this) {
                    leave(host);
                    notifyAll();
                }
            }
        }
    }

    // ---------------------------------------------------------------- 音频流

    /** 一条正在转发的音频流：算字节、记最近被读的时刻、能被新的流顶掉。 */
    static final class StreamSlot {
        private long bytes;
        private volatile Socket socket;

        synchronized boolean addBytes(long count) {
            bytes += count;
            return bytes <= Limits.MAX_STREAM_BYTES;
        }

        synchronized long bytesSoFar() {
            return bytes;
        }

        void bind(Socket client) {
            socket = client;
        }

        /** 顶掉这条流：关掉它的连接，正在写的那一头立刻 IOException 收场（桌面是 destroy 掉那条流）。 */
        void cancel() {
            Socket target = socket;
            if (target == null) return;
            try {
                target.close();
            } catch (Exception ignored) {
                // 已经关了就算了。
            }
        }
    }

    /** 同时转发的流数上限：满了顶掉最久没人读的那条（桌面的 MAX_STREAMS + forwarding 那张表）。 */
    static final class StreamRegistry {
        private final LinkedHashMap<String, StreamSlot> active = new LinkedHashMap<>(16, 0.75f, true);

        synchronized StreamSlot begin(String token) {
            while (active.size() >= Limits.MAX_STREAMS) {
                Iterator<Map.Entry<String, StreamSlot>> oldest = active.entrySet().iterator();
                if (!oldest.hasNext()) break;
                Map.Entry<String, StreamSlot> entry = oldest.next();
                oldest.remove();
                Log.i(TAG, "streams full, dropping the least recently read one: " + entry.getKey());
                entry.getValue().cancel();
            }
            StreamSlot slot = new StreamSlot();
            active.put(token, slot);
            return slot;
        }

        /** 下游读了一次：把它挪到最近使用的一端。 */
        synchronized void touch(String token) {
            active.get(token);
        }

        synchronized void release(String token) {
            active.remove(token);
        }

        synchronized int size() {
            return active.size();
        }
    }

    // ---------------------------------------------------------------- 单例

    private static final RateGate SCRIPT_RATE = new RateGate(
        Limits.RATE_PER_HOST_PER_SECOND, Limits.RATE_PER_HOST_BURST,
        Limits.RATE_TOTAL_PER_SECOND, Limits.RATE_TOTAL_BURST, Limits.MAX_WAIT_MS, 256);
    private static final RateGate AUDIO_RATE = new RateGate(
        Limits.AUDIO_RATE_PER_HOST_PER_SECOND, Limits.AUDIO_RATE_PER_HOST_BURST,
        Limits.AUDIO_RATE_TOTAL_PER_SECOND, Limits.AUDIO_RATE_TOTAL_BURST, Limits.MAX_WAIT_MS, 256);
    private static final ConcurrencyGate SCRIPT_CONCURRENCY = new ConcurrencyGate(
        Limits.CONCURRENCY_PER_HOST, Limits.CONCURRENCY_TOTAL, Limits.CONCURRENCY_MAX_QUEUE);
    private static final StreamRegistry STREAMS = new StreamRegistry();

    /** 脚本 lx.request 的每秒请求数（出口每一跳过一次）。 */
    static RateGate scriptRate() {
        return SCRIPT_RATE;
    }

    /** 脚本 lx.request 的在途数。 */
    static ConcurrencyGate scriptConcurrency() {
        return SCRIPT_CONCURRENCY;
    }

    /** 音频转发（播放器发起）的每秒请求数，另用一套桶，不跟脚本抢额度。 */
    static RateGate audioRate() {
        return AUDIO_RATE;
    }

    /** 同时转发的音频流（只数脚本给的地址那一路）。 */
    static StreamRegistry streams() {
        return STREAMS;
    }
}
