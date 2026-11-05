import { useEffect, useState } from 'react';
import {
    loadNativeTvPerformanceSignals,
    readBrowserTvPerformanceSignals,
    resolveTvPerformanceProfile,
    type TvPerformanceProfile,
} from '../services/tvPerformanceProfile';

// src/tv/hooks/useTvPerformanceProfile.ts

/** Starts from browser hints, then upgrades to Android's actual heap and CPU metrics. */
export const useTvPerformanceProfile = (): TvPerformanceProfile => {
    const [profile, setProfile] = useState<TvPerformanceProfile>(() => (
        resolveTvPerformanceProfile(readBrowserTvPerformanceSignals())
    ));

    useEffect(() => {
        let disposed = false;
        void loadNativeTvPerformanceSignals().then(signals => {
            if (disposed || !signals) return;
            const next = resolveTvPerformanceProfile(signals, 'native');
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
