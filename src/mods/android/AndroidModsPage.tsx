import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, Row, Status, type SettingsGroupDef } from '../../components/modal/settings/kit';
import {
    importAndroidModZip, listAndroidMods, removeAndroidMod, setAndroidModEnabled,
} from './androidModsBridge';
import { reconcileFoliumClients } from '../runtime/clientLoader';
import type { ModRuntimeInfo } from '../types';

// src/mods/android/AndroidModsPage.tsx
// Android 的模组页：只支持客户端模组；main（Node）模组在导入时就会被原生拒绝。
// 启用/停用后调用 clientLoader 重新对账，已启用的模组会立即注册或清理。

const GROUP: SettingsGroupDef = { id: 'androidMods', titleKey: 'mods.title' };

const AndroidModsPage: React.FC = () => {
    const { t } = useTranslation();
    const [mods, setMods] = React.useState<ModRuntimeInfo[]>([]);
    const [busy, setBusy] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState('');

    const refresh = React.useCallback(async () => {
        const payload = await listAndroidMods();
        setMods(payload.mods);
        return payload.mods;
    }, []);

    React.useEffect(() => {
        void refresh();
    }, [refresh]);

    const reconcile = async () => {
        const next = await refresh();
        await reconcileFoliumClients(next, 'main');
    };

    const importZip = async () => {
        if (busy) return;
        setBusy('import');
        setNotice('');
        try {
            const result = await importAndroidModZip();
            if (result.canceled) return;
            if (!result.imported) {
                setNotice(result.error || t('mods.androidIncompatible'));
                return;
            }
            await reconcile();
            setNotice(t('mods.installSuccess', { id: result.imported }));
        } finally {
            setBusy(null);
        }
    };

    const toggle = async (mod: ModRuntimeInfo) => {
        if (busy) return;
        setBusy(mod.id);
        setNotice('');
        try {
            await setAndroidModEnabled(mod.id, !mod.enabled);
            await reconcile();
        } finally {
            setBusy(null);
        }
    };

    const remove = async (mod: ModRuntimeInfo) => {
        if (busy) return;
        setBusy(mod.id);
        setNotice('');
        try {
            await removeAndroidMod(mod.id);
            await reconcile();
        } finally {
            setBusy(null);
        }
    };

    return (
        <Group def={GROUP}>
            <Row
                label={t('mods.androidTitle')}
                hint={t('mods.androidDesc')}
            >
                <Button onClick={() => void importZip()} disabled={busy !== null}>
                    {busy === 'import' ? t('mods.installing') : t('mods.androidImport')}
                </Button>
            </Row>
            {notice && <Row notice={notice} />}
            {mods.length === 0
                ? <Row notice={t('mods.androidEmpty')} />
                : mods.map(mod => (
                    <Row
                        key={mod.id}
                        label={mod.name}
                        hint={[
                            mod.id,
                            mod.version ? 'v' + mod.version : '',
                            mod.author || '',
                            mod.hasMain ? t('mods.androidIncompatible') : '',
                        ].filter(Boolean).join(' · ')}
                    >
                        <div className="flex items-center gap-2">
                            {mod.enabled && <Status tone="ok">{t('mods.enabled')}</Status>}
                            <Button onClick={() => void toggle(mod)} disabled={busy !== null || mod.hasMain}>
                                {mod.enabled ? t('mods.disable') : t('mods.enable')}
                            </Button>
                            <Button onClick={() => void remove(mod)} disabled={busy !== null}>
                                {t('mods.remove')}
                            </Button>
                        </div>
                    </Row>
                ))}
        </Group>
    );
};

export default AndroidModsPage;
