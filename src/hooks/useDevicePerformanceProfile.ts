import { useEffect, useState } from 'react';
import {
    loadNativeDevicePerformanceSignals,
    readBrowserDevicePerformanceSignals,
    resolveDevicePerformanceProfile,
    type DevicePerformanceProfile,
} from '../services/devicePerformanceProfile';

// src/hooks/useDevicePerformanceProfile.ts

/** Starts from browser hints, then upgrades to Android's actual heap and CPU metrics. */
export const useDevicePerformanceProfile = (): DevicePerformanceProfile => {
    const [profile, setProfile] = useState<DevicePerformanceProfile>(() => (
        resolveDevicePerformanceProfile(readBrowserDevicePerformanceSignals())
    ));

    useEffect(() => {
        let disposed = false;
        void loadNativeDevicePerformanceSignals().then(signals => {
            if (disposed || !signals) return;
            const next = resolveDevicePerformanceProfile(signals, 'native');
            setProfile(current => (
                current.tier === next.tier
                && current.source === next.source
                && current.constraints.join(',') === next.constraints.join(',')
                    ? current
                    : next
            ));
        });
        return () => {
            disposed = true;
        };
    }, []);

    return profile;
};
