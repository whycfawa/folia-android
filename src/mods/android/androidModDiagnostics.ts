import { getStoredString, setStoredString } from '../../stores/storagePrimitives';
import { isCapacitorAndroid } from '../../platform/runtime';
import { androidModMarketBridge } from './androidModMarket';
import { getAndroidSourceStates } from './androidSourceStates';
import { isModsBridgeAvailable } from '../ipc';

// src/mods/android/androidModDiagnostics.ts
// 诊断报告用的模组现场：桥在不在、总开关/社区开关、音源表、市场目录缓存，以及最近一次操作错误。
// 只写本地状态与错误码，不写 cookie / token / 账号。

const ERROR_KEY = 'mod_last_error';
const MAX_ENTRIES = 8;

export type ModErrorEntry = { at: string; operation: string; error: string };

export const noteModError = (operation: string, error: string | undefined): void => {
    if (!error) return;
    try {
        const previous: unknown = JSON.parse(getStoredString(ERROR_KEY, '[]'));
        const entries = Array.isArray(previous) ? previous.filter((entry): entry is ModErrorEntry => (
            Boolean(entry) && typeof entry === 'object' && typeof entry.at === 'string'
            && typeof entry.operation === 'string' && typeof entry.error === 'string'
        )) : [];
        entries.unshift({ at: new Date().toISOString(), operation, error });
        setStoredString(ERROR_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
    } catch {
        // Diagnostics must never break the action that is being reported.
    }
};

export const readModDiagnosticLines = async (): Promise<string[]> => {
    const android = isCapacitorAndroid();
    const lines = [
        `  bridge: ${android ? 'android-native' : (typeof window !== 'undefined' && window.electron?.mods ? 'electron' : 'none')}`,
    ];
    if (android) {
        lines.push(`  ui bridge: mods=${isModsBridgeAvailable() ? 'available' : 'unavailable'} (iOS/electron bridge probe)`);
        let errors: ModErrorEntry[] = [];
        try {
            const parsed: unknown = JSON.parse(getStoredString(ERROR_KEY, '[]'));
            if (Array.isArray(parsed)) errors = parsed as ModErrorEntry[];
        } catch { /* no recorded errors */ }
        lines.push(`  last errors: ${errors.length ? errors.slice(0, 4).map(entry => `${entry.operation}=${entry.error}@${entry.at}`).join(', ') : '(none)'}`);
        try {
            const states = await getAndroidSourceStates();
            lines.push(`  source states: ${Object.entries(states.states).map(([id, state]) => `${id}=${state}`).join(', ') || '(none)'}`);
            lines.push(`  source rows: ${states.sources.length} hasSourceMods=${states.hasSourceMods} onboarding=${states.sourcesOnboarding}`);
        } catch (error) {
            lines.push(`  source states: unavailable (${error instanceof Error ? error.message : String(error)})`);
        }
        const catalog = await androidModMarketBridge.getMarketCatalog();
        lines.push(`  market catalog: ${catalog.ok ? `${catalog.catalog.mods.length} mods stale=${catalog.stale} error=${catalog.error ?? '(none)'}` : `unavailable (${catalog.error})`}`);
        try {
            const raw = getStoredString('mod_market_catalog', '');
            const parsed = raw ? JSON.parse(raw) as { fetchedAt?: number } : null;
            lines.push(`  market cache: stored=${raw ? 'yes' : 'no'} age=${parsed && typeof parsed.fetchedAt === 'number' ? `${Math.round((Date.now() - parsed.fetchedAt) / 1000)}s` : 'n/a'}`);
        } catch {
            lines.push('  market cache: unreadable');
        }
    }
    return lines;
};
