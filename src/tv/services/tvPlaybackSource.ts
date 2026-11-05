// src/tv/services/tvPlaybackSource.ts

import { getLocalSong } from '../../services/db';
import { getAudioFromLocalSong } from '../../services/localMusicService';
import {
    applyOnlineAudioSourceMetadata,
    loadOnlineSongAudioSource,
    loadOnlineSongLyrics,
} from '../../services/onlinePlayback';
import { getSongCoverUrl } from '../../services/onlineMusic/songMetadata';
import type { AudioQualityPreference, MediaId } from '../../types/onlineMusic';
import type { LyricData, LocalSong, SongResult } from '../../types';
import { toSafeRemoteUrl } from '../../utils/appPlaybackHelpers';
import { isLocalPlaybackSong } from '../../utils/appPlaybackGuards';
import { resolveLocalSongLyrics } from '../../utils/lyrics/localSongLyrics';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';

// src/tv/services/tvPlaybackSource.ts
// TV playback deliberately reuses the phone app's source and lyric resolvers, but keeps the queue
// single-deck: a low-memory projector should not decode two tracks for an automix transition.

export type TvResolvedAudioSource = {
    audioSrc: string;
    song: SongResult;
    localSong: LocalSong | null;
};

export class TvPlaybackSourceError extends Error {
    readonly reason: string;

    constructor(reason: string) {
        super(reason);
        this.name = 'TvPlaybackSourceError';
        this.reason = reason;
    }
}

export const resolveTvSongCoverUrl = (song: SongResult | null): string | null => {
    if (!song) return null;
    const raw = song.album?.coverUrl || getSongCoverUrl(song);
    return toSafeRemoteUrl(raw) ?? null;
};

export const loadTvSongAudio = async (
    song: SongResult,
    audioQuality: AudioQualityPreference,
    isCurrent: () => boolean,
): Promise<TvResolvedAudioSource> => {
    if (isLocalPlaybackSong(song)) {
        const localSongId = song.localRef?.songId;
        const localSong = localSongId ? await getLocalSong(localSongId) : undefined;
        if (!localSong) throw new TvPlaybackSourceError('local-record-missing');
        const audioSrc = await getAudioFromLocalSong(localSong);
        if (!audioSrc) throw new TvPlaybackSourceError('local-file-unavailable');
        return { audioSrc, song, localSong };
    }

    const result = await loadOnlineSongAudioSource(song, audioQuality, null, {
        retry: { isCurrent },
    });
    if (!isCurrent()) throw new DOMException('Playback request superseded', 'AbortError');
    if (result.kind !== 'ok') throw new TvPlaybackSourceError(result.failure.reason);

    return {
        audioSrc: result.audioSrc,
        song: applyOnlineAudioSourceMetadata(song, result.replayGain),
        localSong: null,
    };
};

export const loadTvSongLyrics = async ({
    song,
    localSong,
    userId,
    isCurrent,
    onLyrics,
    onLoadingChange,
}: {
    song: SongResult;
    localSong: LocalSong | null;
    userId: MediaId | null;
    isCurrent: () => boolean;
    onLyrics: (lyrics: LyricData | null) => void;
    onLoadingChange: (loading: boolean) => void;
}): Promise<void> => {
    onLoadingChange(true);
    try {
        if (localSong) {
            const resolved = await resolveLocalSongLyrics(
                localSong,
                useLyricSettingsStore.getState().localLyricsPriority,
            );
            if (isCurrent()) onLyrics(resolved.lyrics);
            return;
        }

        await loadOnlineSongLyrics(song, null, userId, {
            isCurrent,
            onLyrics: lyrics => {
                if (isCurrent()) onLyrics(lyrics);
            },
            onDone: () => undefined,
        });
    } finally {
        if (isCurrent()) onLoadingChange(false);
    }
};

