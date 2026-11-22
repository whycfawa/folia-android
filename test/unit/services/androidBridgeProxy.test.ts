// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isBridgedApiUrl, resolveBridgedRequestUrl } from '@/services/nativeAndroidBridge';

// test/unit/services/androidBridgeProxy.test.ts
//
// 安卓这边由 Capacitor 的本地服务器提供 dist，没有任何东西实现网页版的 /api/lyric-proxy：
// 相对路径既不在白名单里、原样发出去又是 404，所以封面缓存、QQ 歌词、酷狗 legacy 搜索在安卓上
// 都是静默失败。这里锁住「同源代理请求解回真实地址交给原生」这条规则，以及它只认同源。

describe('resolveBridgedRequestUrl', () => {
    it('routes update metadata and GitHub assets through the native bridge', () => {
        expect(resolveBridgedRequestUrl('https://gh-proxy.org/https://api.github.com/repos/whycfawa/folia-android/releases/latest'))
            .toBe('https://gh-proxy.org/https://api.github.com/repos/whycfawa/folia-android/releases/latest');
        expect(resolveBridgedRequestUrl('https://api.github.com/repos/whycfawa/folia-android/releases/latest'))
            .toBe('https://api.github.com/repos/whycfawa/folia-android/releases/latest');
        expect(resolveBridgedRequestUrl('https://github.com/whycfawa/folia-android/releases/download/v0.7.29-android.487/Folia.apk'))
            .toBe('https://github.com/whycfawa/folia-android/releases/download/v0.7.29-android.487/Folia.apk');
    });

    it('passes whitelisted hosts straight through', () => {
        expect(resolveBridgedRequestUrl('https://u.y.qq.com/cgi-bin/musicu.fcg?format=json'))
            .toBe('https://u.y.qq.com/cgi-bin/musicu.fcg?format=json');
        // 整个域名匹配，酷狗的一堆子域不用逐个列。
        expect(resolveBridgedRequestUrl('https://krcs.kugou.com/search?x=1'))
            .toBe('https://krcs.kugou.com/search?x=1');
    });

    it('unwraps a same-origin lyric-proxy request to its target', () => {
        const target = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg';
        const proxied = `${location.origin}/api/lyric-proxy?url=${encodeURIComponent(target)}`;
        expect(resolveBridgedRequestUrl(proxied)).toBe(target);
    });

    it('keeps the target query string intact', () => {
        const target = 'https://sansenjian.example/lyric?ver=1&fmt=krc&raw=1';
        const proxied = `/api/lyric-proxy?url=${encodeURIComponent(target)}`;
        expect(resolveBridgedRequestUrl(proxied)).toBe(target);
    });

    // 只认自己页面发出的代理请求：外部页面不能借这个入口让原生去取任意地址。
    it('refuses a foreign origin claiming to be the proxy', () => {
        const proxied = `https://evil.example/api/lyric-proxy?url=${encodeURIComponent('https://internal.example/x')}`;
        expect(resolveBridgedRequestUrl(proxied)).toBeNull();
    });

    it('refuses other same-origin api paths without a target', () => {
        expect(resolveBridgedRequestUrl('/api/something-else?url=https://y.qq.com/')).toBeNull();
        expect(resolveBridgedRequestUrl('/api/lyric-proxy')).toBeNull();
        expect(resolveBridgedRequestUrl('/api/lyric-proxy?url=not-a-url')).toBeNull();
    });

    it('leaves ordinary app assets to the WebView', () => {
        expect(resolveBridgedRequestUrl('/assets/index-abc.js')).toBeNull();
        expect(resolveBridgedRequestUrl('not a url at all')).toBeNull();
    });

    it('isBridgedApiUrl follows the same rule', () => {
        expect(isBridgedApiUrl('https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg')).toBe(true);
        expect(isBridgedApiUrl(`/api/lyric-proxy?url=${encodeURIComponent('https://c1.kgimg.com/x.jpg')}`)).toBe(true);
        expect(isBridgedApiUrl('/assets/index-abc.js')).toBe(false);
    });
});
