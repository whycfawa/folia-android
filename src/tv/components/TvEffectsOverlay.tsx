import { Check, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { VisualizerBackgroundMode, VisualizerMode } from '../../types';
import {
    BackgroundModeGlyph,
    VisualizerModeGlyph,
} from '../../components/visualizer/modeGlyphs';
import { VISUALIZER_REGISTRY, getVisualizerModeLabel } from '../../components/visualizer/registry';
import {
    VISUALIZER_BACKGROUND_REGISTRY,
    getVisualizerBackgroundModeLabel,
} from '../../components/visualizer/backgrounds/registry';

// src/tv/components/TvEffectsOverlay.tsx
// Both effect families stay on one page and use the same D-pad geometry as the rest of TV.
export const TvEffectsOverlay = ({
    visualizerMode,
    backgroundMode,
    onVisualizerModeChange,
    onBackgroundModeChange,
}: {
    visualizerMode: VisualizerMode;
    backgroundMode: VisualizerBackgroundMode;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    onBackgroundModeChange: (mode: VisualizerBackgroundMode) => void;
}) => {
    const { t } = useTranslation();

    return (
        <section id="tv-layer-effects" data-tv-layer="effects" className="tv-overlay tv-effects-overlay">
            <div
                className="tv-overlay-panel tv-effects-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tv-effects-title"
            >
                <header className="tv-overlay-header">
                    <div>
                        <span className="tv-overlay-icon"><Sparkles size={22} /></span>
                        <span>
                            <h2 id="tv-effects-title">{t('tv.effects.title')}</h2>
                        </span>
                    </div>
                </header>

                <div className="tv-effects-body">
                    <section className="tv-effects-section">
                        <h3>{t('tv.effects.lyrics')}</h3>
                        <div
                            className="tv-effects-grid is-lyrics"
                            data-tv-focus-group="effects-lyrics"
                        >
                            {VISUALIZER_REGISTRY.map(entry => {
                                const selected = entry.mode === visualizerMode;
                                return (
                                    <button
                                        key={entry.mode}
                                        type="button"
                                        className={`tv-effects-option${selected ? ' is-selected' : ''}`}
                                        data-tv-focusable="true"
                                        data-tv-focus-key={`effects-lyrics-${entry.mode}`}
                                        aria-pressed={selected}
                                        onClick={() => onVisualizerModeChange(entry.mode)}
                                    >
                                        <span className="tv-effects-glyph">
                                            <VisualizerModeGlyph mode={entry.mode} size={24} />
                                        </span>
                                        <strong>{getVisualizerModeLabel(entry.mode, key => t(key))}</strong>
                                        {selected && <Check size={18} />}
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    <section className="tv-effects-section">
                        <h3>{t('tv.effects.background')}</h3>
                        <div
                            className="tv-effects-grid is-backgrounds"
                            data-tv-focus-group="effects-backgrounds"
                        >
                            {VISUALIZER_BACKGROUND_REGISTRY.map(entry => {
                                const selected = entry.mode === backgroundMode;
                                return (
                                    <button
                                        key={entry.mode}
                                        type="button"
                                        className={`tv-effects-option${selected ? ' is-selected' : ''}`}
                                        data-tv-focusable="true"
                                        data-tv-focus-key={`effects-background-${entry.mode}`}
                                        aria-pressed={selected}
                                        onClick={() => onBackgroundModeChange(entry.mode)}
                                    >
                                        <span className="tv-effects-glyph">
                                            <BackgroundModeGlyph mode={entry.mode} size={24} />
                                        </span>
                                        <strong>
                                            {getVisualizerBackgroundModeLabel(entry.mode, key => t(key))}
                                        </strong>
                                        {selected && <Check size={18} />}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </div>
        </section>
    );
};
