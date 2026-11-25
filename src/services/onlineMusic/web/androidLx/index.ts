import type { FoliumClientApi } from '../../../../mods/folium/contract';
import i18n from '../../../../i18n/config';
import { createFoliumI18n } from '../../../../mods/folium/sources/i18n';
import { createFoliumSourceError } from '../../../../mods/folium/sources/errors';
import { createFoliumPageStore, registerFoliumSource } from '../../../../mods/folium/registries/sources';
import { commandsRegistry } from '../../../../mods/folium/registries/commands';
import { foliumModTextNamespace } from '../../../../mods/folium/registries/sourceText';
import { markFoliumSourceMod } from '../../../../mods/runtime/guard';
import lxmusicPackage from 'virtual:folia-source/lxmusic';
import activate from '../../../../../sources/lxmusic/client/index';
import { runtimeInfoOf } from '../foliumWebSource';
import { createLxBackend } from './backend';

// src/services/onlineMusic/web/androidLx/index.ts
// 洛雪音源在安卓上的注册。桌面版是模组的 client 入口由主进程的模组运行时 activate；安卓没有主进程，所以这里：
//   - 照 foliumWebSource.ts 的做法把模组的语言表装进它的命名空间（`folium-mod/lxmusic`），
//   - 用同一张受信表那个短 id 把音源登记进宿主（registerFoliumSource），
//   - 然后调上游那份 client 的 activate(folium)，只给它用到的几个成员（rpc / sources / registries.commands / i18n / log）。
// activate 与音源定义本身是 upstream 的代码，没有第二份实现；换掉的只是「谁在下面答话」。

let cleanup: (() => void) | null = null;

export const registerLxMusic = (): string[] => {
    const { manifest, locales } = lxmusicPackage;
    const modId = manifest.id;
    cleanup?.();

    const namespace = foliumModTextNamespace(modId);
    Object.entries(locales).forEach(([language, texts]) => {
        i18n.addResourceBundle(language, namespace, texts, true, true);
    });
    const texts = createFoliumI18n((key, params) => i18n.t(`${namespace}:${key}`, { ...params, defaultValue: '' }));

    const mod = runtimeInfoOf(manifest);
    const backend = createLxBackend();
    const stopped = () => false;
    const handles = [] as Array<{ unregister(): void }>;
    const commands: Array<{ unregister(): void }> = [];

    // 只给 activate 真正用到的成员；别的成员它不碰，缺了也不会在这次 activate 里被读到。
    const api = {
        modId,
        log: { warn: (...args: unknown[]) => console.warn(...args) },
        rpc: {
            call: <T>(name: string, ...args: unknown[]) => backend.call(name, ...args) as Promise<T>,
        },
        sources: {
            register: (def: unknown) => {
                const handle = registerFoliumSource({ mod, stopped }, def);
                handles.push(handle);
                return handle;
            },
            pageStore: createFoliumPageStore,
            error: createFoliumSourceError,
        },
        registries: {
            commands: {
                register: (def: never) => {
                    const handle = commandsRegistry.register(modId, def);
                    commands.push(handle);
                    return handle;
                },
            },
        },
        i18n: {
            key: (key: string, params?: Record<string, string | number>) => texts.key(key, params),
            text: (key: string, params?: Record<string, string | number>) => texts.text(key, params),
        },
    } as unknown as FoliumClientApi;

    markFoliumSourceMod(modId, true);
    try {
        activate(api);
    } catch (error) {
        console.warn('[Sources] Android: lxmusic could not be registered', error);
        handles.forEach(handle => handle.unregister());
        commands.forEach(handle => handle.unregister());
        backend.destroySandbox();
        throw error;
    }

    cleanup = () => {
        cleanup = null;
        handles.splice(0).forEach(handle => handle.unregister());
        commands.splice(0).forEach(handle => handle.unregister());
        backend.destroySandbox();
    };

    return handles.map(handle => (handle as unknown as { id: string }).id);
};

/** 把洛雪从宿主上拿掉（关掉这个内置模组时用）。没注册过返回 false。 */
export const unregisterLxMusic = (): boolean => {
    const undo = cleanup;
    if (!undo) return false;
    undo();
    return true;
};
