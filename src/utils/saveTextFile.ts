import { createSafeObjectUrl } from './blobGuards';

// src/utils/saveTextFile.ts
// 把一段文字存成文件。安卓没有下载目录可写，走原生的系统保存对话框（FoliaNative.saveTextFile，
// Intent.ACTION_CREATE_DOCUMENT：用户自己选文件夹和文件名，和桌面的「另存为」一样）；插件版本旧、
// 没有这个方法时退回「导出诊断数据」那条分享面板（FoliaNative.shareTextFile）。其它运行时还是浏览器下载。
// 歌单文件与「时刻」的文件都经过这里。

export type NativeTextFileSharePlugin = {
    /** 系统「保存到…」对话框；`{ saved: false }` 表示用户取消。 */
    saveTextFile?: (options: {
        filename: string;
        content: string;
        mimeType?: string;
    }) => Promise<{ saved?: boolean } | unknown>;
    /** 旧入口：缓存目录 + FileProvider + 分享面板。 */
    shareTextFile?: (options: { filename: string; content: string; title?: string }) => Promise<unknown>;
};

const getNativeSharePlugin = (): NativeTextFileSharePlugin | null => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as {
        Capacitor?: { Plugins?: { FoliaNative?: NativeTextFileSharePlugin } };
    }).Capacitor?.Plugins?.FoliaNative ?? null;
};

/** 这台设备上有没有原生的保存文件入口（安卓有）。 */
export const hasNativeFileSave = (): boolean =>
    typeof getNativeSharePlugin()?.saveTextFile === 'function'
    || typeof getNativeSharePlugin()?.shareTextFile === 'function';

/** @returns 文件是否真的保存了；用户取消系统保存对话框时是 false。 */
export const saveTextFile = async (content: string, fileName: string, mimeType: string): Promise<boolean> => {
    const plugin = getNativeSharePlugin();
    // Intent.setType 不收 `;charset=…` 这类参数，交给原生前先去掉。
    const nativeMimeType = mimeType.split(';')[0].trim() || 'text/plain';
    if (typeof plugin?.saveTextFile === 'function') {
        const task = Promise.resolve(plugin.saveTextFile({ filename: fileName, content, mimeType: nativeMimeType }));
        const answer = await Promise.race([
            task,
            // 系统面板起来后用户可能挑很久，这里只兜底“调用根本没出去/回调丢了”的情况：
            // 超过 60 秒还没消息就当失败，绝不让「导出」按钮永远灰着。用户稍后真点了保存也不会出乱子，
            // 原生那边仍会写文件，只是这次界面不再提示成功。
            new Promise<never>((_, reject) => setTimeout(
                () => reject(new Error('System save dialog did not answer')),
                60_000,
            )),
        ]);
        return !(answer && typeof answer === 'object' && (answer as { saved?: unknown }).saved === false);
    }
    if (typeof plugin?.shareTextFile === 'function') {
        await plugin.shareTextFile({ filename: fileName, content, title: fileName });
        return true;
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
    return true;
};
