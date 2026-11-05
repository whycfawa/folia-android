import { useEffect } from 'react';

type NativeBackPlugin = {
    addListener: (
        eventName: string,
        listener: () => void,
    ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
    exitApp: () => Promise<unknown>;
    moveTaskToBack?: () => Promise<unknown>;
    recordRuntimeDiagnostic?: (payload: {
        source: string;
        thread: string;
        type: string;
        message: string;
        stack: string;
    }) => Promise<unknown>;
};

const getPlugin = (): NativeBackPlugin | null => {
    if (typeof window === 'undefined') return null;
    const capacitor = (window as unknown as {
        Capacitor?: {
            getPlatform?: () => string;
            Plugins?: { FoliaNative?: NativeBackPlugin };
        };
    }).Capacitor;
    if (capacitor?.getPlatform?.() !== 'android') return null;
    const plugin = capacitor.Plugins?.FoliaNative;
    return plugin && typeof plugin.addListener === 'function' && typeof plugin.exitApp === 'function'
        ? plugin
        : null;
};

export type NativeBackOutcome = 'handled' | 'background' | 'exit';

/**
 * 返回键到底做什么。抽成纯函数是为了能直接测「无层可关时不再直接退出」这条策略。
 *
 * 有层消费：什么都不做（面板 / 设置子页 / 弹窗自己关掉）。
 * 没人消费：退到后台，让前台播放服务继续跑。以前这里直接 `exitApp()`，结束 Activity 会连带收掉
 * WebView 与播放服务，用户看到的就是「退出应用就自动暂停播放」。老桥没有 moveTaskToBack 时
 * 退回原来的退出行为，避免按返回键完全没反应。
 */
export const applyNativeBackPress = (
    plugin: Pick<NativeBackPlugin, 'exitApp' | 'moveTaskToBack' | 'recordRuntimeDiagnostic'>,
    handled: boolean,
): NativeBackOutcome => {
    if (handled) {
        void plugin.recordRuntimeDiagnostic?.({
            source: 'activity-lifecycle',
            thread: 'webview',
            type: 'back-handled',
            message: 'A layer handled Escape',
            stack: '',
        }).catch(() => undefined);
        return 'handled';
    }

    const canMoveToBackground = typeof plugin.moveTaskToBack === 'function';
    void plugin.recordRuntimeDiagnostic?.({
        source: 'activity-lifecycle',
        thread: 'webview',
        type: 'back-to-background',
        message: canMoveToBackground
            ? 'No layer handled Escape; moving the task to the background'
            : 'No layer handled Escape; no background bridge available, requesting app exit',
        stack: '',
    }).catch(() => undefined);
    const action = canMoveToBackground ? plugin.moveTaskToBack!() : plugin.exitApp();
    void action.catch(() => undefined);
    return canMoveToBackground ? 'background' : 'exit';
};

/**
 * Routes the Android hardware Back through the same keyboard handling the app already uses for
 * Escape. Dialogs and nested settings views close themselves there; when no layer consumes the
 * event the app moves to the background instead of exiting, so playback keeps running.
 */
export const useNativeBackButton = (): void => {
    useEffect(() => {
        const plugin = getPlugin();
        if (!plugin) return;

        let disposed = false;
        let listenerHandle: { remove: () => Promise<void> } | { remove: () => void } | null = null;
        const registered = plugin.addListener('backButton', () => {
            if (disposed) return;
            const event = new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                bubbles: true,
                cancelable: true,
            });
            const handled = !window.dispatchEvent(event) || event.defaultPrevented;
            window.dispatchEvent(new KeyboardEvent('keyup', {
                key: 'Escape',
                code: 'Escape',
                bubbles: true,
                cancelable: true,
            }));
            applyNativeBackPress(plugin, handled);
        });

        Promise.resolve(registered)
            .then(handle => {
                if (disposed) {
                    void handle.remove();
                    return;
                }
                listenerHandle = handle;
            })
            .catch(() => undefined);

        return () => {
            disposed = true;
            if (listenerHandle) void listenerHandle.remove();
        };
    }, []);
};
