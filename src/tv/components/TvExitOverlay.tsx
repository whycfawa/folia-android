// src/tv/components/TvExitOverlay.tsx

import { Minimize2, Play, Power } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const TvExitOverlay = ({
    songName,
    isPlaying,
    canBackground,
    canExit,
    onBackground,
    onExit,
}: {
    songName: string | null;
    isPlaying: boolean;
    canBackground: boolean;
    canExit: boolean;
    onBackground: () => void;
    onExit: () => void;
}) => {
    const { t } = useTranslation();
    const message = !songName
        ? t('tv.exit.idleMessage')
        : isPlaying
            ? t('tv.exit.playingMessage', { song: songName })
            : t('tv.exit.pausedMessage', { song: songName });

    return (
        <section id="tv-layer-exit" data-tv-layer="exit" className="tv-overlay tv-exit-overlay">
            <div
                className="tv-overlay-panel tv-exit-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tv-exit-title"
                aria-describedby="tv-exit-description"
            >
                <div className="tv-exit-body">
                    <span className="tv-overlay-icon"><Power size={22} /></span>
                    <h2 id="tv-exit-title">{t('tv.exit.title')}</h2>
                    <p id="tv-exit-description">{message}</p>
                    <div className="tv-exit-actions">
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
                                    <small>
                                        {isPlaying
                                            ? t('tv.exit.backgroundHint')
                                            : t('tv.exit.backgroundIdleHint')}
                                    </small>
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
                                    <small>{t('tv.exit.exitHint')}</small>
                                </span>
                            </button>
                        )}
                    </div>
                    <small className="tv-exit-back-hint">{t('tv.exit.backHint')}</small>
                </div>
            </div>
        </section>
    );
};
