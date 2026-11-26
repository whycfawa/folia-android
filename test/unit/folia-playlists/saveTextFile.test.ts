// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasNativeFileSave, saveTextFile } from '@/utils/saveTextFile';

// test/unit/folia-playlists/saveTextFile.test.ts
//
// 安卓没有下载目录，歌单文件必须走「导出诊断数据」同一个原生分享面板（FoliaNative.shareTextFile）；
// 其余运行时保持浏览器下载。这里钉住这两条路。

const installAndroidShare = () => {
    const shareTextFile = vi.fn(async () => undefined);
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
        Plugins: { FoliaNative: { shareTextFile } },
    };
    return shareTextFile;
};

afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('saveTextFile', () => {
    it('hands the file to the native share sheet on Android', async () => {
        const shareTextFile = installAndroidShare();
        expect(hasNativeFileSave()).toBe(true);

        await saveTextFile('{"version":1}', 'demo-playlist.json', 'application/json;charset=utf-8');

        expect(shareTextFile).toHaveBeenCalledTimes(1);
        expect(shareTextFile).toHaveBeenCalledWith({
            filename: 'demo-playlist.json',
            content: '{"version":1}',
            title: 'demo-playlist.json',
        });
    });

    it('surfaces a native failure instead of pretending the file was saved', async () => {
        (window as unknown as { Capacitor?: unknown }).Capacitor = {
            Plugins: { FoliaNative: { shareTextFile: vi.fn(async () => { throw new Error('no activity'); }) } },
        };
        await expect(saveTextFile('x', 'demo.json', 'application/json')).rejects.toThrow('no activity');
    });

    it('keeps the browser download where there is no native entry', async () => {
        expect(hasNativeFileSave()).toBe(false);
        const createObjectURL = vi.fn(() => 'blob:folia');
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        await saveTextFile('a,b', 'demo.m3u8', 'application/vnd.apple.mpegurl');

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
    });
});
