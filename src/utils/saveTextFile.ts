import { createSafeObjectUrl } from './blobGuards';

// src/utils/saveTextFile.ts
// 把一段文字存成文件。安卓没有下载目录可写，走「导出诊断数据」同一个原生入口
// （FoliaNative.shareTextFile：写进 App 缓存，再用 FileProvider 拉起系统分享面板，用户在那里选保存位置
// 或直接发给别的应用）；其它运行时还是浏览器下载。歌单文件与「时刻」的文件都经过这里。

export type NativeTextFileSharePlugin = {
    shareTextFile?: (options: { filename: string; content: string; title?: string }) => Promise<unknown>;
};

const getNativeSharePlugin = (): NativeTextFileSharePlugin | null => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as {
        Capacitor?: { Plugins?: { FoliaNative?: NativeTextFileSharePlugin } };
    }).Capacitor?.Plugins?.FoliaNative ?? null;
};

/** 这台设备上有没有原生的保存/分享文件入口（安卓有）。 */
export const hasNativeFileSave = (): boolean =>
    typeof getNativeSharePlugin()?.shareTextFile === 'function';

export const saveTextFile = async (content: string, fileName: string, mimeType: string): Promise<void> => {
    const plugin = getNativeSharePlugin();
    if (typeof plugin?.shareTextFile === 'function') {
        await plugin.shareTextFile({ filename: fileName, content, title: fileName });
        return;
    }
    const url = createSafeObjectUrl(new Blob([content], { type: mimeType }));
    if (!url) throw new Error('Failed to create file download');
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // 立即撤销会让部分 WebView 来不及读取，延后一拍再释放。
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
