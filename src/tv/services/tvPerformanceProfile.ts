// src/tv/services/tvPerformanceProfile.ts
// Backwards-compatible TV names over the shared device performance profile.

export {
    loadNativeDevicePerformanceSignals as loadNativeTvPerformanceSignals,
    readBrowserDevicePerformanceSignals as readBrowserTvPerformanceSignals,
    resolveDevicePerformanceProfile as resolveTvPerformanceProfile,
} from '../../services/devicePerformanceProfile';

export type {
    DevicePerformanceConstraint as TvPerformanceConstraint,
    DevicePerformanceProfile as TvPerformanceProfile,
    DevicePerformanceSignals as TvPerformanceSignals,
    DevicePerformanceTier as TvPerformanceTier,
} from '../../services/devicePerformanceProfile';
