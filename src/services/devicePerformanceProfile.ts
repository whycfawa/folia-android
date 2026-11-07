// src/services/devicePerformanceProfile.ts

export type DevicePerformanceTier = 'balanced' | 'constrained';

export type DevicePerformanceConstraint =
    | 'low-ram-device'
    | 'low-max-heap'
    | 'low-cpu'
    | 'low-device-memory';

export type DevicePerformanceSignals = {
    tier?: DevicePerformanceTier | null;
    lowRamDevice?: boolean | null;
    maxHeapMb?: number | null;
    memoryClassMb?: number | null;
    cpuCount?: number | null;
    deviceMemoryGb?: number | null;
    hardwareConcurrency?: number | null;
};

export type DevicePerformanceProfile = {
    tier: DevicePerformanceTier;
    source: 'native' | 'browser';
    constraints: DevicePerformanceConstraint[];
    lowRamDevice: boolean;
    maxHeapMb: number | null;
    memoryClassMb: number | null;
    cpuCount: number | null;
};

type NativeDevicePerformancePlugin = {
    /**
     * The method still carries the TV name because the TV surface introduced it first. Its payload
     * describes the whole Android app, so the regular projector surface uses the same bridge.
     */
    getTvPerformanceProfile?: () => Promise<DevicePerformanceSignals>;
};

const CONSTRAINED_MAX_HEAP_MB = 192;
const CONSTRAINED_MAX_CPU_COUNT = 2;
const CONSTRAINED_MAX_BROWSER_MEMORY_GB = 2;

const finiteNumber = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) ? value : null
);

/** Resolves the runtime tier from native metrics first, then browser hints as a fallback. */
export const resolveDevicePerformanceProfile = (
    signals: DevicePerformanceSignals,
    source: DevicePerformanceProfile['source'] = 'browser',
): DevicePerformanceProfile => {
    const lowRamDevice = signals.lowRamDevice === true;
    const maxHeapMb = finiteNumber(signals.maxHeapMb);
    const memoryClassMb = finiteNumber(signals.memoryClassMb);
    const cpuCount = finiteNumber(signals.cpuCount);
    const constraints: DevicePerformanceConstraint[] = [];

    if (lowRamDevice) constraints.push('low-ram-device');
    if (maxHeapMb !== null && maxHeapMb <= CONSTRAINED_MAX_HEAP_MB) constraints.push('low-max-heap');
    if (cpuCount !== null && cpuCount <= CONSTRAINED_MAX_CPU_COUNT) constraints.push('low-cpu');

    // Navigator hints are deliberately ignored when native metrics are available. Their values are
    // deliberately coarse, and a capable TV must not be downgraded because Chromium capped a hint.
    if (source === 'browser') {
        const deviceMemoryGb = finiteNumber(signals.deviceMemoryGb);
        const hardwareConcurrency = finiteNumber(signals.hardwareConcurrency);
        if (deviceMemoryGb !== null && deviceMemoryGb <= CONSTRAINED_MAX_BROWSER_MEMORY_GB) {
            constraints.push('low-device-memory');
        }
        if (
            cpuCount === null
            && hardwareConcurrency !== null
            && hardwareConcurrency <= CONSTRAINED_MAX_CPU_COUNT
        ) {
            constraints.push('low-cpu');
        }
    }

    const tier = constraints.length > 0 || signals.tier === 'constrained'
        ? 'constrained'
        : 'balanced';

    return {
        tier,
        source,
        constraints: Array.from(new Set(constraints)),
        lowRamDevice,
        maxHeapMb,
        memoryClassMb,
        cpuCount,
    };
};

export const readBrowserDevicePerformanceSignals = (): DevicePerformanceSignals => {
    if (typeof navigator === 'undefined') return {};
    const hintedNavigator = navigator as Navigator & {
        deviceMemory?: number;
        hardwareConcurrency?: number;
    };
    return {
        deviceMemoryGb: finiteNumber(hintedNavigator.deviceMemory),
        hardwareConcurrency: finiteNumber(hintedNavigator.hardwareConcurrency),
    };
};

const NATIVE_BRIDGE_RETRY_DELAY_MS = 150;
const NATIVE_BRIDGE_RETRY_COUNT = 8;

let nativeProfileRequest: Promise<DevicePerformanceSignals | null> | null = null;

const wait = (milliseconds: number): Promise<void> => (
    new Promise(resolve => window.setTimeout(resolve, milliseconds))
);

/** Reads Android's real heap/CPU picture once; repeated calls share the same bridge request. */
export const loadNativeDevicePerformanceSignals = (): Promise<DevicePerformanceSignals | null> => {
    if (nativeProfileRequest) return nativeProfileRequest;
    if (typeof window === 'undefined') return Promise.resolve(null);

    nativeProfileRequest = (async () => {
        for (let attempt = 0; attempt < NATIVE_BRIDGE_RETRY_COUNT; attempt += 1) {
            const capacitor = (window as unknown as {
                Capacitor?: {
                    getPlatform?: () => string;
                    Plugins?: { FoliaNative?: NativeDevicePerformancePlugin };
                };
            }).Capacitor;
            if (!capacitor) {
                await wait(NATIVE_BRIDGE_RETRY_DELAY_MS);
                continue;
            }
            const platform = capacitor.getPlatform?.();
            if (platform && platform !== 'android') return null;
            if (!platform) {
                await wait(NATIVE_BRIDGE_RETRY_DELAY_MS);
                continue;
            }

            const getProfile = capacitor.Plugins?.FoliaNative?.getTvPerformanceProfile;
            if (typeof getProfile === 'function') {
                try {
                    const signals = await getProfile();
                    return signals && typeof signals === 'object' ? signals : null;
                } catch {
                    return null;
                }
            }
            await wait(NATIVE_BRIDGE_RETRY_DELAY_MS);
        }
        return null;
    })();
    return nativeProfileRequest;
};
