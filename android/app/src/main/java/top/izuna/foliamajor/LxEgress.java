package top.izuna.foliamajor;

import java.net.InetAddress;
import java.net.URL;
import java.util.Locale;

/**
 * 洛雪脚本的受控出口判定：一个地址是不是本机、内网或别的不该让第三方脚本碰到的地方。
 *
 * 和桌面版同一套规矩（sources/lxmusic/main/egressGuard.ts），只是用 Java 写：
 *   - 名字字面上先拦：localhost、只在局域网里有意义的后缀（.local/.internal/.lan…）、没有点的单段名字；
 *   - 字面 IP 按网段拦：回环、私网、链路本地、运营商 NAT、保留段、组播；
 *   - 剩下的解析一次，解析出的任何一个地址被拦，整条就拦（DNS 把公网名字指到内网也不放）。
 * 拦下的原因只回给脚本一句 `egress blocked (<原因>)`，不把解析出的地址说出去。
 */
final class LxEgress {
    /** 只在本机或局域网里有意义的后缀：解析之前就拦，解析结果是什么都不看。 */
    private static final String[] LOCAL_SUFFIXES = {
        ".localhost", ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home", ".corp", ".home.arpa",
    };

    private LxEgress() {}

    /** 能不能出去；null 是能，其余是拦下的原因。 */
    static String blockReason(String raw) {
        if (raw == null) return "invalid-address";
        URL parsed;
        try {
            parsed = new URL(raw);
        } catch (Exception error) {
            return "invalid-address";
        }
        String scheme = parsed.getProtocol() == null ? "" : parsed.getProtocol().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) return "invalid-address";
        String host = parsed.getHost();
        if (host == null) return "invalid-address";
        host = host.replaceAll("^\\[|\\]$", "").trim().toLowerCase(Locale.ROOT);
        while (host.endsWith(".")) host = host.substring(0, host.length() - 1);
        if (host.isEmpty()) return "invalid-address";

        if (host.equals("localhost")) return "local-name";
        for (String suffix : LOCAL_SUFFIXES) {
            if (host.endsWith(suffix)) return "local-name";
        }
        if (!host.contains(".") && !host.contains(":")) return "local-name";

        if (isIpLiteral(host)) {
            try {
                return addressReason(InetAddress.getByName(host));
            } catch (Exception error) {
                return "invalid-address";
            }
        }
        // 名字要解析：每一跳跳转都重新走一遍这里。
        try {
            for (InetAddress address : InetAddress.getAllByName(host)) {
                String reason = addressReason(address);
                if (reason != null) return reason;
            }
        } catch (Exception error) {
            return "invalid-address";
        }
        return null;
    }

    private static boolean isIpLiteral(String host) {
        if (host.contains(":")) return true;
        return host.matches("^\\d{1,3}(\\.\\d{1,3}){3}$");
    }

    /** 一个解析出来的地址该不该拦。 */
    private static String addressReason(InetAddress address) {
        if (address == null) return "invalid-address";
        if (address.isAnyLocalAddress()) return "unspecified";
        if (address.isLoopbackAddress()) return "loopback";
        if (address.isLinkLocalAddress()) return "link-local";
        if (address.isSiteLocalAddress()) return "private";
        if (address.isMulticastAddress()) return "multicast";
        byte[] bytes = address.getAddress();
        if (bytes == null) return "invalid-address";
        if (bytes.length == 4) {
            int a = bytes[0] & 0xff;
            int b = bytes[1] & 0xff;
            int c = bytes[2] & 0xff;
            if (a == 0) return "unspecified";
            if (a == 10) return "private";
            if (a == 172 && b >= 16 && b <= 31) return "private";
            if (a == 192 && b == 168) return "private";
            if (a == 100 && b >= 64 && b <= 127) return "carrier-nat";
            if (a == 169 && b == 254) return "link-local";
            if (a == 192 && b == 0 && c == 0) return "reserved";
            if (a == 192 && b == 0 && c == 2) return "reserved";
            if (a == 198 && b == 51 && c == 100) return "reserved";
            if (a == 203 && b == 0 && c == 113) return "reserved";
            if (a >= 224 && a <= 239) return "multicast";
            if (a >= 240) return "reserved";
            return null;
        }
        if (bytes.length == 16) {
            int first = bytes[0] & 0xff;
            int second = bytes[1] & 0xff;
            // fc00::/7（ULA）与 fec0::/10（旧的站点本地）都算私网；fe80::/10 由 isLinkLocalAddress 管。
            if ((first & 0xfe) == 0xfc) return "private";
            if (first == 0xfe && (second & 0xc0) == 0xc0) return "private";
            return null;
        }
        return "invalid-address";
    }
}
