import { Loader2, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getSongAlbumLabel,
    getSongArtistLabel,
} from '../../services/onlineMusic/songMetadata';
import type { SongResult } from '../../types';
import { useTvSearch } from '../hooks/useTvSearch';
import { isTvSpaceKey, resolveTvRemoteAction } from '../input/tvKeys';
import { resolveTvSongCoverUrl, TV_COVER_SIZE } from '../services/tvPlaybackSource';

// src/tv/components/TvSearchOverlay.tsx
// 顶部搜索入口的遥控器界面：输入框支持平台键盘，方向键下移进入结果列表，OK 播放歌曲。

export const TvSearchOverlay = ({
    onPlayTracks,
}: {
    onPlayTracks: (tracks: SongResult[], startIndex: number) => void;
}) => {
    const { t } = useTranslation();
    const search = useTvSearch();
    const inputRef = useRef<HTMLInputElement>(null);
    const firstResultRef = useRef<HTMLButtonElement>(null);
    const shouldFocusResultsRef = useRef(false);

    const submitSearch = useCallback(() => {
        shouldFocusResultsRef.current = true;
        inputRef.current?.blur();
        search.submit();
    }, [search.submit]);

    useEffect(() => {
        if (!shouldFocusResultsRef.current || search.status !== 'ready') return;
        shouldFocusResultsRef.current = false;
        if (search.results.length === 0) return;
        const frame = window.requestAnimationFrame(() => {
            firstResultRef.current?.focus({ preventScroll: true });
            firstResultRef.current?.scrollIntoView({ block: 'nearest' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [search.results.length, search.status]);

    return (
        <section id="tv-layer-search" data-tv-layer="search" className="tv-overlay tv-search-overlay">
            <div
                className="tv-overlay-panel tv-search-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="tv-search-title"
            >
                <header className="tv-overlay-header">
                    <div>
                        <span className="tv-overlay-icon"><Search size={22} /></span>
                        <span>
                            <h2 id="tv-search-title">{t('tv.search.title')}</h2>
                        </span>
                    </div>
                </header>

                <div className="tv-search-bar">
                    <label className="tv-search-field">
                        <Search size={20} />
                        <input
                            ref={inputRef}
                            type="search"
                            value={search.query}
                            onChange={event => search.setQuery(event.target.value)}
                            onKeyDown={event => {
                                if (
                                    resolveTvRemoteAction(event) !== 'ok'
                                    || isTvSpaceKey(event)
                                ) return;
                                event.preventDefault();
                                submitSearch();
                            }}
                            placeholder={t('tv.search.placeholder')}
                            aria-label={t('tv.search.inputLabel')}
                            autoComplete="off"
                            spellCheck={false}
                            enterKeyHint="search"
                            data-tv-focusable="true"
                            data-tv-focus-key="search-input"
                            data-tv-remote-input="true"
                        />
                    </label>
                    <button
                        type="button"
                        className="tv-search-submit"
                        data-tv-focusable="true"
                        data-tv-focus-key="search-submit"
                        onClick={submitSearch}
                    >
                        <Search size={18} />
                        {t('tv.search.action')}
                    </button>
                </div>

                <div className="tv-search-body">
                    {search.status === 'idle' ? (
                        <div className="tv-overlay-empty">
                            <Search size={30} />
                        </div>
                    ) : search.status === 'loading' ? (
                        <div className="tv-overlay-empty">
                            <Loader2 size={28} className="tv-spin" />
                            <span>{t('tv.search.loading')}</span>
                        </div>
                    ) : search.status === 'error' ? (
                        <div className="tv-overlay-empty">
                            <span>{t('tv.search.error')}</span>
                            <button
                                type="button"
                                data-tv-focusable="true"
                                data-tv-focus-key="search-retry"
                                onClick={search.retry}
                            >
                                <RefreshCw size={18} />
                                {t('tv.search.retry')}
                            </button>
                        </div>
                    ) : search.results.length === 0 ? (
                        <div className="tv-overlay-empty">
                            <span>{t('tv.search.empty', { query: search.submittedQuery })}</span>
                        </div>
                    ) : (
                        <div
                            className="tv-overlay-list tv-search-results"
                            data-tv-focus-group="search-results"
                            data-tv-focus-axis="vertical"
                        >
                            {search.results.map((song, index) => {
                                const coverUrl = resolveTvSongCoverUrl(song, TV_COVER_SIZE.row);
                                const detail = [
                                    getSongArtistLabel(song) || '—',
                                    getSongAlbumLabel(song),
                                ].filter(Boolean).join(' · ');
                                return (
                                    <button
                                        ref={index === 0 ? firstResultRef : undefined}
                                        key={`${song.id}-${index}`}
                                        type="button"
                                        className="tv-track-row"
                                        data-tv-focusable="true"
                                        data-tv-focus-key={`search-result-${song.id}-${index}`}
                                        onClick={() => onPlayTracks(search.results, index)}
                                    >
                                        <span className="tv-track-index">{index + 1}</span>
                                        {coverUrl
                                            ? <img src={coverUrl} alt="" loading="lazy" decoding="async" />
                                            : <span className="tv-track-cover-fallback" />}
                                        <span className="tv-track-copy">
                                            <strong>{song.name}</strong>
                                            <small>{detail}</small>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
};
