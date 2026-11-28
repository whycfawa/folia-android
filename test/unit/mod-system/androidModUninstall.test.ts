import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/mod-system/androidModUninstall.test.ts
// 安卓用户模组的卸载：列表要标 uninstallable，桌面桥的 uninstallMod 要真的调用原生删除并刷新列表。

const nativeMods = vi.hoisted(() => ({
    list: vi.fn(),
    remove: vi.fn(),
    setEnabled: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    registerPlugin: (name: string) => (name === 'FoliaMods' ? nativeMods : {}),
}));

vi.mock('@/platform/runtime', () => ({ isCapacitorAndroid: () => true }));

import { androidModsBridge, listAndroidMods } from '../../../src/mods/android/androidModsBridge';

const installedMod = (manifestId = 'user-mod', dir = 'user-mod') => ({
    id: dir,
    dir,
    manifest: JSON.stringify({
        id: manifestId,
        name: 'User Mod',
        version: '1.0.0',
        sources: [{ id: 'lx', name: 'LX' }],
    }),
    digest: 'a'.repeat(64),
    enabled: true,
    clientUrl: 'http://localhost/user-mod/client.mjs',
});

beforeEach(() => {
    nativeMods.list.mockReset();
    nativeMods.remove.mockReset();
    nativeMods.setEnabled.mockReset();
    nativeMods.list.mockResolvedValue({ mods: [installedMod()] });
    nativeMods.remove.mockResolvedValue({ deleted: true });
});

describe('android user mod uninstall', () => {
    it('marks native user mods as uninstallable', async () => {
        const payload = await listAndroidMods();
        const userMod = payload.mods.find((mod) => mod.id === 'user-mod');
        expect(userMod?.uninstallable).toBe(true);
    });

    it('removes the selected native mod and refreshes the list', async () => {
        await expect(androidModsBridge.uninstallMod!('user-mod')).resolves.toMatchObject({ ok: true });
        expect(nativeMods.remove).toHaveBeenCalledWith({ id: 'user-mod' });
        expect(nativeMods.list).toHaveBeenCalled();
    });

    it('removes the native directory when the manifest id differs from it', async () => {
        nativeMods.list.mockResolvedValue({ mods: [installedMod('catalog-id', 'folder-id')] });
        await expect(androidModsBridge.uninstallMod!('catalog-id')).resolves.toMatchObject({ ok: true });
        expect(nativeMods.remove).toHaveBeenCalledWith({ id: 'folder-id' });
    });

    it('matches by manifest id only, never by a directory name that looks like another mod', async () => {
        // 目录名 beta 属于清单 id alpha 的包；直接按目录名匹配会删错。
        nativeMods.list.mockResolvedValue({
            mods: [installedMod('alpha', 'beta'), installedMod('beta', 'gamma')],
        });
        await expect(androidModsBridge.uninstallMod!('beta')).resolves.toMatchObject({ ok: true });
        expect(nativeMods.remove).toHaveBeenCalledTimes(1);
        expect(nativeMods.remove).toHaveBeenCalledWith({ id: 'gamma' });
    });

    it('refuses to uninstall when several mods share the manifest id', async () => {
        nativeMods.list.mockResolvedValue({
            mods: [installedMod('duplicate', 'first'), installedMod('duplicate', 'second')],
        });
        const answer = await androidModsBridge.uninstallMod!('duplicate');
        expect(answer.ok).toBe(false);
        expect(answer.error).toMatch(/^uninstall-ambiguous/);
        expect(nativeMods.remove).not.toHaveBeenCalled();
    });

    it('does not remove a built-in mod that has no native directory', async () => {
        await expect(androidModsBridge.uninstallMod!('ytm')).resolves.toMatchObject({
            ok: false,
            error: 'uninstall-not-user-mod',
        });
        expect(nativeMods.remove).not.toHaveBeenCalled();
    });

    it('reports deletion failure without pretending it succeeded', async () => {
        nativeMods.remove.mockResolvedValueOnce({ deleted: false });
        await expect(androidModsBridge.uninstallMod!('user-mod')).resolves.toMatchObject({
            ok: false,
            error: 'uninstall-failed',
        });
    });
});
