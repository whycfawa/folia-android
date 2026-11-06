// src/services/onlineMusic/ytm/android/ytmAndroidSandbox.ts
// Android App：YouTube 的第三方脚本（BotGuard、播放器的解密函数）在一个隐藏的空白 iframe 里跑，
// 它们的全局变量不碰 App 的页面。桌面版用的是主进程开的沙盒窗口（electron/ytm/sandbox.cjs）。

type EvalWindow = Window & { eval: (source: string) => unknown };

/** 一块沙盒：evaluate 跑一段脚本、得到它的值（Promise 会等它完成）；reset 连 iframe 一起丢掉。 */
export const createYtmSandbox = () => {
    let frame: HTMLIFrameElement | null = null;
    const target = (): EvalWindow => {
        if (!frame || !frame.isConnected || !frame.contentWindow) {
            frame = document.createElement('iframe');
            frame.setAttribute('aria-hidden', 'true');
            frame.setAttribute('tabindex', '-1');
            frame.style.display = 'none';
            document.body.appendChild(frame);
        }
        const view = frame.contentWindow as EvalWindow | null;
        if (!view) throw new Error('YouTube Music sandbox frame is unavailable');
        return view;
    };
    return {
        async evaluate(code: string): Promise<unknown> {
            return await target().eval(code);
        },
        reset() {
            frame?.remove();
            frame = null;
        },
    };
};
