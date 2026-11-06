import type { MotionValue } from 'framer-motion';
import VisualizerBackgroundRenderer from '../../components/visualizer/backgrounds/VisualizerBackgroundRenderer';
import type { VisualizerBackgroundConfig } from '../../components/visualizer/backgrounds/definition';
import type { AudioBands, Theme } from '../../types';

// src/tv/components/TvBackdrop.tsx
// Full-page background parity with the desktop visualizer backgrounds. The scrim only protects
// header and lyric contrast; the effect itself remains visible across the projector frame.
export const TvBackdrop = ({
    config,
    theme,
    coverUrl,
    seed,
    audioPower,
    audioBands,
    paused,
    staticMode,
}: {
    config: VisualizerBackgroundConfig;
    theme: Theme;
    coverUrl?: string | null;
    seed?: string | number;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    paused: boolean;
    staticMode: boolean;
}) => (
    <div className="tv-backdrop tv-visualizer-background" aria-hidden="true">
        <VisualizerBackgroundRenderer
            key={config.mode ?? 'default'}
            config={config}
            theme={theme}
            isDaylight={false}
            coverUrl={coverUrl}
            audioPower={audioPower}
            audioBands={audioBands}
            seed={seed}
            staticMode={staticMode}
            paused={paused}
        />
        <div className="tv-backdrop-scrim" />
    </div>
);
