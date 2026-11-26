// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasNativeFileSave, saveTextFile } from '@/utils/saveTextFile';

// test/unit/folia-playlists/saveTextFile.test.ts
//
// 安卓没有下载目录：歌单文件走原生的系统「保存到…」对话框（FoliaNative.saveTextFile），
// 取消时不能报「已导出」；插件没有这个方法时退回诊断报告那条分享面板；其余运行时保持浏览器下载。

const installAndroidSave = (answer: { saved?: boolean } = { saved: true }) => {
    const saveTextFile = vi.fn(async () => answer);
    (window as unknown as { Capacitor?: unknown }).Capacitor = {
        Plugins: { FoliaNative: { saveTextFile } },
    };
    return saveTextFile;
};

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
    it('opens the system save dialog with the real file name and type on Android', async () => {
        const saveDialog = installAndroidSave();
        expect(hasNativeFileSave()).toBe(true);

        const saved = await saveTextFile('{"version":1}', 'demo-playlist.json', 'application/json;charset=utf-8');

        expect(saved).toBe(true);
        expect(saveDialog).toHaveBeenCalledTimes(1);
        // Intent.setType 不收 `;charset=…`，交给原生前已经去掉。
        expect(saveDialog).toHaveBeenCalledWith({
            filename: 'demo-playlist.json',
            content: '{"version":1}',
            mimeType: 'application/json',
        });
    });

    it('reports a cancelled system dialog instead of a saved file', async () => {
        installAndroidSave({ saved: false });
        expect(await saveTextFile('x', 'demo.json', 'application/json')).toBe(false);
    });

    it('comes back with a failure instead of leaving the export button disabled for good', async () => {
        vi.useFakeTimers();
        installAndroidSave();
        // 原生调用既不 resolve 也不 reject（面板没起来 / 回调丢了）。
        (window as any).Capacitor.Plugins.FoliaNative.saveTextFile = vi.fn(() => new Promise(() => undefined));
        const pending = saveTextFile('x', 'demo.json', 'application/json');
        const assertion = expect(pending).rejects.toThrow('System save dialog did not answer');
        await vi.advanceTimersByTimeAsync(60_001);
        await assertion;
    });

    it('surfaces a native failure instead of pretending the file was saved', async () => {
        (window as unknown as { Capacitor?: unknown }).Capacitor = {
            Plugins: { FoliaNative: { saveTextFile: vi.fn(async () => { throw new Error('no activity'); }) } },
        };
        await expect(saveTextFile('x', 'demo.json', 'application/json')).rejects.toThrow('no activity');
    });

    it('falls back to the diagnostics share sheet when the plugin has no save dialog', async () => {
        const shareTextFile = installAndroidShare();
        expect(await saveTextFile('x', 'demo.m3u8', 'audio/x-mpegurl')).toBe(true);
        expect(shareTextFile).toHaveBeenCalledWith({ filename: 'demo.m3u8', content: 'x', title: 'demo.m3u8' });
    });

    it('keeps the browser download where there is no native entry', async () => {
        expect(hasNativeFileSave()).toBe(false);
        const createObjectURL = vi.fn(() => 'blob:folia');
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

        expect(await saveTextFile('a,b', 'demo.m3u8', 'audio/x-mpegurl')).toBe(true);

        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(click).toHaveBeenCalledTimes(1);
    });
});
