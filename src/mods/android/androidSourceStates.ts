import type { ModSourceState, ModSourceStatesPayload } from '../types';
import builtinModPackages from 'virtual:folia-builtin-mods';
import { getStoredString, setStoredString } from '../../stores/storagePrimitives';
import { writeBuiltinModEnabled } from './androidModPrefs';

// src/mods/android/androidSourceStates.ts
// 桌面版的 source states 表在主进程（mods.sourceStates）；安卓没有主进程，按安卓专属桥接规则
// 把同一张表落到 localStorage，并由 androidModsBridge 暴露同形的 get/set。
// 开关的即时生效复用内置音源模组的注册/注销（androidSources.ts 已有的那条路）。

const STATES_KEY = 'mods_source_states';
const ONBOARDING_KEY = 'mods_sources_onboarding';
const STATE_VALUES: readonly ModSourceState[] = ['enabled', 'matching', 'disabled'];

const readStates = (): Record<string, ModSourceState> => {
    try {
        const parsed: unknown = JSON.parse(getStoredString(STATES_KEY, '{}'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, ModSourceState] => (
            STATE_VALUES.includes(entry[1] as ModSourceState)
        )));
    } catch {
        return {};
    }
};

const readSources = (): ModSourceStatesPayload['sources'] => builtinModPackages.flatMap((entry) => (
    entry.manifest.sources.map(source => ({
        sourceId: source.id,
        modId: entry.manifest.id,
        tier: 'builtin' as const,
        state: readStates()[source.id] ?? 'enabled',
        name: source.name,
        keepForMatching: source.keepForMatching === true,
        takeover: false,
        loaded: true,
        mainState: 'none' as const,
    }))
));

/**
 * 音源状态表与「内置模组开关」是同一件事的两面：模组窗口的开关写在 builtinModEnabled，
 * 设置 → 音源的开关写在这里。任何一边改完都必须把另一边对齐，否则刷新后开关会弹回去，
 * 用户看到的就是「关不掉」。一个模组有多个音源时，只要还有一个没关，模组就算开着。
 */
const syncBuiltinModEnabled = (modId: string): void => {
    const entry = builtinModPackages.find(pkg => pkg.manifest.id === modId);
    if (!entry) return;
    const states = readStates();
    const anyEnabled = entry.manifest.sources.some(source => (states[source.id] ?? 'enabled') !== 'disabled');
    writeBuiltinModEnabled(modId, anyEnabled);
};

/** 模组窗口拨动内置模组开关时，把它的所有音源状态一起改掉。 */
export const setAndroidSourceStatesForMod = (modId: string, state: ModSourceState): void => {
    const entry = builtinModPackages.find(pkg => pkg.manifest.id === modId);
    if (!entry) return;
    const states = readStates();
    for (const source of entry.manifest.sources) states[source.id] = state;
    setStoredString(STATES_KEY, JSON.stringify(states));
};

export const getAndroidSourceStates = async (): Promise<{ ok: boolean } & ModSourceStatesPayload & { hasSourceMods: boolean; sourcesOnboarding: boolean }> => {
    const states = readStates();
    return {
        ok: true,
        states,
        sources: readSources(),
        hasSourceMods: true,
        sourcesOnboarding: getStoredString(ONBOARDING_KEY, 'done') === 'pending',
    };
};

/** 模组窗口的开关也被视为音源状态变更，订阅者（设置 → 音源页）要跟着刷新。 */
const stateListeners = new Set<(payload: ModSourceStatesPayload) => void>();

export const subscribeAndroidSourceStates = (listener: (payload: ModSourceStatesPayload) => void): (() => void) => {
    stateListeners.add(listener);
    return () => { stateListeners.delete(listener); };
};

const notifySourceStates = (): void => {
    const answer = {
        states: readStates(),
        sources: readSources(),
    };
    stateListeners.forEach((listener) => {
        try { listener(answer); } catch { /* one broken listener must not stop others */ }
    });
};

export const setAndroidSourceState = async (
    sourceId: string,
    state: ModSourceState,
): Promise<{ ok: boolean; error?: string } & Partial<ModSourceStatesPayload>> => {
    if (!STATE_VALUES.includes(state)) return { ok: false, error: `unknown-source-state:${String(state)}` };
    const entry = builtinModPackages.find(pkg => pkg.manifest.sources.some(source => source.id === sourceId));
    if (!entry) return { ok: false, error: 'source-not-found' };
    const states = { ...readStates(), [sourceId]: state };
    setStoredString(STATES_KEY, JSON.stringify(states));
    syncBuiltinModEnabled(entry.manifest.id);
    setStoredString(ONBOARDING_KEY, 'done');
    const { applyAndroidBuiltinSourceEnabled } = await import('../../services/onlineMusic/web/androidSources');
    applyAndroidBuiltinSourceEnabled(entry.manifest.id, state !== 'disabled');
    notifySourceStates();
    return { ok: true, states, sources: readSources() };
};

export const answerAndroidSourcesOnboarding = async (
    choices: Record<string, ModSourceState>,
): Promise<{ ok: boolean; error?: string } & Partial<ModSourceStatesPayload>> => {
    if (getStoredString(ONBOARDING_KEY, 'done') !== 'pending') return { ok: false, error: 'sources-onboarding-not-owed' };
    const states = readStates();
    for (const [sourceId, state] of Object.entries(choices)) {
        if (!STATE_VALUES.includes(state)) return { ok: false, error: 'sources-onboarding-invalid' };
        states[sourceId] = state;
    }
    setStoredString(STATES_KEY, JSON.stringify(states));
    for (const modId of new Set(Object.keys(choices).flatMap(sourceId => (
        builtinModPackages
            .filter(pkg => pkg.manifest.sources.some(source => source.id === sourceId))
            .map(pkg => pkg.manifest.id)
    )))) syncBuiltinModEnabled(modId);
    setStoredString(ONBOARDING_KEY, 'done');
    return { ok: true, states, sources: readSources() };
};
