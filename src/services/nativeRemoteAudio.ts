// src/services/nativeRemoteAudio.ts
// Routes signed Kuwo/Bodian URLs through the Android Range-capable local stream server.

/**
 * 酷狗 0.8.0 的音源把播放地址强制改成了 https；`fs.*.kugou.com` 的证书链在部分安卓 WebView/OkHttp
 * 上验证不过（本地代理日志是 SSLPeerUnverifiedException），于是解析成功、播放必失败。
 * 这里和上游相反：安卓本地代理会自己带 UA/Referer、加 ACAO 并支持 Range，不需要规避混合内容，
 * 用 http 原地址反而才是稳定的那条路。只针对酷狗文件主机，其它平台照旧。
 */
const kugouHttpPlaybackUrl = (url: string): string => {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && parsed.hostname.startsWith('fs.') && parsed.hostname.endsWith('.kugou.com')
            ? url.replace(/^https:/i, 'http:')
            : url;
    } catch {
        return url;
    }
};

export const proxyNativeRemoteAudioUrl = async (url: string): Promise<string> => {
    if (!url || typeof window === 'undefined') return url;
    const plugin = (window as any).Capacitor?.Plugins?.FoliaNative;
    if (!plugin?.registerRemoteAudio) return url;
    const target = kugouHttpPlaybackUrl(url);
    try {
        const result = await plugin.registerRemoteAudio({ url: target });
        return typeof result?.url === 'string' && result.url ? result.url : url;
    } catch (error) {
        console.warn('[NativeRemoteAudio] proxy registration failed', error);
        return url;
    }
};
