import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/library/app/libraryAccountPort.test.ts
// 平台换了时的播放器端口（切到别的平台、退出当前平台）：停掉 automix 尾音与 audio、回收 blob 地址、作废还在取地址的播放、
// 清空当前歌曲 / 队列 / 存着的会话 / 歌词 / 封面 / FM / 播放状态、丢掉 prefetch 与 track profile、搜索运行态换到新平台、
// 集合导航清空；App 的句柄按调用现读。播放器里有没有歌决定要不要先问。
// HiFi 路线上的声音在 mpv 里：清空时也离开这条路线（服务是替身，只钉住清空叫了它、叫在清掉歌之前）。

const services = vi.hoisted(() => ({ clearPrefetchRuntime: vi.fn(), clearTrackProfileRuntime: vi.fn() }));
vi.mock('@/services/prefetchService', () => ({ clearPrefetchRuntime: services.clearPrefetchRuntime }));
vi.mock('@/services/automix/profileService', () => ({ clearTrackProfileRuntime: services.clearTrackProfileRuntime }));
const playback = vi.hoisted(() => ({ forgetPlaybackCache: vi.fn(async () => { }) }));
vi.mock('@/components/app/playback/persistPlaybackCache', () => ({ forgetPlaybackCache: playback.forgetPlaybackCache }));
// HiFi 路线的出口：mpv 停下、独占设备放开、路线切回 web；不在这条路线上时它自己什么都不做。
const hifi = vi.hoisted(() => ({ leaveHifiRoute: vi.fn(() => false) }));
vi.mock('@/services/hifi/hifiPlayback', () => ({ leaveHifiRoute: hifi.leaveHifiRoute }));

import { createLibraryAccountSwitchCleanupPort, type LibraryAccountSwitchHost } from '@/library/app/createLibraryAccountPort';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import { PlayerState, type SongResult } from '@/types';

const song = { id: 's1', name: 'Song', artists: [], album: { id: '', name: '' } } as unknown as SongResult;

const fakeAudio = () => ({ pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() });

describe('provider switch cleanup port', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePlaybackStore.setState({
            audioSrc: 'blob:old-track',
            currentSong: song,
            playQueue: [song],
            cachedCoverUrl: 'cover.png',
            isFmMode: true,
            playerState: PlayerState.PLAYING,
        });
    });

    it('stops playback and clears the outgoing provider\'s runtime before the switch commits', () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const resetRuntime = vi.spyOn(useSearchNavigationStore.getState(), 'resetRuntime');
        const clearNavigation = vi.spyOn(useCollectionNavigationStore.getState(), 'clear');
        const audio = fakeAudio();
        const automix = { abortTransition: vi.fn() };
        const setLyrics = vi.fn();
        const setIsLyricsLoading = vi.fn();
        const shouldAutoPlay = { current: true };
        const host: LibraryAccountSwitchHost = {
            audioRef: { current: audio as unknown as HTMLAudioElement },
            automixRef: { current: automix },
            shouldAutoPlay,
            setLyrics,
            setIsLyricsLoading,
        };
        const port = createLibraryAccountSwitchCleanupPort(() => host);

        port.resetForProviderSwitch('kugou', 'netease');

        expect(automix.abortTransition).toHaveBeenCalledTimes(1);
        expect(audio.pause).toHaveBeenCalledTimes(1);
        expect(hifi.leaveHifiRoute).toHaveBeenCalledTimes(1);
        expect(audio.removeAttribute).toHaveBeenCalledWith('src');
        expect(audio.load).toHaveBeenCalledTimes(1);
        expect(revoke).toHaveBeenCalledWith('blob:old-track');
        expect(setLyrics).toHaveBeenCalledWith(null);
        expect(setIsLyricsLoading).toHaveBeenCalledWith(false);
        expect(shouldAutoPlay.current).toBe(false);
        expect(playback.forgetPlaybackCache).toHaveBeenCalledTimes(1);
        expect(usePlaybackStore.getState()).toMatchObject({
            audioSrc: null,
            currentSong: null,
            playQueue: [],
            cachedCoverUrl: null,
            isFmMode: false,
            playerState: PlayerState.IDLE,
        });
        expect(services.clearPrefetchRuntime).toHaveBeenCalledTimes(1);
        expect(services.clearTrackProfileRuntime).toHaveBeenCalledTimes(1);
        expect(resetRuntime).toHaveBeenCalledWith('kugou');
        expect(clearNavigation).toHaveBeenCalledTimes(1);
        revoke.mockRestore();
    });

    it('reads the host on every call and leaves non-blob sources alone', () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        usePlaybackStore.setState({ audioSrc: 'https://example.test/a.mp3' });
        let host: LibraryAccountSwitchHost = {
            audioRef: { current: null },
            automixRef: { current: null },
            shouldAutoPlay: { current: false },
            setLyrics: vi.fn(),
            setIsLyricsLoading: vi.fn(),
        };
        const port = createLibraryAccountSwitchCleanupPort(() => host);
        const laterAudio = fakeAudio();
        host = { ...host, audioRef: { current: laterAudio as unknown as HTMLAudioElement } };

        port.resetForProviderSwitch('qq', 'netease');

        expect(laterAudio.pause).toHaveBeenCalledTimes(1);
        expect(revoke).not.toHaveBeenCalled();
        revoke.mockRestore();
    });

    it('leaves the HiFi route before the source is emptied: mpv stops while the song is still the one shown', () => {
        let shownWhenLeft: unknown = 'not left';
        hifi.leaveHifiRoute.mockImplementationOnce(() => {
            shownWhenLeft = usePlaybackStore.getState().currentSong;
            return true;
        });
        const host: LibraryAccountSwitchHost = {
            audioRef: { current: null },
            automixRef: { current: null },
            shouldAutoPlay: { current: true },
            setLyrics: vi.fn(),
            setIsLyricsLoading: vi.fn(),
        };

        createLibraryAccountSwitchCleanupPort(() => host).resetForProviderSwitch('qq', 'netease');

        expect(hifi.leaveHifiRoute).toHaveBeenCalledTimes(1);
        expect(shownWhenLeft).toBe(song);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
    });

    it('says whether the player holds songs: one playing, or one in the queue', () => {
        const port = createLibraryAccountSwitchCleanupPort(() => { throw new Error('not read'); });
        expect(port.holdsSongs()).toBe(true);
        usePlaybackStore.setState({ currentSong: null, playQueue: [song] });
        expect(port.holdsSongs()).toBe(true);
        usePlaybackStore.setState({ currentSong: null, playQueue: [] });
        expect(port.holdsSongs()).toBe(false);
    });
});
