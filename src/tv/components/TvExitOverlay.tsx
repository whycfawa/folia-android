// src/tv/components/TvExitOverlay.tsx

import { Minimize2, Play, Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const TvExitOverlay = ({
    isPlaying,
    canBackground,
    canExit,
    onBackground,
    onExit,
}: {
    isPlaying: boolean;
    canBackground: boolean;
    canExit: boolean;
    onBackground: () => void;
    onExit: () => void;
}) => {
    const { t } = useTranslation();

    return (
        <section id="tv-layer-exit" data-tv-layer="exit" className="tv-overlay tv-exit-overlay">
            <div
                className="tv-overlay-panel tv-exit-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tv-exit-title"
            >
                <div className="tv-exit-body">
                    <span className="tv-overlay-icon"><Power size={22} /></span>
                    <h2 id="tv-exit-title">{t('tv.exit.title')}</h2>
                    <div
                        className="tv-exit-actions"
                        data-tv-focus-group="exit-actions"
                        data-tv-focus-axis="vertical"
                    >
                        {canBackground && (
                            <button
                                type="button"
                                className="tv-exit-option is-background"
                                data-tv-focusable="true"
                                data-tv-focus-key="exit-background"
                                onClick={onBackground}
                            >
                                {isPlaying ? <Play size={22} fill="currentColor" /> : <Minimize2 size={22} />}
                                <span>
                                    <strong>
                                        {isPlaying ? t('tv.exit.background') : t('tv.exit.backgroundIdle')}
                                    </strong>
                                </span>
                            </button>
                        )}
                        {canExit && (
                            <button
                                type="button"
                                className="tv-exit-option is-danger"
                                data-tv-focusable="true"
                                data-tv-focus-key="exit-app"
                                onClick={onExit}
                            >
                                <Power size={22} />
                                <span>
                                    <strong>{t('tv.exit.exit')}</strong>
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};
